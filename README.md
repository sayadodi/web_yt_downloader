# YT Audio

Web app untuk mengubah link YouTube menjadi file audio (MP3 / M4A). Dibuat untuk
deploy di **Vercel Hobby** tanpa database, tanpa queue, dan tanpa penyimpanan
file permanen.

![stack](https://img.shields.io/badge/Next.js-15-black) ![runtime](https://img.shields.io/badge/runtime-Node.js%20(serverless)-green)

## Fitur

- **Satu lagu** — tempel link, lihat metadata, pilih kualitas, unduh.
- **Banyak link** — sampai 20 link sekaligus, diproses 3 paralel, hasil bisa
  diunduh satu per satu atau sebagai satu file ZIP (dibuat di browser).
- **Kualitas dalam kbps** — M4A original, MP3 320/192/128/96. Default MP3 320.
- **Batas durasi 2 jam**, dengan penurunan kualitas otomatis untuk video panjang
  agar request tidak kehabisan waktu di serverless.
- File hanya ada di `/tmp` selama proses berlangsung dan **dihapus segera**
  setelah byte terakhir terkirim.
- Bahasa UI: Indonesia, tema gelap, aksesibel (fokus terlihat, target sentuh
  cukup besar, menghormati `prefers-reduced-motion`).

## Cara kerja

```
Browser ──POST /api/info──────▶ yt-dlp -J  ──▶ metadata + daftar kualitas
Browser ──GET /api/download───▶ yt-dlp + ffmpeg ──▶ stream audio (chunked)
```

- `yt-dlp` **standalone binary** (bukan paket Python) diunduh ke `bin/` saat
  `postinstall`.
- `ffmpeg-static` menyediakan encoder MP3; thumbnail di-embed sebagai cover dan
  metadata ID3 ditulis oleh yt-dlp.
- Progres unduhan dihitung di browser dari `X-Size` / `Content-Length`, jadi
  tidak ada endpoint polling atau SSE.
- ZIP batch dibuat di browser dengan `fflate` (level 0, tanpa kompresi ulang)
  dan dibatasi ±300 MB.

## Menjalankan lokal

```bash
npm install          # sekaligus mengunduh bin/yt-dlp untuk OS kamu
npm run dev          # http://localhost:3000
```

Butuh Node.js 20+. Di Windows, gunakan `npm.cmd` bila PowerShell memblokir
`npm.ps1` karena execution policy.

Perintah lain:

```bash
npm run build        # build produksi
npm start            # jalankan hasil build
npm run fetch:bin    # paksa unduh ulang binary yt-dlp
```

## Deploy ke Vercel 

1. Push repo ini ke GitHub, lalu **Import Project** di Vercel.
2. Framework terdeteksi otomatis (Next.js). Tidak perlu ubah build command:
   `postinstall` akan mengunduh `yt-dlp` versi Linux saat build.
3. Pastikan **Region** = `sin1` (Singapore) — sudah diatur di `vercel.json`
   supaya dekat dengan pengguna Indonesia.
4. Deploy. Tidak ada environment variable yang wajib.

Opsional:

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `YTDLP_PLAYER_CLIENTS` | `default,web_safari` | Daftar `player_client` YouTube, dipisah koma. Ubah bila YouTube menolak request dari IP Vercel. |
| `YOUTUBE_COOKIES_BASE64` | – | Isi file `cookies.txt` (format Netscape) yang di-encode base64. Solusi paling ampuh untuk melewati verifikasi bot di Vercel. |
| `YTDLP_COOKIES_FILE` | – | Path file `cookies.txt` lokal (misal: `./cookies.txt`) untuk pengujian di komputer lokal. |
| `MONTHLY_SONG_LIMIT` | `1200` | Batas kuota unduhan lagu bulanan server (estimasi aman limit CPU Vercel Hobby). |
| `VERCEL_API_TOKEN` | – | Personal Access Token Vercel untuk menarik data live pemakaian CPU & Bandwidth langsung dari akun Vercel. |
| `VERCEL_TEAM_ID` | – | ID Team Vercel (jika project berada di akun tim Vercel). |
| `UPSTASH_REDIS_REST_URL` | – | URL Upstash Redis / Vercel KV untuk sinkronisasi kuota bulanan antar-serverless secara persisten. |
| `UPSTASH_REDIS_REST_TOKEN` | – | Token REST Upstash Redis / Vercel KV. |
| `FORCE_FETCH` | – | Set `1` saat build untuk memaksa unduh ulang binary. |

### Batas yang perlu diketahui

- **Durasi fungsi**: `maxDuration = 300` (batas Hobby). Video panjang butuh
  waktu encode lebih lama, karena itu kualitas tinggi otomatis diturunkan
  (lihat `lib/quality.ts`).
- **CPU**: Hobby memberi ±4 jam CPU/bulan. Satu MP3 320 berdurasi 3–4 menit
  memakai ±20–40 detik CPU, jadi realistis ±1.200–1.500 lagu/bulan.
- **IP datacenter**: YouTube kadang meminta verifikasi bot untuk request dari
  AWS/Vercel. Jika muncul error "YouTube menolak permintaan", coba lagi, atau
  set `YTDLP_PLAYER_CLIENTS` ke kombinasi lain (mis. `web_embedded,android`).
- **Ukuran bundle**: `bin/yt-dlp` ±24 MB ikut ter-trace ke tiap fungsi API
  (`outputFileTracingIncludes` di `next.config.ts`), masih di bawah batas 250 MB.

## Struktur

```
app/
  api/info/route.ts       metadata + daftar kualitas
  api/download/route.ts   eksekusi yt-dlp, streaming hasil, cleanup /tmp
components/               UI (SingleMode, BatchMode, Home, …)
lib/quality.ts            daftar format + aturan durasi
lib/ytdlp.ts              spawn binary, argumen dasar, error mapping
lib/client/               fetch API, progres unduhan, helper format
scripts/fetch-binaries.mjs  unduh yt-dlp sesuai platform
```

## Etika & hukum

Gunakan hanya untuk konten yang kamu miliki atau yang lisensinya
mengizinkan unduhan. Menghormati hak cipta pembuat konten adalah tanggung jawab
pengguna.
