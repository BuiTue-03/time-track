// quotes.js — Câu khích lệ mỗi ngày (L5, Hướng dẫn mục 8 + quyết định Phần A ngày 26/11/2026). Hàm thuần.
// Dữ liệu: quotes.json (v3, 120 câu, do Oriana gửi) ở gốc repo; app tải 1 lần khi mở.
// Không lưu trạng thái: câu của ngày tính ra từ (ngày, nhóm, danh sách câu) -> cùng ngày + cùng dữ liệu
// thì cùng câu trên mọi thiết bị.
import { CONFIG, BUSY_TOPIC } from './core.js';
import { weekRing } from './stats-extra.js';

export const SALT = 'tt-quotes-v3';
export const EXCLUDED_STATUS = ['verified_weak', 'unverified']; // Oriana chọn loại khỏi "câu của ngày" (Phần A, o)
export const REST_TOPICS = [BUSY_TOPIC, 'Nghỉ ngơi'];          // ngày nghỉ theo Hướng dẫn mục 7 (L5 chỉ dùng để chọn nhóm câu)

// Kho câu của 1 nhóm, xếp theo id để không phụ thuộc thứ tự trong file
export const eligible = (quotes, group) =>
  quotes.filter(q => q.group === group && !EXCLUDED_STATUS.includes(q.status)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

// Bộ tạo số giả ngẫu nhiên cố định: chuỗi hạt giống -> số 32 bit (FNV-1a) -> dãy số mulberry32.
// Cùng hạt giống thì luôn ra cùng một dãy, trên mọi máy.
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Xáo kho bằng Fisher–Yates với hạt giống cố định
function shuffled(pool, seed) {
  const a = [...pool], rnd = mulberry32(hash32(seed));
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// Thứ tự câu của vòng c. Chống lặp ở chỗ nối: câu đầu vòng c trùng câu cuối vòng c−1 thì đổi chỗ câu 1 và câu 2.
function cycleOrder(pool, group, c) {
  const p = shuffled(pool, `${SALT}:${group}:${c}`);
  if (c > 0 && p.length > 1) {
    const prev = shuffled(pool, `${SALT}:${group}:${c - 1}`);
    if (p[0].id === prev[prev.length - 1].id) [p[0], p[1]] = [p[1], p[0]];
  }
  return p;
}

// Số thứ tự ngày: 0 = 21/10/2026
export const dayIndex = (today, cfg = CONFIG) => today - cfg.startDate;

// Câu của ngày n trong nhóm: vòng c = n chia L (phần nguyên), vị trí = phần dư.
// Trong mỗi vòng L ngày, mỗi câu xuất hiện đúng 1 lần (khi nhóm không đổi).
export function quoteForDay(quotes, group, n) {
  const pool = eligible(quotes, group);
  if (!pool.length) return null;
  const L = pool.length, k = ((n % L) + L) % L;
  return cycleOrder(pool, group, Math.floor(n / L))[k];
}

// Nhóm câu hôm nay (tính từ dữ liệu lúc mở app, không lưu):
//   nghi_ngoi: hôm nay có dòng "Bận đi làm…" hoặc chủ đề "Nghỉ ngơi", hoặc tuần này đã đạt mục tiêu (≥ 1440 phút);
//   còn lại co_gang. khong_nhu_y KHÔNG bao giờ được chọn tự động (chỉ qua nút "Xem câu khác").
// Vừa đạt mục tiêu tuần trong ngày -> câu đổi 1 lần sang nhóm nghỉ ngơi (Oriana chấp nhận, Phần A m).
export function pickGroup(stats, sessions) {
  const restToday = sessions.some(s => s.date === stats.today && REST_TOPICS.includes(s.topic));
  return restToday || weekRing(stats).reached ? 'nghi_ngoi' : 'co_gang';
}

export function dailyQuote(quotes, stats, sessions, cfg = CONFIG) {
  const group = pickGroup(stats, sessions);
  return { group, quote: quoteForDay(quotes, group, dayIndex(stats.today, cfg)) };
}

// Nút "Xem câu khác": lần bấm thứ k (1, 2, ...) lấy câu kế tiếp trong nhóm khong_nhu_y, bắt đầu từ vị trí của ngày,
// quay vòng khi hết. Không lưu: mở lại app thì về câu của ngày.
export function otherQuote(quotes, n, k) {
  const pool = eligible(quotes, 'khong_nhu_y');
  if (!pool.length) return null;
  const L = pool.length, order = cycleOrder(pool, 'khong_nhu_y', Math.floor(n / L));
  return order[(((n % L) + L) % L + k - 1) % L];
}

// Phần hiển thị của 1 câu (quyết định Phần A k, l):
//   big    = chữ Nhật gốc, chỉ khi câu tiếng Nhật có show_original và công tắc "Hiện tiếng Nhật gốc" bật;
//   vi     = nghĩa / nội dung tiếng Việt;
//   note   = ghi chú, hiện khi chạm vào câu (nếu có);
//   author = "Tác giả, Tác phẩm" khi show_author = true; câu Claude viết (show_author = false) -> null.
// Không hiện cách đọc hiragana (reading) và không hiện original_zh. Không thêm chữ "bản dịch" (Oriana chọn).
export function displayParts(q, { showJapanese = true } = {}) {
  if (!q) return null;
  const big = q.lang_original === 'ja' && q.show_original && showJapanese && q.original_text ? q.original_text : null;
  const author = q.show_author && q.author ? [q.author, q.work && q.work !== q.author ? q.work : null].filter(Boolean).join(', ') : null;
  return { id: q.id, group: q.group, big, vi: q.text_vi, note: q.note_vi ?? null, author };
}
