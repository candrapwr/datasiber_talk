# DataSiber Talk

Private room chat berbasis Primus WebSocket dengan histori chat tersimpan di SQLite. Room diakses lewat link, user wajib isi nama sebelum chat. Mendukung emoji picker, kirim file dengan caption, voice note, dan audio call 1‑1 (STUN‑only).

## Fitur Utama
- **Room privat via link**: `?room=...` otomatis dibuat jika belum ada.
- **Nama wajib** sebelum chat.
- **Histori chat server‑side** (SQLite) agar semua user di room melihat histori yang sama.
- **Emoji picker**.
- **Kirim file + caption** (konfirmasi sebelum kirim).
- **Voice note** (rekam audio → preview → kirim).
- **Audio player** langsung di bubble chat.
- **Indikator status** pesan (ikon sent/received) + **read receipts**.
- **Typing indicator**.
- **Daftar anggota + avatar**.
- **Pagination histori** (Load more).
- **New room** dan **clear chat** (hapus pesan + file).
- **Reconnect** otomatis saat jaringan putus.
- **Audio call 1‑1 (STUN‑only)** dengan signaling via Primus.

## Teknologi
- Node.js (ESM)
- Primus (transformer `websockets` + `ws`)
- SQLite (`sqlite3`)
- WebRTC (audio call)

## Struktur Direktori
- `server.js` – server HTTP + Primus + SQLite + upload file.
- `public/` – frontend statis.
- `uploads/` – file upload yang disimpan server (otomatis dibuat).
- `chat.sqlite` – database SQLite (otomatis dibuat).

## Menjalankan Aplikasi
1. Install dependency:
   ```bash
   npm install
   ```
2. Jalankan server:
   ```bash
   npm start
   ```
3. Buka di browser:
   ```
   http://localhost:3000
   ```

## Cara Pakai
1. Buka aplikasi, isi nama.
2. Bagikan link room yang tampil di bar atas.
3. Semua yang membuka link tersebut akan masuk ke room privat yang sama.

## Penyimpanan Histori
- Histori chat disimpan di `chat.sqlite`.
- Saat join, server mengirim histori **50 pesan terakhir**.
- Tombol **Load more** untuk memuat pesan lama.

## Upload File
- File disimpan ke folder `uploads/`.
- Database hanya menyimpan metadata + path file.
- Batas ukuran file: **20MB** (client + server).
- Voice note juga disimpan sebagai file audio (`.webm`).

## Audio Call 1‑1 (STUN‑only)
- Signaling via Primus.
- STUN server: `stun:stun.l.google.com:19302`.
- Tidak ada TURN → beberapa jaringan bisa gagal (NAT ketat).

## Konfigurasi Penting
- **PORT**: default `3000` (bisa override via env `PORT`).
- **MAX_UPLOAD_BYTES** di `server.js`: batas ukuran upload.

## Skema Database (SQLite)
Tabel `messages`:
- `id` (TEXT, PRIMARY KEY)
- `roomId` (TEXT)
- `senderId` (TEXT)
- `name` (TEXT)
- `text` (TEXT)
- `sentAt` (TEXT)
- `receivedAt` (TEXT)
- `messageType` (TEXT) – `text` | `file`
- `fileName` (TEXT)
- `fileType` (TEXT)
- `filePath` (TEXT)

## Alur Data Singkat
1. Client join ke room: kirim `{ type: "join", name, roomId }`.
2. Server kirim `history` + `joined`.
3. Client kirim pesan: `{ type: "message", ... }`.
4. Server:
   - ack `received` ke sender
   - simpan ke SQLite
   - broadcast ke room.

## Catatan Keamanan (Baseline)
Saat ini belum ada autentikasi dan sanitasi file type yang ketat.
Jika akan production:
- Tambah auth/token untuk room.
- Batasi tipe file (whitelist).
- Scan file upload (anti‑malware).
- Simpan file di storage terpisah (S3/MinIO).
- Tambahkan TURN untuk call yang stabil.

## Lisensi
Bebas digunakan untuk pengembangan internal.
