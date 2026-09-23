# Vampir Köylü

Atmosferik 2D sosyal çıkarım oyunu. Klasik Vampir/Köylü çekirdeğini modern bir **iddia sistemi**, kişisel dedüksiyon araçları ve sinematik köy konseyi arayüzüyle birleştirmeyi hedefliyor.

## Durum — v0.2 / P1 oyun çekirdeği

- React + TypeScript + Vite
- 16:9 sinematik 2D görsel yön
- Ana menü, oda lobisi, rol kartı, gece, gündüz, oylama, karar ve maç sonu akışı
- Klasik paket: Vampir, Kâhin, Koruyucu, Köylü
- Fisher–Yates + Web Crypto tabanlı rol dağıtımı
- Gizli rol verisi ile public oyun verisinin ayrı tutulduğu state modeli
- Gece aksiyonları: vampir saldırısı, koruma, kâhin araştırması
- Gündüz oylaması, beraberlik ve kazanma koşulları
- İddia/çelişki arayüzü ve kişisel notlar
- Vitest çekirdek oyun testleri
- GitHub Pages otomatik deploy

## Güvenlik/mimari not

v0.2 tarayıcı içinde çalışan oynanabilir bir simülasyondur. Gerçek çevrimiçi çok oyunculu sürümde **gizli roller ve gece aksiyonları istemciye güvenilmeden sunucu tarafında tutulacaktır**. Mevcut `public` / `secret` state ayrımı bu geçiş için baştan kurulmuştur.

## Geliştirme

```bash
npm install
npm test
npm run dev
```

Production kontrolü:

```bash
npm run build
```
