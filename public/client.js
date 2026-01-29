const logEl = document.getElementById("log");
const form = document.getElementById("chat-form");
const input = document.getElementById("message");
const overlay = document.getElementById("overlay");
const nameForm = document.getElementById("name-form");
const nameInput = document.getElementById("name-input");
const roomLinkEl = document.getElementById("room-link");
const copyLinkBtn = document.getElementById("copy-link");
const emojiBtn = document.getElementById("emoji-btn");
const emojiPanel = document.getElementById("emoji-panel");
const fileBtn = document.getElementById("file-btn");
const fileInput = document.getElementById("file-input");
const fileOverlay = document.getElementById("file-overlay");
const filePreview = document.getElementById("file-preview");
const fileCaption = document.getElementById("file-caption");
const fileCancel = document.getElementById("file-cancel");
const fileSend = document.getElementById("file-send");
const clientId = crypto.randomUUID();
const pendingMap = new Map();
let isOpen = false;
let joined = false;
let pendingJoinName = null;
let currentName = null;

function formatTime(iso) {
  const date = iso ? new Date(iso) : new Date();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  const micros = "000";
  return `${hh}:${mm}:${ss}.${ms}${micros}`;
}

function addBubble({
  text,
  direction,
  sentAt,
  receivedAt,
  id,
  system,
  sender,
  messageType,
  fileName,
  fileType,
  fileData,
  filePath,
}) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${system ? "system" : direction}`;
  if (id) bubble.dataset.id = id;
  if (sentAt) bubble.dataset.sentAt = sentAt;

  const displaySender = sender || (direction === "outgoing" && !system ? "Saya" : "");
  if (displaySender) {
    const senderEl = document.createElement("div");
    senderEl.className = "sender";
    senderEl.textContent = displaySender;
    bubble.appendChild(senderEl);
  }

  const content = document.createElement("div");
  if (messageType === "file" && (fileData || filePath)) {
    const fileUrl = filePath || fileData;
    if (fileType && fileType.startsWith("image/") && fileUrl) {
      const img = document.createElement("img");
      img.src = fileUrl;
      img.alt = fileName || "image";
      img.style.maxWidth = "100%";
      img.style.borderRadius = "10px";
      content.appendChild(img);
    }
    if (text) {
      const caption = document.createElement("div");
      caption.textContent = text;
      caption.style.marginTop = "8px";
      content.appendChild(caption);
    }
    const link = document.createElement("a");
    link.href = fileUrl || "#";
    link.download = fileName || "file";
    link.textContent = fileName || "Download file";
    link.style.color = "#c6f2e3";
    link.style.display = "inline-block";
    link.style.marginTop = "6px";
    content.appendChild(link);
  } else {
    content.textContent = text;
  }
  bubble.appendChild(content);

  if (!system) {
    const meta = document.createElement("div");
    meta.className = "meta";

    const iconRow = document.createElement("span");
    iconRow.className = "icon-row";

    if (sentAt) {
      const sentIcon = document.createElement("span");
      sentIcon.className = "icon sent";
      sentIcon.title = `dikirim ${formatTime(sentAt)}`;
      iconRow.appendChild(sentIcon);
    }
    if (receivedAt) {
      const receivedIcon = document.createElement("span");
      receivedIcon.className = "icon received";
      receivedIcon.title = `diterima ${formatTime(receivedAt)}`;
      iconRow.appendChild(receivedIcon);
    }

    meta.appendChild(iconRow);

    bubble.appendChild(meta);
  }

  logEl.appendChild(bubble);
  logEl.scrollTop = logEl.scrollHeight;
  return bubble;
}

function updateState(id, receivedAt) {
  const bubble = pendingMap.get(id);
  if (!bubble) return;
  const meta = bubble.querySelector(".meta");
  if (!meta) return;
  const timeEl = meta.querySelector(".icon-row");
  if (timeEl) {
    const sentAt = bubble.dataset.sentAt;
    timeEl.innerHTML = "";
    if (sentAt) {
      const sentIcon = document.createElement("span");
      sentIcon.className = "icon sent";
      sentIcon.title = `dikirim ${formatTime(sentAt)}`;
      timeEl.appendChild(sentIcon);
    }
    if (receivedAt) {
      const receivedIcon = document.createElement("span");
      receivedIcon.className = "icon received";
      receivedIcon.title = `diterima ${formatTime(receivedAt)}`;
      timeEl.appendChild(receivedIcon);
    }
  }
}

const primus = new Primus();

function getRoomId() {
  const url = new URL(window.location.href);
  let roomId = url.searchParams.get("room");
  if (!roomId) {
    roomId = crypto.randomUUID().split("-")[0];
    url.searchParams.set("room", roomId);
    window.history.replaceState({}, "", url.toString());
  }
  return roomId;
}

const roomId = getRoomId();
const roomLink = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
roomLinkEl.textContent = roomLink;
roomLinkEl.title = roomLink;
const storageKey = `primus:name:${roomId}`;
const storedName = localStorage.getItem(storageKey);
if (storedName) {
  nameInput.value = storedName;
  pendingJoinName = storedName;
  currentName = storedName;
}

copyLinkBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomLink);
    copyLinkBtn.textContent = "Copied";
    setTimeout(() => (copyLinkBtn.textContent = "Copy"), 1200);
  } catch {
    copyLinkBtn.textContent = "Gagal";
    setTimeout(() => (copyLinkBtn.textContent = "Copy"), 1200);
  }
});

const emojis = [
  "😀","😁","😂","🤣","😊","😍",
  "😎","🤩","😇","😴","🤔","😮",
  "😢","😭","😡","👍","🙏","🔥",
  "🎉","💯","✅","❌","📌","🧩",
];

emojis.forEach((emoji) => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = emoji;
  btn.addEventListener("click", () => {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
    input.focus();
    input.selectionStart = input.selectionEnd = start + emoji.length;
    emojiPanel.classList.add("hidden");
  });
  emojiPanel.appendChild(btn);
});

emojiBtn.addEventListener("click", () => {
  emojiPanel.classList.toggle("hidden");
});

fileBtn.addEventListener("click", () => {
  fileInput.click();
});

function setChatEnabled(enabled) {
  input.disabled = !enabled;
  form.querySelector("button").disabled = !enabled;
}

setChatEnabled(false);

function sendJoin(name) {
  if (!name) return;
  pendingJoinName = name;
  currentName = name;
  if (!isOpen) return;
  primus.write({ type: "join", name, roomId });
}

primus.on("open", () => {
  isOpen = true;
  addBubble({ text: "Tersambung ke server", system: true });
  if (pendingJoinName) sendJoin(pendingJoinName);
});

primus.on("data", (data) => {
  if (!data) return;
  if (data.type === "joined") {
    joined = true;
    overlay.classList.add("hidden");
    setChatEnabled(true);
    if (currentName) localStorage.setItem(storageKey, currentName);
    addBubble({ text: `Masuk ke room ${data.roomId}`, system: true });
    return;
  }
  if (data.type === "system") {
    addBubble({ text: data.text, system: true });
    return;
  }
  if (data.type === "history") {
    if (!Array.isArray(data.items)) return;
    data.items.forEach((item) => {
      const isMine = currentName && item.name === currentName;
      addBubble({
        text: item.text,
        direction: isMine ? "outgoing" : "incoming",
        sentAt: item.sentAt,
        receivedAt: item.receivedAt,
        id: item.id,
        sender: item.name,
        messageType: item.messageType || "text",
        fileName: item.fileName,
        fileType: item.fileType,
        fileData: item.fileData,
        filePath: item.filePath,
      });
    });
    return;
  }
  if (data.type === "received") {
    updateState(data.id, data.at);
    return;
  }
  if (data.type === "broadcast") {
    if (data.senderId === clientId) return;
    addBubble({
      text: data.text,
      direction: "incoming",
      receivedAt: data.at,
      sender: data.name || "Anon",
      id: data.id,
      messageType: data.messageType || "text",
      fileName: data.fileName,
      fileType: data.fileType,
      fileData: data.fileData,
      filePath: data.filePath,
    });
  }
});

primus.on("error", (err) => {
  addBubble({ text: err?.message || "Terjadi error", system: true });
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!joined) return;
  const text = input.value.trim();
  if (!text) return;
  const id = crypto.randomUUID();
  const sentAt = new Date().toISOString();
  const bubble = addBubble({
    text,
    direction: "outgoing",
    sentAt,
    id,
    sender: currentName || "Saya",
    messageType: "text",
  });
  bubble.dataset.sentAt = sentAt;
  pendingMap.set(id, bubble);
  primus.write({ type: "message", messageType: "text", text, id, senderId: clientId, sentAt });
  input.value = "";
});

nameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;
  sendJoin(name);
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file || !joined) return;
  if (file.size > 2 * 1024 * 1024) {
    addBubble({ text: "File terlalu besar (maks 2MB)", system: true });
    fileInput.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const fileData = String(reader.result);
    filePreview.innerHTML = "";
    if (file.type.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = fileData;
      img.alt = file.name;
      filePreview.appendChild(img);
    } else {
      const info = document.createElement("div");
      info.textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
      filePreview.appendChild(info);
    }
    fileOverlay.classList.remove("hidden");

    const onCancel = () => {
      fileOverlay.classList.add("hidden");
      fileCaption.value = "";
      fileInput.value = "";
      filePreview.innerHTML = "";
      fileCancel.removeEventListener("click", onCancel);
      fileSend.removeEventListener("click", onSend);
    };

    const onSend = () => {
      const id = crypto.randomUUID();
      const sentAt = new Date().toISOString();
      const caption = fileCaption.value.trim();
      const bubble = addBubble({
        text: caption,
        direction: "outgoing",
        sentAt,
        id,
        sender: currentName || "Saya",
        messageType: "file",
        fileName: file.name,
        fileType: file.type,
        fileData,
      });
      bubble.dataset.sentAt = sentAt;
      pendingMap.set(id, bubble);
      primus.write({
        type: "message",
        messageType: "file",
        id,
        senderId: clientId,
        sentAt,
        text: caption,
        fileName: file.name,
        fileType: file.type,
        fileData,
      });
      onCancel();
    };

    fileCancel.addEventListener("click", onCancel);
    fileSend.addEventListener("click", onSend);
  };
  reader.readAsDataURL(file);
});
