const logEl = document.getElementById("log");
const form = document.getElementById("chat-form");
const input = document.getElementById("message");
const overlay = document.getElementById("overlay");
const nameForm = document.getElementById("name-form");
const nameInput = document.getElementById("name-input");
const roomLinkEl = document.getElementById("room-link");
const copyLinkBtn = document.getElementById("copy-link");
const newRoomBtn = document.getElementById("new-room");
const clearRoomBtn = document.getElementById("clear-room");
const membersEl = document.getElementById("members");
const loadMoreBtn = document.getElementById("load-more");
const typingEl = document.getElementById("typing-indicator");
const callOverlay = document.getElementById("call-overlay");
const callFrom = document.getElementById("call-from");
const callAccept = document.getElementById("call-accept");
const callReject = document.getElementById("call-reject");
const callBar = document.getElementById("call-bar");
const callStatus = document.getElementById("call-status");
const callEnd = document.getElementById("call-end");
const callQuality = document.getElementById("call-quality");
const callSwitchCamera = document.getElementById("call-switch-camera");
const callMute = document.getElementById("call-mute");
const callBlur = document.getElementById("call-blur");
const callVideo = document.getElementById("call-video");
const localVideo = document.getElementById("local-video");
const remoteVideo = document.getElementById("remote-video");
const remoteAudio = document.getElementById("remote-audio");
const toolBtn = document.getElementById("tool-btn");
const toolPanel = document.getElementById("tool-panel");
const emojiBtn = document.getElementById("emoji-btn");
const emojiPanel = document.getElementById("emoji-panel");
const fileBtn = document.getElementById("file-btn");
const fileInput = document.getElementById("file-input");
const voiceBtn = document.getElementById("voice-btn");
const recordingIndicator = document.getElementById("recording-indicator");
const fileOverlay = document.getElementById("file-overlay");
const filePreview = document.getElementById("file-preview");
const fileCaption = document.getElementById("file-caption");
const fileCancel = document.getElementById("file-cancel");
const fileSend = document.getElementById("file-send");
function createId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const rand = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  return `${rand()}${rand()}${Date.now().toString(16)}`;
}

const clientId = createId();
const pendingMap = new Map();
const messageMap = new Map();
const readBy = new Map();
const typingUsers = new Map();
let isOpen = false;
let joined = false;
let pendingJoinName = null;
let currentName = null;
let nextBefore = null;
let typingTimer = null;
let isTyping = false;
let lastReadSent = 0;
let pendingFile = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let callState = "idle";
let callPeerId = null;
let callPeerName = null;
let callPc = null;
let callOffer = null;
let localStream = null;
let callType = "audio";
let currentFacingMode = "user";
let isMuted = false;
let videoDeviceIds = [];
let currentVideoDeviceId = null;
let isBlurred = false;
let ringtoneContext = null;
let ringtoneTimer = null;
let ringtoneOsc = null;
let ringtoneGain = null;

function formatTime(iso) {
  const date = iso ? new Date(iso) : new Date();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  const micros = "000";
  return `${hh}:${mm}:${ss}.${ms}${micros}`;
}

function nameToInitials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || "";
  const second = parts.length > 1 ? parts[1]?.[0] : "";
  return (first + second).toUpperCase() || "?";
}

function nameToColor(name = "") {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 360;
  }
  return `hsl(${hash}, 70%, 70%)`;
}

function isAudioFile(fileType, fileName) {
  if (fileType && fileType.startsWith("audio/")) return true;
  if (!fileName) return false;
  return /\.(webm|wav|mp3|ogg|m4a)$/i.test(fileName);
}

function isAtBottom() {
  return logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
}

function getLatestRowId() {
  let max = 0;
  messageMap.forEach((bubble) => {
    const rowId = Number(bubble.dataset.rowId || 0);
    if (rowId > max) max = rowId;
  });
  return max || null;
}

function sendRead(rowId) {
  if (!rowId || rowId <= lastReadSent) return;
  lastReadSent = rowId;
  readBy.set(clientId, rowId);
  updateSeenIndicators();
  primus.write({ type: "read", rowId });
}

