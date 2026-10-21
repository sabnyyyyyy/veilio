# VEILIO — Paket Dokumentasi Video Promosi

**Bahasa:** Indonesia
**Tujuan:** Sumber fakta dan materi siap produksi untuk video promosi VEILIO.
**Audiens:** Pembeli, penjual, penyedia jasa, developer, dan pembuat agent AI.
**Status produk:** Testnet/devnet; cakupan fitur berbeda menurut jaringan.

> Dokumen ini menjelaskan kemampuan yang tercatat di repository. Cocokkan kembali UI, alamat deployment, dan status transaksi dengan environment yang akan direkam. Jangan mengubah materi ini menjadi klaim audit atau jaminan hasil.

## Ringkasan produk

**VEILIO adalah marketplace testnet untuk aset digital dan jasa profesional, tempat manusia dan software agent dapat menemukan listing, bernegosiasi, melakukan bid, serta menyelesaikan transaksi melalui alur escrow.**

VEILIO memiliki dua pasar:

- **Aset digital:** penjual mencantumkan dataset atau file digital. Pembeli mengajukan sealed bid. Pemenang memeriksa aset sebelum menerima atau menggunakan jalur sengketa yang tersedia.
- **Jasa:** penyedia mencantumkan lingkup pekerjaan, harga, dan ketentuan. Pembeli berdiskusi, menyepakati pekerjaan, mendanai escrow, lalu meninjau hasil sebelum melepas pembayaran atau menggunakan jalur penyelesaian yang tersedia.

Produk meliputi aplikasi marketplace, smart contract/program on-chain, API, TypeScript SDK veilioexchange, dan paket terpisah veilio-agent-tools untuk aksi bidder dan buyer service.

## Masalah dan manfaat

- Nilai bid tidak langsung dibuka kepada peserta lain sebelum fase reveal.
- Aset digital dapat diperiksa pemenang sebelum penerimaan sesuai aturan listing dan kontrak.
- Escrow jasa menahan dana sesuai status order sampai pembeli meninjau delivery.
- Aktivitas transaksi yang ditulis on-chain dapat diperiksa pada jaringan terkait.
- Developer bisa menghubungkan SDK, REST API, dan tool schema ke aplikasi atau agent.

VEILIO tidak menjamin kebenaran listing, kualitas dataset, keberhasilan hasil kerja, atau keputusan sengketa tertentu.

## Pengguna utama

| Pengguna | Alur yang ditunjukkan |
| --- | --- |
| Penjual aset | Membuat listing, menetapkan harga awal dan jendela bid, lalu memantau inspeksi dan settlement |
| Pembeli aset | Memeriksa syarat, mengirim sealed bid, melakukan reveal, lalu memeriksa aset jika menang |
| Penyedia jasa | Menerbitkan listing, berkomunikasi dengan buyer, mengirim hasil, dan menerima pembayaran setelah escrow dilepas |
| Pembeli jasa | Menyepakati lingkup, mendanai escrow, meninjau hasil, menyetujui, meminta revisi, atau menempuh jalur sengketa |
| Developer/agent builder | Memakai SDK/API dan tool agent, dengan wallet signing, penyimpanan secret, dan persetujuan ditangani aplikasi integrator |

## Alur video: lelang aset digital

1. Penjual menyiapkan aset dan metadata listing.
2. Penjual membuat listing dengan harga awal dan durasi commit, reveal, serta inspeksi.
3. Pembeli memeriksa listing dan menyiapkan bid serta secret secara lokal.
4. Pembeli mengirim commitment dan deposit ke chain.
5. Ketika jendela reveal terbuka, pembeli mengungkap bid menggunakan secret yang disimpan.
6. Lelang diselesaikan sesuai aturan kontrak.
7. Pemenang memeriksa aset, lalu menerima atau memakai jalur sengketa yang tersedia.
8. Refund atau pembayaran mengikuti status dan aturan kontrak.

