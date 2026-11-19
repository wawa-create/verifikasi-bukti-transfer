# Verifikasi Bukti Transfer — GitHub Pages

## Fitur
- OCR gambar bukti transfer di browser menggunakan Tesseract.js.
- Membaca empat kolom: waktu transaksi, bank penerima, nominal, dan nomor referensi.
- Pemeriksaan indikasi duplikasi berdasarkan:
  1. hash SHA-256 gambar yang identik;
  2. nomor referensi yang sama;
  3. kombinasi nominal + bank penerima + waktu (ditandai "Perlu diperiksa", bukan langsung dianggap duplikat).
- Koreksi manual hasil OCR.
- Ekspor hasil ke Excel.
- Riwayat lokal menggunakan localStorage.

## Menjalankan melalui GitHub Pages
1. Buat repository GitHub baru.
2. Unggah `index.html`, `style.css`, dan `app.js` ke root repository.
3. Buka **Settings → Pages**.
4. Pada **Build and deployment**, pilih **Deploy from a branch**.
5. Pilih branch `main`, folder `/ (root)`, lalu Save.
6. Buka URL GitHub Pages yang diberikan GitHub. Jalankan lewat HTTPS (bukan membuka file HTML langsung).

## Batasan penting
- OCR menggunakan model bahasa Inggris (`eng`) agar pemuatan lebih ringan. Teks Indonesia tetap dapat terbaca, tetapi variasi desain dan kualitas gambar dapat memengaruhi hasil. Angka, nama bank, dan nomor referensi wajib diperiksa.
- Parser saat ini generik. Untuk meningkatkan akurasi, perlu disesuaikan dengan contoh bukti transfer dari bank-bank yang benar-benar digunakan.
- `localStorage` hanya menyimpan riwayat pada browser/perangkat yang sama. Ini TIDAK membuat database pusat dan tidak dapat membandingkan unggahan dari cabang/perangkat lain.
- Untuk pemeriksaan lintas cabang/perangkat diperlukan backend/API dan database bersama (misalnya Supabase/Firebase dengan aturan akses yang benar). Jangan menaruh secret key di kode GitHub Pages.
- Data bukti transfer adalah data transaksi. Gunakan gambar uji yang sudah disamarkan saat mengembangkan aplikasi; jangan mengunggah bukti asli ke repository publik.

## Cara kerja deteksi
- SHA-256 sama: file gambar identik.
- Nomor referensi sama: indikasi sangat kuat bukti/transaksi pernah tercatat.
- Nominal + bank penerima + waktu sama: hanya peringatan untuk pemeriksaan manual karena dua transaksi berbeda bisa saja memiliki nilai/waktu yang mirip.
- Sistem tidak menyimpulkan penipuan; keputusan akhir tetap melalui pemeriksaan petugas.