function updateSeenIndicators() {
  messageMap.forEach((bubble) => {
    if (bubble.dataset.direction !== "outgoing") return;
    const rowId = Number(bubble.dataset.rowId || 0);
    if (!rowId) return;
    let count = 0;
    readBy.forEach((lastRowId, userId) => {
      if (userId === clientId) return;
      if (lastRowId >= rowId) count += 1;
    });
    const seenEl = bubble.querySelector(".seen");
    if (!seenEl) return;
    seenEl.style.display = count > 0 ? "inline-flex" : "none";
    seenEl.title = count > 0 ? `Dibaca oleh ${count} pengguna` : "";
    const badge = seenEl.querySelector(".seen-count");
    if (badge) badge.textContent = String(count);
  });
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
  rowId,
  prepend,
}) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${system ? "system" : direction}`;
  if (id) bubble.dataset.id = id;
  if (sentAt) bubble.dataset.sentAt = sentAt;
  if (rowId) bubble.dataset.rowId = rowId;
  if (direction) bubble.dataset.direction = direction;

  const displaySender = sender || (direction === "outgoing" && !system ? "Saya" : "");
  if (displaySender) {
    const header = document.createElement("div");
    header.className = "bubble-header";
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = nameToInitials(displaySender);
    avatar.style.background = nameToColor(displaySender);
    header.appendChild(avatar);
    const senderEl = document.createElement("div");
    senderEl.className = "sender";
    senderEl.textContent = displaySender;
    header.appendChild(senderEl);
    bubble.appendChild(header);
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
    if (isAudioFile(fileType, fileName) && fileUrl) {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = fileUrl;
      audio.style.width = "100%";
      audio.style.display = "block";
      audio.style.marginTop = "6px";
      content.appendChild(audio);
    }
    if (text) {
      const caption = document.createElement("div");
      caption.textContent = text;
      caption.style.marginTop = "8px";
      content.appendChild(caption);
    }
    if (!isAudioFile(fileType, fileName)) {
      const link = document.createElement("a");
      link.href = fileUrl || "#";
      link.download = fileName || "file";
      link.textContent = fileName || "Download file";
      link.style.color = "#c6f2e3";
      link.style.display = "inline-block";
      link.style.marginTop = "6px";
      content.appendChild(link);
    }
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

    if (direction === "outgoing") {
      const seen = document.createElement("span");
      seen.className = "seen";
      seen.style.display = "none";
      const dot = document.createElement("span");
      dot.className = "seen-dot";
      const count = document.createElement("span");
      count.className = "seen-count";
      count.textContent = "0";
      seen.appendChild(dot);
      seen.appendChild(count);
      meta.appendChild(seen);
    }

    bubble.appendChild(meta);
  }

  if (prepend) {
    logEl.insertBefore(bubble, loadMoreBtn.nextSibling);
  } else {
    const stickToBottom = isAtBottom();
    logEl.appendChild(bubble);
    if (stickToBottom) logEl.scrollTop = logEl.scrollHeight;
  }
  if (id) messageMap.set(id, bubble);
  updateSeenIndicators();
  return bubble;
}

function updateState(id, receivedAt, rowId) {
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
  if (rowId) bubble.dataset.rowId = rowId;
  messageMap.set(id, bubble);
  updateSeenIndicators();
}

const primus = new Primus();

function getRoomId() {
  const url = new URL(window.location.href);
  let roomId = url.searchParams.get("room");
  if (!roomId) {
    roomId = generateRoomId();
    url.searchParams.set("room", roomId);
    window.history.replaceState({}, "", url.toString());
  }
  return roomId;
}

function generateRoomId() {
  const id = createId();
  return id.slice(0, 8);
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

newRoomBtn.addEventListener("click", () => {
  const url = new URL(window.location.href);
  const newId = generateRoomId();
  url.searchParams.set("room", newId);
  window.location.href = url.toString();
});

clearRoomBtn.addEventListener("click", () => {
  if (!joined) return;
  const ok = confirm("Hapus semua chat di room ini? Ini juga akan menghapus file/voice.");
  if (!ok) return;
  primus.write({ type: "clear_room" });
});

loadMoreBtn.addEventListener("click", () => {
  if (!nextBefore) return;
  primus.write({ type: "history", beforeRowId: nextBefore });
});

callAccept.addEventListener("click", () => {
  acceptCall();
});

callReject.addEventListener("click", () => {
  if (callPeerId) primus.write({ type: "call_reject", to: callPeerId });
  resetCall();
});

callEnd.addEventListener("click", () => {
  if (callPeerId) primus.write({ type: "call_end", to: callPeerId });
  resetCall();
});

callQuality.addEventListener("change", () => {
  if (callState === "in-call") updateVideoQuality();
});

callSwitchCamera.addEventListener("click", () => {
  switchCamera();
});

callMute.addEventListener("click", () => {
  if (!localStream) return;
  isMuted = !isMuted;
  updateMuteState();
});

callBlur.addEventListener("click", () => {
  if (callType !== "video") return;
  isBlurred = !isBlurred;
  updateBlurState();
  if (callPeerId) {
    primus.write({ type: "call_blur", to: callPeerId, enabled: isBlurred });
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
    toolPanel.classList.add("hidden");
  });
  emojiPanel.appendChild(btn);
});

toolBtn.addEventListener("click", () => {
  toolPanel.classList.toggle("hidden");
  if (!emojiPanel.classList.contains("hidden")) {
    emojiPanel.classList.add("hidden");
  }
});

emojiBtn.addEventListener("click", () => {
  emojiPanel.classList.toggle("hidden");
});

fileBtn.addEventListener("click", () => {
  toolPanel.classList.add("hidden");
  fileInput.click();
});

voiceBtn.addEventListener("click", async () => {
  if (!joined) return;
  toolPanel.classList.add("hidden");
  if (isRecording) {
    mediaRecorder.stop();
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("Browser tidak mendukung rekam suara.");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    isRecording = true;
    voiceBtn.textContent = "⏹️";
    recordingIndicator.classList.remove("hidden");

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) audioChunks.push(event.data);
    });

    mediaRecorder.addEventListener("stop", () => {
      isRecording = false;
      voiceBtn.textContent = "🎤";
      recordingIndicator.classList.add("hidden");
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      const fileName = `voice-${Date.now()}.webm`;
      const reader = new FileReader();
      reader.onload = () => {
        const fileData = String(reader.result);
        openFileOverlay({
          fileName,
          fileType: blob.type || "audio/webm",
          fileData,
          fileSize: blob.size,
        });
      };
      reader.readAsDataURL(blob);
      stream.getTracks().forEach((track) => track.stop());
    });

    mediaRecorder.start();
  } catch {
    alert("Gagal akses mikrofon.");
  }
});

function setChatEnabled(enabled) {
  input.disabled = !enabled;
  form.querySelector("button").disabled = !enabled;
}

setChatEnabled(false);
loadMoreBtn.style.display = "none";

function resetFileOverlay() {
  pendingFile = null;
  fileOverlay.classList.add("hidden");
  fileCaption.value = "";
  fileInput.value = "";
  filePreview.innerHTML = "";
}

function renderFilePreview(fileInfo) {
  filePreview.innerHTML = "";
  if (!fileInfo) return;
  if (fileInfo.fileType && fileInfo.fileType.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = fileInfo.fileData;
    img.alt = fileInfo.fileName;
    filePreview.appendChild(img);
    return;
  }
  if (fileInfo.fileType && fileInfo.fileType.startsWith("audio/")) {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = fileInfo.fileData;
    audio.style.width = "100%";
    filePreview.appendChild(audio);
    return;
  }
  const info = document.createElement("div");
  info.textContent = `${fileInfo.fileName} (${Math.round((fileInfo.fileSize || 0) / 1024)} KB)`;
  filePreview.appendChild(info);
}

function openFileOverlay(fileInfo) {
  pendingFile = fileInfo;
  renderFilePreview(fileInfo);
  fileOverlay.classList.remove("hidden");
}

function renderMembers(members = []) {
  membersEl.innerHTML = "";
  members.forEach((member) => {
    const chip = document.createElement("span");
    chip.className = "member-chip";
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = nameToInitials(member.name);
    avatar.style.background = nameToColor(member.name);
    const nameEl = document.createElement("span");
    nameEl.textContent = member.name;
    const callBtn = document.createElement("button");
    callBtn.className = "member-call";
    callBtn.textContent = "📞";
    callBtn.title = "Panggil";
    callBtn.addEventListener("click", () => {
      startCall(member.id, member.name, "audio");
    });
    const videoBtn = document.createElement("button");
    videoBtn.className = "member-call";
    videoBtn.textContent = "🎥";
    videoBtn.title = "Video call";
    videoBtn.addEventListener("click", () => {
      startCall(member.id, member.name, "video");
    });
    chip.appendChild(avatar);
    chip.appendChild(nameEl);
    if (member.id !== clientId) {
      chip.appendChild(callBtn);
      chip.appendChild(videoBtn);
    }
    membersEl.appendChild(chip);
  });
}

function renderTyping() {
  const names = Array.from(typingUsers.values()).filter(Boolean);
  if (names.length === 0) {
    typingEl.classList.add("hidden");
    typingEl.textContent = "";
    return;
  }
  typingEl.classList.remove("hidden");
  typingEl.textContent =
    names.length === 1
      ? `${names[0]} sedang mengetik...`
      : `${names.slice(0, 2).join(", ")}${names.length > 2 ? "..." : ""} sedang mengetik...`;
}

function renderHistory(items = [], prepend = false) {
  if (!Array.isArray(items) || items.length === 0) return;
  const prevHeight = logEl.scrollHeight;
  const prevTop = logEl.scrollTop;
  items.forEach((item) => {
    if (item.id && messageMap.has(item.id)) return;
    const isMine = item.senderId === clientId || (currentName && item.name === currentName);
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
      rowId: item.rowId,
      prepend,
    });
  });
  if (prepend) {
    const diff = logEl.scrollHeight - prevHeight;
    logEl.scrollTop = prevTop + diff;
  }
}

function updateCallUI() {
  if (callState === "idle") {
    callBar.classList.remove("active");
    callStatus.textContent = "";
    callVideo.classList.remove("active");
    callVideo.classList.remove("local-only");
    callQuality.style.display = "none";
    callSwitchCamera.style.display = "none";
    callBlur.style.display = "none";
    return;
  }
  callBar.classList.add("active");
  if (callState === "calling") {
    callStatus.textContent = `Memanggil ${callPeerName || "user"}...`;
  } else if (callState === "ringing") {
    callStatus.textContent = "Berdering...";
  } else if (callState === "in-call") {
    callStatus.textContent = `Panggilan dengan ${callPeerName || "user"}`;
  }
  if (callType === "video") {
    callVideo.classList.add("active");
    callQuality.style.display = "inline-flex";
    callSwitchCamera.style.display = "inline-flex";
    callBlur.style.display = "inline-flex";
  } else {
    callVideo.classList.remove("active");
    callQuality.style.display = "none";
    callSwitchCamera.style.display = "none";
    callBlur.style.display = "none";
  }
}

function resetCall() {
  callState = "idle";
  callPeerId = null;
  callPeerName = null;
  callOffer = null;
  callType = "audio";
  isMuted = false;
  isBlurred = false;
  stopRingtone();
  if (callPc) {
    callPc.onicecandidate = null;
    callPc.ontrack = null;
    callPc.close();
    callPc = null;
  }
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
  if (remoteAudio) remoteAudio.srcObject = null;
  if (remoteVideo) remoteVideo.srcObject = null;
  if (localVideo) localVideo.srcObject = null;
  callOverlay.classList.add("hidden");
  updateCallUI();
  updateMuteState();
  updateBlurState();
}

function getVideoConstraints() {
  const quality = callQuality?.value || "low";
  if (quality === "medium") {
    return {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 24 },
      facingMode: currentFacingMode,
    };
  }
  return {
    width: { ideal: 640 },
    height: { ideal: 360 },
    frameRate: { ideal: 15 },
    facingMode: currentFacingMode,
  };
}

function getMediaConstraints(type) {
  if (type === "video") {
    const video = currentVideoDeviceId
      ? { deviceId: { exact: currentVideoDeviceId }, ...getVideoConstraints() }
      : getVideoConstraints();
    return { audio: true, video };
  }
  return { audio: true, video: false };
}

async function loadVideoDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  videoDeviceIds = devices.filter((d) => d.kind === "videoinput").map((d) => d.deviceId);
  if (!currentVideoDeviceId && videoDeviceIds.length > 0) {
    currentVideoDeviceId = videoDeviceIds[0];
  }
}

async function createPeerConnection(targetId) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.datasiber.com:8080" },
      { urls: "turn:stun.datasiber.com:8080", username: "stun", credential: "StunIniBro.." },
    ],
  });
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      primus.write({ type: "call_ice", to: targetId, candidate: event.candidate });
    }
  };
  pc.ontrack = (event) => {
    const stream = event.streams[0];
    if (callType === "video") {
      if (remoteVideo) {
        remoteVideo.srcObject = stream;
        remoteVideo.play().catch(() => {});
        callVideo.classList.remove("local-only");
      }
    } else if (remoteAudio) {
      remoteAudio.srcObject = stream;
      remoteAudio.play().catch(() => {});
    }
  };
  return pc;
}

async function startCall(targetId, targetName, type = "audio") {
  if (!joined || callState !== "idle") return;
  callPeerId = targetId;
  callPeerName = targetName;
  callType = type;
  callState = "calling";
  updateCallUI();
  if (type === "video") {
    isBlurred = true;
    updateBlurState();
  }
  startRingtone();
  try {
    await loadVideoDevices();
    localStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints(type));
    callPc = await createPeerConnection(targetId);
    localStream.getTracks().forEach((track) => callPc.addTrack(track, localStream));
    if (type === "video" && localVideo) {
      localVideo.srcObject = localStream;
      localVideo.play().catch(() => {});
      callVideo.classList.add("local-only");
    }
    updateMuteState();
    updateBlurState();
    const offer = await callPc.createOffer();
    await callPc.setLocalDescription(offer);
    primus.write({ type: "call_offer", to: targetId, sdp: offer, callType: type });
    if (callType === "video" && isBlurred) {
      primus.write({ type: "call_blur", to: targetId, enabled: true });
    }
  } catch {
    resetCall();
  }
}

async function acceptCall() {
  if (!callOffer || !callPeerId) return;
  callOverlay.classList.add("hidden");
  callState = "in-call";
  updateCallUI();
  stopRingtone();
  if (callType === "video") {
    isBlurred = true;
    updateBlurState();
  }
  try {
    await loadVideoDevices();
    localStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints(callType));
    callPc = await createPeerConnection(callPeerId);
    localStream.getTracks().forEach((track) => callPc.addTrack(track, localStream));
    if (callType === "video" && localVideo) {
      localVideo.srcObject = localStream;
      localVideo.play().catch(() => {});
      callVideo.classList.add("local-only");
    }
    updateMuteState();
    updateBlurState();
    await callPc.setRemoteDescription(callOffer);
    const answer = await callPc.createAnswer();
    await callPc.setLocalDescription(answer);
    primus.write({ type: "call_answer", to: callPeerId, sdp: answer, callType });
    if (callType === "video" && isBlurred) {
      primus.write({ type: "call_blur", to: callPeerId, enabled: true });
    }
    if (callType === "audio" && remoteAudio) remoteAudio.play().catch(() => {});
  } catch {
    resetCall();
  }
}

async function updateVideoQuality() {
  await replaceVideoTrack();
}

async function switchCamera() {
  if (callType !== "video" || callState !== "in-call") return;
  await loadVideoDevices();
  if (videoDeviceIds.length > 1) {
    const idx = Math.max(0, videoDeviceIds.indexOf(currentVideoDeviceId));
    const nextIdx = (idx + 1) % videoDeviceIds.length;
    currentVideoDeviceId = videoDeviceIds[nextIdx];
    await replaceVideoTrack();
    return;
  }
  currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
  await replaceVideoTrack();
}

async function replaceVideoTrack() {
  if (callType !== "video" || !callPc || !localStream) return;
  try {
    const sender = callPc.getSenders().find((s) => s.track && s.track.kind === "video");
    if (!sender) return;
    let videoStream = null;
    try {
      const video = currentVideoDeviceId
        ? { deviceId: { exact: currentVideoDeviceId }, ...getVideoConstraints() }
        : getVideoConstraints();
      videoStream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
    } catch {
      videoStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    }
    const newTrack = videoStream.getVideoTracks()[0];
    if (!newTrack) return;
    await sender.replaceTrack(newTrack);
    const oldTrack = localStream.getVideoTracks()[0];
    if (oldTrack) {
      localStream.removeTrack(oldTrack);
      oldTrack.stop();
    }
    localStream.addTrack(newTrack);
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.play().catch(() => {});
    }
  } catch {}
}

function updateMuteState() {
  if (!localStream) return;
  localStream.getAudioTracks().forEach((track) => {
    track.enabled = !isMuted;
  });
  callMute.textContent = isMuted ? "🔇" : "🔊";
  callMute.title = isMuted ? "Unmute" : "Mute";
}

function updateBlurState() {
  callBlur.textContent = isBlurred ? "😶‍🌫️" : "🫥";
  callBlur.title = isBlurred ? "Unblur" : "Blur";
  if (localVideo) {
    if (isBlurred) localVideo.classList.add("blur");
    else localVideo.classList.remove("blur");
  }
}

function startRingtone() {
  if (ringtoneContext) return;
  try {
    ringtoneContext = new (window.AudioContext || window.webkitAudioContext)();
    ringtoneGain = ringtoneContext.createGain();
    ringtoneGain.gain.value = 0.08;
    ringtoneGain.connect(ringtoneContext.destination);
    const beep = () => {
      ringtoneOsc = ringtoneContext.createOscillator();
      ringtoneOsc.type = "sine";
      ringtoneOsc.frequency.value = 800;
      ringtoneOsc.connect(ringtoneGain);
      ringtoneOsc.start();
      setTimeout(() => {
        try {
          ringtoneOsc.stop();
        } catch {}
      }, 300);
    };
    beep();
    ringtoneTimer = setInterval(beep, 1200);
  } catch {}
}

function stopRingtone() {
  if (ringtoneTimer) clearInterval(ringtoneTimer);
  ringtoneTimer = null;
  if (ringtoneOsc) {
    try {
      ringtoneOsc.stop();
    } catch {}
  }
  ringtoneOsc = null;
  if (ringtoneContext) {
    try {
      ringtoneContext.close();
    } catch {}
  }
  ringtoneContext = null;
}

function sendJoin(name) {
  if (!name) return;
  pendingJoinName = name;
  currentName = name;
  if (!isOpen) return;
  primus.write({ type: "join", name, roomId, userId: clientId });
}

primus.on("open", () => {
  isOpen = true;
  // system message hidden
  if (pendingJoinName) sendJoin(pendingJoinName);
});

primus.on("reconnect", () => {
  isOpen = true;
  joined = false;
  setChatEnabled(false);
  if (pendingJoinName) sendJoin(pendingJoinName);
});

primus.on("reconnecting", () => {
  isOpen = false;
  joined = false;
  setChatEnabled(false);
});

primus.on("end", () => {
  isOpen = false;
  joined = false;
  setChatEnabled(false);
});

primus.on("close", () => {
  isOpen = false;
  joined = false;
  setChatEnabled(false);
});

primus.on("data", async (data) => {
  if (!data) return;
  if (data.type === "joined") {
    joined = true;
    overlay.classList.add("hidden");
    setChatEnabled(true);
    if (currentName) localStorage.setItem(storageKey, currentName);
    // system message hidden
    return;
  }
  if (data.type === "members") {
    renderMembers(data.members || []);
    typingUsers.forEach((_, userId) => {
      if (!data.members?.some((member) => member.id === userId)) typingUsers.delete(userId);
    });
    const memberIds = new Set((data.members || []).map((member) => member.id));
    readBy.forEach((_, userId) => {
      if (userId !== clientId && !memberIds.has(userId)) readBy.delete(userId);
    });
    renderTyping();
    updateSeenIndicators();
    return;
  }
  if (data.type === "cleared") {
    messageMap.clear();
    pendingMap.clear();
    readBy.clear();
    typingUsers.clear();
    nextBefore = null;
    loadMoreBtn.style.display = "none";
    logEl.querySelectorAll(".bubble").forEach((el) => el.remove());
    return;
  }
  if (data.type === "system") {
    return;
  }
  if (data.type === "call_offer") {
    if (callState !== "idle") {
      primus.write({ type: "call_busy", to: data.from });
      return;
    }
    callPeerId = data.from;
    callPeerName = data.name || "Anon";
    callType = data.callType || "audio";
    callOffer = data.sdp;
    callState = "ringing";
    updateCallUI();
    startRingtone();
    callFrom.textContent = `${callPeerName} sedang memanggil (${callType})`;
    callOverlay.classList.remove("hidden");
    return;
  }
  if (data.type === "call_blur") {
    if (remoteVideo) {
      if (data.enabled) remoteVideo.classList.add("blur");
      else remoteVideo.classList.remove("blur");
    }
    return;
  }
  if (data.type === "call_answer") {
    if (!callPc) return;
    await callPc.setRemoteDescription(data.sdp);
    callState = "in-call";
    stopRingtone();
    updateCallUI();
    return;
  }
  if (data.type === "call_ice") {
    if (!callPc || !data.candidate) return;
    try {
      await callPc.addIceCandidate(data.candidate);
    } catch {}
    return;
  }
  if (data.type === "call_reject") {
    resetCall();
    return;
  }
  if (data.type === "call_busy") {
    resetCall();
    return;
  }
  if (data.type === "call_end") {
    resetCall();
    return;
  }
  if (data.type === "history") {
    const initial = messageMap.size === 0;
    renderHistory(data.items || [], !initial);
    if (initial) logEl.scrollTop = logEl.scrollHeight;
    nextBefore = data.nextBefore || null;
    loadMoreBtn.style.display = nextBefore ? "block" : "none";
    if (initial) {
      const latest = getLatestRowId();
      if (latest) sendRead(latest);
    }
    return;
  }
  if (data.type === "typing") {
    if (data.userId === clientId) return;
    if (data.isTyping) typingUsers.set(data.userId, data.name || "Anon");
    else typingUsers.delete(data.userId);
    renderTyping();
    return;
  }
  if (data.type === "read") {
    readBy.set(data.userId, data.rowId || 0);
    updateSeenIndicators();
    return;
  }
  if (data.type === "received") {
    updateState(data.id, data.at, data.rowId);
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
      rowId: data.rowId,
    });
    if (isAtBottom()) {
      const latest = getLatestRowId();
      sendRead(latest);
    }
  }
});

primus.on("error", (err) => {
  // system message hidden
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  toolPanel.classList.add("hidden");
  if (!joined) return;
  const text = input.value.trim();
  if (!text) return;
  const id = createId();
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
  if (isTyping) {
    isTyping = false;
    primus.write({ type: "typing", isTyping: false });
  }
  input.value = "";
});

nameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;
  sendJoin(name);
});

input.addEventListener("input", () => {
  if (!joined) return;
  if (!isTyping) {
    isTyping = true;
    primus.write({ type: "typing", isTyping: true });
  }
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    isTyping = false;
    primus.write({ type: "typing", isTyping: false });
  }, 1200);
});

logEl.addEventListener("scroll", () => {
  if (!joined) return;
  if (isAtBottom()) {
    const latest = getLatestRowId();
    sendRead(latest);
  }
});

window.addEventListener("focus", () => {
  if (!joined) return;
  const latest = getLatestRowId();
  if (latest) sendRead(latest);
});

window.addEventListener("beforeunload", () => {
  if (callPeerId) {
    try {
      primus.write({ type: "call_end", to: callPeerId });
    } catch {}
  }
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file || !joined) return;
  if (file.size > 20 * 1024 * 1024) {
    // system message hidden
    fileInput.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const fileData = String(reader.result);
    openFileOverlay({
      fileName: file.name,
      fileType: file.type,
      fileData,
      fileSize: file.size,
    });
  };
  reader.readAsDataURL(file);
});

fileCancel.addEventListener("click", () => {
  resetFileOverlay();
});

fileSend.addEventListener("click", () => {
  if (!pendingFile) return;
  const id = createId();
  const sentAt = new Date().toISOString();
  const caption = fileCaption.value.trim();
  const bubble = addBubble({
    text: caption,
    direction: "outgoing",
    sentAt,
    id,
    sender: currentName || "Saya",
    messageType: "file",
    fileName: pendingFile.fileName,
    fileType: pendingFile.fileType,
    fileData: pendingFile.fileData,
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
    fileName: pendingFile.fileName,
    fileType: pendingFile.fileType,
    fileData: pendingFile.fileData,
  });
  resetFileOverlay();
});