**Batas privasi:** commit-reveal menyembunyikan nilai bid sampai reveal. Wallet bidder dan deposit tetap publik. Ini bukan zero-knowledge proof. Secret bid harus disimpan aman; jika hilang, bid mungkin tidak bisa di-reveal.

## Alur video: pembelian jasa

1. Penyedia menerbitkan listing jasa.
2. Pembeli menemukan listing dan membuka percakapan.
3. Kedua pihak menyepakati lingkup, harga, dan tenggat.
4. Pembeli menerima permintaan pembayaran lalu mendanai order melalui escrow.
5. Penyedia mengirim delivery reference.
6. Pembeli meninjau hasil, lalu menyetujui pembayaran, meminta revisi, atau memakai jalur sengketa/refund yang tersedia.

Percakapan dan sebagian status aplikasi berada off-chain; dana dan transisi escrow terkait berada on-chain. Transaksi kontrak dan sinkronisasi status API adalah dua operasi terpisah.

## Alur video: agent buyer/bidder

1. Developer menghubungkan veilio-agent-tools ke SDK dan memilih satu jaringan per toolset.
2. Agent membaca listing atau status yang diizinkan.
3. Agent menyiapkan aksi dan menunjukkan ringkasan kepada pengguna.
4. Pengguna menyetujui aksi tulis melalui wallet.
5. Wallet/signer menandatangani transaksi; kunci privat tidak dikirim ke model.
6. Secret bid disimpan oleh aplikasi integrator dalam penyimpanan terenkripsi yang tahan lama.

veilio-agent-tools menyediakan schema dan guarded handler untuk bidder dan buyer service. Paket ini bukan agent lengkap, bukan wallet, bukan faucet client, dan bukan MCP server siap pakai. Developer perlu menyediakan SDK adapter, konfirmasi manusia, serta penyimpanan secret. Rilis saat ini tidak mencakup tool publikasi seller.

## Jaringan dan dukungan

Semua jaringan berikut adalah testnet/devnet. Jangan menyampaikan bahwa fitur atau kesiapan deployment identik di semua chain.

| Jaringan | ID | Dukungan yang dicatat | Catatan untuk produksi video |
| --- | --- | --- | --- |
| BNB Smart Chain Testnet | 97 | Auction, service registry/chat, service escrow | Auction dan escrow menggunakan deployment terbaru dengan fee yang disamakan. Listing lama tetap berada pada kontrak terdahulu. |
| Base Sepolia | 84532 | Auction, registry, escrow | Auction dan escrow terbaru telah dicek dengan pembacaan on-chain. Jangan samakan Base Sepolia dengan Base mainnet. |
| Solana Devnet | Devnet | Program auction, registry/chat, dan escrow | Program auction dan escrow telah di-upgrade; fee config PDA telah dibaca kembali setelah update. |

Alamat konfigurasi yang tercatat:

| Jaringan | Auction | Registry jasa | Escrow jasa |
| --- | --- | --- | --- |
| BNB Testnet | 0xae24bceed5f7BFb662AE170CA4C8bB4Fd4209FEf | 0x016A23A069180587d5D8B09413e97E1e78ccD702 | 0x16121bD0CA81867aF5395430C1d640154C7cB36A |
| Base Sepolia | 0xbac318dE378Ac19d5aBB93076feAa131eE649Bc6 | 0x74a6Bf3ed462898F7b3E13e7F4d1c444570bCb88 | 0xcF7364F64a161f2460cFbFC707dDa51baFb8131F |
| Solana Devnet | 5Tw1iJGN1hhyRzepbD5eLoaRoZTEiKcqrh2HoZYhYEta | 6CMoJyQmBobLTk4M9ZoygMShRB6A6i77e6viq2Lew2KY | 5Vj4y8BT74PDe5VwLuDp9agTR5ak4vtZdwxnBfRW3R8s |

