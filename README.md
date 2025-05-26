# Video Convert & Compress Web App with Progress Bar

A simple web app to upload video, convert & compress it to selected format (mp4, mov, webm, avi) with compression percentage, and show realtime progress bar during processing using FFmpeg.

---

## Features

- Upload video via web form
- Pilih output format: MP4, MOV, WebM, AVI
- Pilih tingkat kompresi dalam persen (misal 50% dari ukuran asli)
- Realtime progress bar saat proses convert/compress berjalan
- Informasi ukuran file asli dan hasil kompresi
- Link download hasil video setelah selesai

---

## Stack & Dependencies

- **Node.js**: runtime JavaScript server-side
- **Express**: web framework
- **Multer**: middleware untuk handle file upload
- **FFmpeg**: alat command line untuk proses convert & compress video (harus sudah terinstall di sistem)
- **Server-Sent Events (SSE)**: untuk realtime push progress ke client (frontend)

---

## Prasyarat

- Node.js minimal versi 14+
- FFmpeg terinstall dan bisa diakses via command line (`ffmpeg` dan `ffprobe`)

Untuk install FFmpeg di MacBook M1:

```bash
brew install ffmpeg
```
