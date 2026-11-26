// sw.js — Service worker của PWA (L4.5). CHỈ lưu FILE TĨNH của app (HTML, CSS, JS, phông, biểu tượng) để mở được khi mất mạng.
// KHÔNG lưu số liệu: mọi yêu cầu tới Google (docs.google.com gviz, sheets.googleapis.com, accounts.google.com) đi thẳng ra mạng,
// service worker không đụng tới (giữ quy tắc L4 "không cache dài hạn số liệu tuần"). Mất mạng -> app báo "Đang không có mạng".
// Cách lấy file: mạng trước (luôn có bản mới khi online), mất mạng mới dùng bản đã lưu.
// QUY TẮC (L5): mỗi lần phát hành phải đổi số phiên bản; mọi file mới trong src/, quotes.json, phông, hình phải có trong STATIC
// (test/sw.test.mjs kiểm tra). Không bao giờ thêm số liệu Sheet vào đây.
const VERSION = 'tt-static-v3'; // v2 = L5, v3 = L6
const STATIC = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './src/app.js', './src/config.js', './src/core.js', './src/form.js', './src/format.js', './src/gviz.js', './src/insights.js',
  './src/mochi.js', './src/page-cal.js', './src/page-stats.js', './src/page-today.js', './src/rules.js', './src/sheets-write.js',
  './src/shell.js', './src/stats-extra.js', './src/ui-charts.js', './src/ui-config.js', './src/write-core.js', './src/pwa.js',
  './src/milestones.js', './src/quotes.js', './src/badges.js', './src/quote-card.js', './src/rest.js', './src/streak.js', './quotes.json',
  './fonts/mplus-rounded-1c-bold.woff2', './fonts/mplus-rounded-1c-regular.woff2', './fonts/nunito-var.woff2',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png',
];
const SCOPE = new URL('./', self.location).href;
const isStatic = url => url.origin === self.location.origin && STATIC.some(p => new URL(p, SCOPE).href === url.href.split('?')[0].split('#')[0]);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!isStatic(url)) return; // số liệu Google, dữ liệu mẫu, mọi thứ khác: không đụng tới
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) cache.put(req.url.split('?')[0].split('#')[0], res.clone());
      return res;
    } catch {
      const hit = await cache.match(req.url.split('?')[0].split('#')[0]);
      if (hit) return hit;
      throw new Error('offline');
    }
  })());
});
