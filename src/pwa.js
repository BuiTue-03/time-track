// pwa.js — Đăng ký service worker (sw.js) để cài app lên màn hình chính và mở được khi mất mạng.
// sw.js CHỈ lưu file tĩnh của app; số liệu luôn đọc mới từ Google Sheet (không lưu ở đâu cả).
if ('serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* không đăng ký được (ví dụ chế độ riêng tư): app vẫn chạy bình thường khi có mạng */ });
  });
}