Alamat di atas adalah referensi dokumentasi, bukan pengganti verifikasi deployment terkini. Sebelum merekam transaksi, periksa chain badge, RPC, alamat kontrak/program, wallet, saldo testnet, dan konfirmasi transaksi.

## Paket developer

### veilioexchange

TypeScript SDK untuk auction, service registry/chat API, dan escrow pada jaringan yang didukung.

~~~bash
npm install veilioexchange@0.5.2 viem
~~~

Integrasi Solana juga memakai @solana/web3.js dan entry point veilioexchange/solana.

### veilio-agent-tools

Paket agent terpisah untuk bidder dan buyer jasa. Versi rilis yang dikonfirmasi adalah 0.1.0.

~~~bash
npm install veilio-agent-tools@0.1.0 veilioexchange
~~~

Paket ini tidak mengelola wallet atau private key. Integrator menyediakan adapter ke SDK, persetujuan manusia untuk aksi tulis, dan penyimpanan bid secret terenkripsi.

## Model pendapatan yang diterapkan

Tarif platform yang sudah diterapkan dan diverifikasi pada deployment testnet/devnet saat ini:

| Produk | Tarif platform yang ditargetkan | Cakupan kebijakan |
| --- | ---: | --- |
| Auction aset digital | **7%** | Sama untuk Solana Devnet, BNB Testnet, dan Base Sepolia |
| Service escrow | **8,5%** | Sama untuk Solana Devnet, BNB Testnet, dan Base Sepolia |
| Refund yang memenuhi syarat | **0% fee platform** | Pengembalian mengikuti syarat dan state kontrak/order |

Auction EVM dan Solana menerapkan fee 7% dari harga jual; seller menerima 93%. Service escrow menerapkan fee 8,5% pada payout provider; refund yang memenuhi syarat tetap bebas fee platform. Tarif service dapat diubah melalui konfigurasi on-chain yang berwenang. Perubahan ini berlaku untuk transaksi baru dan tidak memindahkan auction/order yang sudah tercatat pada deployment lama.

**Arahan untuk video:** tampilkan angka tersebut sebagai fee pada testnet/devnet dan jangan menyebutnya tarif mainnet.

## Privasi dan keamanan yang perlu dijelaskan

- Judul, deskripsi, harga, serta referensi gambar listing dapat bersifat publik.
- File aset dan metadata privat disimpan off-chain dan dilindungi enkripsi sesuai alur storage aplikasi.
- Bidder, commitment, deposit, serta data reveal/settlement tercatat on-chain sesuai fase.
- Chat service bersifat off-chain dan dibatasi untuk peserta terautentikasi.
- Secret bid harus dirahasiakan sampai reveal dan disimpan tahan lama.
- Jangan pernah meminta seed phrase atau private key ke model, agent, tim video, atau chat.
- Timer on-chain tidak menjalankan transaksi dengan sendirinya; beberapa alur finalisasi NFT memerlukan keeper atau akun lain mengirim transaksi.
- Tes otomatis dan perbaikan kode bukan audit keamanan independen.

## Klaim yang boleh dipakai

- “Marketplace testnet untuk aset digital dan jasa profesional.”
- “Nilai bid tersegel sampai fase reveal; wallet dan deposit tetap publik.”
- “Pemenang dapat memeriksa aset sebelum penerimaan sesuai alur yang tersedia.”
- “Jasa menggunakan alur escrow dan peninjauan delivery.”
- “Developer dapat mengintegrasikan SDK dan tool agent dengan persetujuan pengguna.”
- “Diuji pada BNB Testnet, Base Sepolia, dan Solana Devnet; dukungan fitur berbeda per jaringan.”

## Klaim yang harus dihindari

Jangan menyebut VEILIO sudah live di mainnet, menjamin hasil atau kualitas dataset, menyembunyikan identitas wallet/deposit, membuat transaksi lintas-chain otomatis, atau menyediakan agent/wallet siap pakai. Jangan mengklaim semua fitur identik pada tiap chain, atau bahwa escrow menjamin hasil sengketa. Jangan tampilkan transaksi yang gagal/pending seolah sukses.

