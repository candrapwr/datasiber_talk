# DataSiber Talk

Private room chat berbasis Primus WebSocket dengan histori chat tersimpan di SQLite. Setiap room diakses lewat link, user wajib isi nama sebelum chat. Mendukung emoji picker dan kirim file dengan caption (preview + konfirmasi sebelum kirim).

## Fitur Utama
- **Room privat via link**: `?room=...` otomatis dibuat jika belum ada.
- **Nama wajib** sebelum chat.
- **Histori chat server‑side** (SQLite) agar semua user di room melihat histori yang sama.
- **Emoji picker** sederhana.
- **Kirim file + caption** (konfirmasi sebelum kirim).
- **Indikator status** pesan (ikon sent/received).
- **Typing indicator**.
- **Daftar anggota room + avatar**.
- **Read receipts** per user.
- **Pagination histori** (Load more).

## Teknologi
- Node.js (ESM)
- Primus (transformer `websockets` + `ws`)
- SQLite (`sqlite3`)

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
- Saat join, server mengirim histori **200 pesan terakhir** untuk room tersebut.

## Upload File
- File disimpan ke folder `uploads/`.
- Database hanya menyimpan metadata + path file.
- Batas ukuran file: **2MB** (client + server).

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

## Catatan Fitur Lanjutan
Fitur lanjutan seperti pagination histori, typing indicator, list anggota, avatar, dan read receipts sudah terimplementasi.

---

## Lisensi
Bebas digunakan untuk pengembangan internal.
