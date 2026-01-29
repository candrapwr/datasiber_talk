import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import Primus from "primus";
import sqlite3 from "sqlite3";
import { randomUUID } from "node:crypto";

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = join(process.cwd(), "public");
const UPLOADS_DIR = join(process.cwd(), "uploads");
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

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
    const data = await readFile(filePath);
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
      if (!roomId) return;

      spark.roomId = roomId;
      spark.name = name;

      getRoom(roomId).add(spark);

      spark.write({
        type: "joined",
        roomId,
        name,
        at: new Date().toISOString(),
      });

      dbAll(
        "SELECT id, roomId, senderId, name, text, sentAt, receivedAt, messageType, fileName, fileType, fileData, filePath FROM messages WHERE roomId = ? ORDER BY rowid DESC LIMIT 200",
        [roomId]
      )
        .then((rows) => {
          const items = rows.reverse();
          spark.write({ type: "history", items });
        })
        .catch(() => {});

      roomBroadcast(roomId, {
        type: "system",
        text: `${name} bergabung`,
        at: new Date().toISOString(),
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

      spark.write({
        type: "received",
        text,
        id,
        at: receivedAt,
      });

      if (messageType === "file" && fileData && fileType) {
        const match = /^data:([^;]+);base64,(.+)$/.exec(fileData);
        if (match) {
          const buffer = Buffer.from(match[2], "base64");
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

      dbRun(
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
      ).catch(() => {});

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
      });
    }
  });
});

primus.on("disconnection", (spark) => {
  const roomId = spark.roomId;
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (!room) return;
  room.delete(spark);
  if (room.size === 0) rooms.delete(roomId);
});

server.listen(PORT, () => {
  console.log(`Primus websocket server berjalan di http://localhost:${PORT}`);
});