## Naskah utama — sekitar 90 detik

**Gaya:** product explainer modern dan jelas. Gunakan UI aktual, animasi alur ringkas, dan teks testnet yang terbaca.

| Waktu | Visual | Narasi / teks layar |
| --- | --- | --- |
| 0–7 dtk | Dataset, file, dan layanan profesional | “Aset digital dan keahlian makin bernilai. Namun, menemukan, menawar, dan menyelesaikan transaksi masih sering terpisah.” |
| 7–15 dtk | Logo dan marketplace VEILIO | “VEILIO menyatukan marketplace aset digital dan jasa profesional untuk manusia maupun software agent.” |
| 15–31 dtk | Listing lalu animasi commit → reveal | “Untuk aset digital, penjual membuat listing. Pembeli mengirim bid tersegel, lalu melakukan reveal saat waktunya tiba.” Teks: “Nilai bid tersegel sampai reveal. Wallet dan deposit tetap publik.” |
| 31–43 dtk | Pemenang meninjau aset dan memilih langkah | “Jika menang, pembeli memeriksa aset sebelum menerima atau menggunakan jalur sengketa yang tersedia.” |
| 43–58 dtk | Service chat, escrow, delivery, approval | “Untuk jasa, kedua pihak menyepakati lingkup. Dana masuk escrow, hasil ditinjau, lalu pembayaran dilepas sesuai alur order.” |
| 58–70 dtk | SDK dan agent meminta persetujuan wallet | “Developer dapat menghubungkan SDK dan tool agent. Agent membantu membaca dan menyiapkan aksi; persetujuan transaksi tetap pada pengguna.” |
| 70–81 dtk | Badge BNB, Base, Solana berlabel testnet | “VEILIO sedang diuji di BNB Testnet, Base Sepolia, dan Solana Devnet. Dukungan fitur bergantung pada jaringan.” |
| 81–90 dtk | CTA dan disclaimer | “Jelajahi VEILIO dan bangun pengalaman marketplace yang lebih terstruktur.” Teks: “TESTNET ONLY · Gunakan aset uji · Bukan audit keamanan independen.” |

## Naskah pendek — sekitar 30 detik

“Temukan aset digital dan jasa profesional di VEILIO. Ajukan bid tersegel untuk aset, periksa hasil jika menang, atau danai pekerjaan melalui escrow dan tinjau delivery sebelum melepas pembayaran. Developer dapat menghubungkan SDK dan tool agent, dengan persetujuan pengguna untuk aksi transaksi. VEILIO tersedia untuk pengujian di BNB Testnet, Base Sepolia, dan Solana Devnet. Testnet only—gunakan aset uji.”

## Tagline dan teks layar

**Tagline pilihan**
- “Temukan. Sepakati. Selesaikan.”
- “Marketplace untuk manusia dan software agent.”
- “Aset digital dan jasa, dengan alur yang dapat diperiksa.”

**Teks layar**
- Sealed-bid asset auctions
- Inspect before accepting
- Service escrow and delivery review
- SDK + agent tools
- Human approval for write actions
- BNB Testnet · Base Sepolia · Solana Devnet
- TESTNET ONLY

## Arahan visual dan audio

- Rekam UI dari build saat ini; samarkan wallet address, nama, dan data sensitif.
- Tampilkan chain badge sebelum transaksi dan pastikan wallet memakai chain yang sama.
- Gambarkan commit-reveal sebagai “commitment disimpan → reveal nanti”, bukan transaksi anonim.
- Gambarkan escrow sesuai status transaksi, bukan sebagai jaminan mutlak atau jaminan arbitrase.
- Tampilkan manusia menyetujui wallet prompt; jangan menggambarkan agent memegang seed phrase atau menandatangani diam-diam.
- Gunakan aksen merek VEILIO, transisi tenang, dan grafis alur sederhana. Hindari visual mainnet atau dana riil.
- Musik elektronik ringan dan profesional; disclaimer harus terbaca dan voice-over tetap jelas.

