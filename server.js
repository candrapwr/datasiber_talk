import http from "node:http";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import Primus from "primus";
import sqlite3 from "sqlite3";
import { randomUUID } from "node:crypto";

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = join(process.cwd(), "public");
const UPLOADS_DIR = join(process.cwd(), "uploads");
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ASSET_VERSION = Date.now().toString();

const mimeByExt = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const isUpload = pathname.startsWith("/uploads/");
  const baseDir = isUpload ? UPLOADS_DIR : PUBLIC_DIR;
  const filePath = join(baseDir, pathname.replace(/^\/uploads/, ""));

  try {
    let data = await readFile(filePath);
    if (!isUpload && pathname === "/index.html") {
      const html = data.toString("utf-8").replaceAll("__ASSET_VERSION__", ASSET_VERSION);
      data = Buffer.from(html, "utf-8");
    }
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": mimeByExt[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
});

const primus = new Primus(server, {
  transformer: "websockets",
});

const db = new sqlite3.Database(join(process.cwd(), "chat.sqlite"));

function ensureSchema() {
  db.serialize(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        roomId TEXT NOT NULL,
        senderId TEXT NOT NULL,
        name TEXT NOT NULL,
        text TEXT NOT NULL,
        sentAt TEXT NOT NULL,
        receivedAt TEXT NOT NULL
      )`
    );
    db.run("CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(roomId)");
    db.all("PRAGMA table_info(messages)", (err, rows) => {
      if (err || !rows) return;
      const columns = new Set(rows.map((row) => row.name));
      if (!columns.has("messageType")) db.run("ALTER TABLE messages ADD COLUMN messageType TEXT");
      if (!columns.has("fileName")) db.run("ALTER TABLE messages ADD COLUMN fileName TEXT");
      if (!columns.has("fileType")) db.run("ALTER TABLE messages ADD COLUMN fileType TEXT");
      if (!columns.has("fileData")) db.run("ALTER TABLE messages ADD COLUMN fileData TEXT");
      if (!columns.has("filePath")) db.run("ALTER TABLE messages ADD COLUMN filePath TEXT");
    });
  });
}

ensureSchema();

const rooms = new Map();
const callPeers = new Map();
const readStates = new Map();
const HISTORY_LIMIT = 50;

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  return rooms.get(roomId);
}

function roomBroadcast(roomId, payload) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const spark of room) {
    spark.write(payload);
  }
}

function findSparkByUserId(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  for (const spark of room) {
    if (spark.userId === userId) return spark;
  }
  return null;
}

function setCallPeer(a, b) {
  if (!a || !b) return;
  callPeers.set(a, b);
  callPeers.set(b, a);
}

function clearCallPeer(a) {
  const b = callPeers.get(a);
  if (b) {
    callPeers.delete(a);
    callPeers.delete(b);
  }
  return b || null;
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function runCallback(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function decodeBase64DataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const marker = "base64,";
  const idx = dataUrl.indexOf(marker);
  if (idx === -1) return null;
  const b64 = dataUrl.slice(idx + marker.length);
  if (!b64) return null;
  try {
    return Buffer.from(b64, "base64");
  } catch {
    return null;
  }
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function getReadState(roomId) {
  if (!readStates.has(roomId)) readStates.set(roomId, new Map());
  return readStates.get(roomId);
}

function emitMembers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const members = Array.from(room).map((spark) => ({
    id: spark.userId,
    name: spark.name || "Anon",
  }));
  roomBroadcast(roomId, { type: "members", members });
}

async function sendHistory(roomId, spark, beforeRowId = null) {
  const baseSql =
    "SELECT rowid as rowId, id, roomId, senderId, name, text, sentAt, receivedAt, messageType, fileName, fileType, fileData, filePath FROM messages WHERE roomId = ?";
  const params = [roomId];
  let sql = baseSql;
  if (beforeRowId) {
    sql += " AND rowid < ?";
    params.push(beforeRowId);
  }
  sql += " ORDER BY rowid DESC LIMIT ?";
  params.push(HISTORY_LIMIT);

  const rows = await dbAll(sql, params);
  const items = rows.reverse();
  const nextBefore =
    items.length === HISTORY_LIMIT ? items[0]?.rowId || null : null;

  spark.write({ type: "history", items, nextBefore });
}

primus.on("connection", (spark) => {
  spark.write({
    type: "system",
    text: "Tersambung ke server",
    at: new Date().toISOString(),
  });

  spark.on("data", async (data) => {
    if (data?.type === "join") {
      const roomId = String(data?.roomId || "").trim();
      const name = String(data?.name || "Anon").trim().slice(0, 32);
      const userId = String(data?.userId || "").trim();
      if (!roomId) return;

      spark.roomId = roomId;
      spark.name = name;
      spark.userId = userId || spark.id;

      getRoom(roomId).add(spark);

      spark.write({
        type: "joined",
        roomId,
        name,
        at: new Date().toISOString(),
      });

      sendHistory(roomId, spark).catch(() => {});

      emitMembers(roomId);

      roomBroadcast(roomId, {
        type: "system",
        text: `${name} bergabung`,
        at: new Date().toISOString(),
      });
      return;
    }

    if (data?.type === "history") {
      if (!spark.roomId) return;
      const beforeRowId = Number(data?.beforeRowId) || null;
      sendHistory(spark.roomId, spark, beforeRowId).catch(() => {});
      return;
    }

    if (data?.type?.startsWith("call_")) {
      if (!spark.roomId) return;
      const targetId = String(data?.to || "");
      if (!targetId) return;
      const target = findSparkByUserId(spark.roomId, targetId);
      if (!target) return;
      if (data.type === "call_offer" || data.type === "call_answer") {
        setCallPeer(spark.userId, targetId);
      }
      if (data.type === "call_end" || data.type === "call_reject" || data.type === "call_busy") {
        clearCallPeer(spark.userId);
      }
      target.write({
        type: data.type,
        from: spark.userId,
        name: spark.name || "Anon",
        sdp: data.sdp,
        candidate: data.candidate,
        callType: data.callType,
      });
      return;
    }

    if (data?.type === "clear_room") {
      if (!spark.roomId) return;
      const roomId = spark.roomId;
      const rows = await dbAll(
        "SELECT filePath FROM messages WHERE roomId = ? AND filePath IS NOT NULL",
        [roomId]
      ).catch(() => []);
      const files = Array.isArray(rows) ? rows.map((r) => r.filePath).filter(Boolean) : [];
      await dbRun("DELETE FROM messages WHERE roomId = ?", [roomId]).catch(() => {});
      await Promise.all(
        files.map(async (path) => {
          const full = join(process.cwd(), path.replace(/^\//, ""));
          try {
            await unlink(full);
          } catch {}
        })
      );
      roomBroadcast(roomId, { type: "cleared" });
      return;
    }

    if (data?.type === "typing") {
      if (!spark.roomId) return;
      roomBroadcast(spark.roomId, {
        type: "typing",
        userId: spark.userId,
        name: spark.name || "Anon",
        isTyping: Boolean(data?.isTyping),
      });
      return;
    }

    if (data?.type === "read") {
      if (!spark.roomId) return;
      const rowId = Number(data?.rowId) || null;
      if (!rowId) return;
      const state = getReadState(spark.roomId);
      const prev = state.get(spark.userId) || 0;
      if (rowId <= prev) return;
      state.set(spark.userId, rowId);
      roomBroadcast(spark.roomId, {
        type: "read",
        userId: spark.userId,
        rowId,
      });
      return;
    }

    if (data?.type === "message") {
      if (!spark.roomId) return;
      const text = String(data?.text || "");
      const id = data?.id;
      const senderId = data?.senderId;
      const messageType = data?.messageType || "text";
      const fileName = data?.fileName || null;
      const fileType = data?.fileType || null;
      const fileData = data?.fileData || null;
      let filePath = null;
      const sentAt = data?.sentAt || new Date().toISOString();
      const receivedAt = new Date().toISOString();

      if (messageType === "file" && fileData && fileType) {
        const buffer = decodeBase64DataUrl(fileData);
        if (buffer) {
          if (buffer.length > MAX_UPLOAD_BYTES) {
            spark.write({
              type: "system",
              text: "File terlalu besar (maks 2MB)",
              at: new Date().toISOString(),
            });
            return;
          }
          await mkdir(UPLOADS_DIR, { recursive: true });
          const safeName = String(fileName || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
          const storedName = `${spark.roomId}_${randomUUID()}_${safeName}`;
          filePath = `/uploads/${storedName}`;
          await writeFile(join(UPLOADS_DIR, storedName), buffer);
        }
      }

      const result = await dbRun(
        "INSERT OR IGNORE INTO messages (id, roomId, senderId, name, text, sentAt, receivedAt, messageType, fileName, fileType, fileData, filePath) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          id,
          spark.roomId,
          senderId,
          spark.name || "Anon",
          text,
          sentAt,
          receivedAt,
          messageType,
          fileName,
          fileType,
          null,
          filePath,
        ]
      ).catch(() => null);

      let rowId = result?.lastID || null;
      if (!rowId && id) {
        const row = await dbGet("SELECT rowid as rowId FROM messages WHERE id = ?", [id]).catch(() => null);
        rowId = row?.rowId || null;
      }

      spark.write({
        type: "received",
        text,
        id,
        at: receivedAt,
        rowId,
      });

      roomBroadcast(spark.roomId, {
        type: "broadcast",
        text,
        id,
        senderId,
        name: spark.name || "Anon",
        sentAt,
        at: receivedAt,
        messageType,
        fileName,
        fileType,
        filePath,
        rowId,
      });
    }
  });
});

primus.on("disconnection", (spark) => {
  const roomId = spark.roomId;
  if (!roomId) return;
  const peerId = clearCallPeer(spark.userId);
  if (peerId) {
    const peer = findSparkByUserId(roomId, peerId);
    if (peer) peer.write({ type: "call_end", from: spark.userId });
  }
  const room = rooms.get(roomId);
  if (!room) return;
  room.delete(spark);
  const state = readStates.get(roomId);
  if (state) state.delete(spark.userId);
  if (room.size === 0) rooms.delete(roomId);
  emitMembers(roomId);
});

server.listen(PORT, () => {
  console.log(`Primus websocket server berjalan di http://localhost:${PORT}`);
});
