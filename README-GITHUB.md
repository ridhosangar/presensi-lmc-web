# Presensi LMC — Web (iPhone)

Halaman web khusus **Presensi Masuk / Pulang** untuk karyawan pakai iPhone (Safari).

## Hosting di GitHub Pages (gratis)

1. Buat repo baru di GitHub, misalnya `presensi-lmc-web`
2. Upload **semua isi folder ini** (`web-presensi/`) ke root repo:
   - index.html
   - app.js
   - config.js
   - styles.css
   - manifest.json
   - mobilefacenet.tflite
3. Repo → **Settings** → **Pages**
4. Source: **Deploy from a branch** → branch `main` → folder `/ (root)` → Save
5. Tunggu 1–2 menit. URL contoh:
   `https://USERNAME.github.io/presensi-lmc-web/`

## Di iPhone

1. Buka URL tersebut di **Safari**
2. Share → **Add to Home Screen** (opsional, biar seperti app)
3. Login akun **karyawan** → Presensi Masuk / Pulang
4. Izinkan **Kamera** dan **Lokasi**

## Catatan

- Admin / developer tetap pakai app **Android**
- Backend = Supabase yang sama dengan Android
- Model wajah `mobilefacenet.tflite` harus ikut di-upload (jangan dihapus)
- Jika face model gagal di Safari lama, update iOS / coba lagi

## Ubah URL Supabase

Edit `config.js` jika project Supabase berganti.