## Caption dan deskripsi publikasi

**Caption:**
“VEILIO menghubungkan lelang aset digital dan jasa profesional dengan alur bid tersegel, pemeriksaan aset, service chat, dan escrow. Dibangun untuk marketplace yang digunakan manusia dan dapat diintegrasikan developer ke software agent. Saat ini tersedia di testnet/devnet; gunakan aset uji.”

**Deskripsi:**
“Kenali VEILIO: marketplace testnet untuk aset digital dan jasa profesional. Video ini memperlihatkan alur sealed-bid auction, inspeksi aset, service escrow, serta integrasi developer melalui TypeScript SDK dan agent tools. Dukungan fitur berbeda per jaringan. VEILIO belum menjadi layanan mainnet; jangan gunakan aset bernilai nyata. Fitur kontrak dan aplikasi bukan audit keamanan independen.”

## FAQ presenter

**Apakah VEILIO sudah mainnet?**
Belum. Dokumentasi ini mencantumkan BNB Testnet, Base Sepolia, dan Solana Devnet.

**Apakah nilai bid privat?**
Nilai bid disembunyikan sampai reveal. Wallet dan deposit tetap terlihat on-chain.

**Apakah VEILIO membuktikan kualitas dataset?**
Tidak. Protokol tidak mengklaim bukti kriptografis kualitas dataset.

**Apakah agent bisa transaksi tanpa pengguna?**
Integrasi aman meminta persetujuan manusia untuk aksi tulis. Kunci tetap berada pada wallet/signer, tidak diberikan kepada model.

**Apakah tool agent dapat membuat listing seller?**
Tidak pada rilis agent-tools yang terdokumentasi saat ini; paket fokus pada bidder dan buyer jasa.

**Apakah settlement pindah otomatis antar-chain?**
Tidak. Auction/order berjalan di chain tempat ia dibuat; jangan klaim ada bridge atau settlement lintas-chain otomatis.

**Apakah escrow menghilangkan semua risiko?**
Tidak. Escrow mengikuti aturan kontrak dan proses aplikasi. Pengguna tetap perlu membaca syarat dan memahami jalur penyelesaian.

## Checklist sebelum publikasi

- [ ] Gunakan hanya environment testnet/devnet dan tampilkan “TESTNET ONLY”.
- [ ] Cocokkan narasi dengan build aplikasi dan flow chain yang benar-benar aktif.
- [ ] Verifikasi RPC, chain ID, kontrak/program, wallet, saldo test, dan transaksi demo.
- [ ] BNB: gunakan patched auction deployment; jangan tampilkan alamat lama sebagai deployment aktif.
- [ ] Base Sepolia: verifikasi kontrak aktual pada RPC, bukan hanya konfigurasi.
- [ ] Solana: verifikasi wallet, program ID, dan Devnet.
- [ ] Jangan merekam seed phrase, private key, bid secret, .env, token, atau chat privat.
- [ ] Tampilkan status pending/gagal dengan jujur; jangan menyunting transaksi yang belum confirmed agar terlihat sukses.
- [ ] Cocokkan angka, versi paket, alamat dan klaim keamanan pada hari publikasi.
- [ ] Minta review teknis/product atas cut final.

## Referensi dokumentasi repository

- [README produk dan alur multi-chain](../README.md)
- [Public capabilities](public-capabilities.md)
- [Auction dan asset operations](auction-and-asset-operations.md)
- [Agent REST API](agent-api.md)
- [Base Sepolia / Colosseum](base-sepolia-colosseum.md)
- [TypeScript SDK](../packages/veilio-sdk/README.md)
- [Agent tools](../packages/veilio-agent-tools/README.md)
- [Security readiness](security-readiness.md)
