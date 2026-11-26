// quote-card.js — Thẻ "Câu của hôm nay" (L5). Chỉ vẽ; cách chọn câu nằm ở quotes.js (thuần, có test).
// quotes.json là file tĩnh (service worker lưu được), tải 1 lần khi mở app. Tải không được -> hiện câu dự phòng.
// "Xem câu khác" không lưu: mở lại app thì về câu của ngày.
// Công tắc "Hiện tiếng Nhật gốc" (Cài đặt) lưu ở localStorage khóa 'tt-show-jp' ('1' | '0'), mặc định bật.
import { dailyQuote, dayIndex, otherQuote, displayParts } from './quotes.js';
import { QUOTE } from './ui-config.js';
import { esc } from './ui-charts.js';
import { jump } from './mochi.js';

const $ = id => document.getElementById(id);
const KEY = 'tt-show-jp';
let quotes = null, model = null, other = 0;

export const getShowJapanese = () => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };
export function setShowJapanese(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* chế độ riêng tư: bỏ qua */ }
  renderQuote();
}
export const quotesList = () => quotes;

export async function initQuoteCard() {
  $('q-other').addEventListener('click', () => { other++; renderQuote(); jump($('peek')); });
  $('q-back').addEventListener('click', () => { other = 0; renderQuote(); });
  try {
    const r = await fetch('quotes.json');
    if (!r.ok) throw new Error(r.status);
    quotes = (await r.json()).quotes;
  } catch { quotes = null; }
  renderQuote();
  return quotes;
}

// Gọi mỗi lần vẽ trang Hôm nay (nhóm câu tính từ số liệu: ngày nghỉ / đủ mục tiêu tuần -> nhóm nghỉ ngơi)
export function setQuoteModel(m) { model = m; renderQuote(); }

const GROUP_TAG = { co_gang: 'Câu của hôm nay', nghi_ngoi: 'Câu của hôm nay · nghỉ ngơi', khong_nhu_y: 'Câu khác' };
function renderQuote() {
  const body = $('q-body');
  if (!quotes || !model) {
    // Câu dự phòng (chưa có quotes.json hoặc chưa có số liệu)
    $('q-tag').textContent = 'Câu của hôm nay';
    body.innerHTML = `<p class="jp" lang="ja">${QUOTE.jp.map(p => `<span>${esc(p)}</span>`).join('')}</p><p class="vi">${esc(QUOTE.vi)}</p>`;
    $('q-other').hidden = !quotes; $('q-back').hidden = true;
    return;
  }
  const n = dayIndex(model.stats.today);
  const { group, quote } = other > 0 ? { group: 'khong_nhu_y', quote: otherQuote(quotes, n, other) } : dailyQuote(quotes, model.stats, model.sessions);
  const d = displayParts(quote, { showJapanese: getShowJapanese() });
  if (!d) { $('q-tag').textContent = 'Câu của hôm nay'; body.innerHTML = `<p class="vi">${esc(QUOTE.vi)}</p>`; return; }
  $('q-tag').textContent = GROUP_TAG[group] ?? 'Câu của hôm nay';
  body.innerHTML =
    (d.big ? `<p class="jp" lang="ja">${esc(d.big)}</p><p class="vi">${esc(d.vi)}</p>` : `<p class="vi only">${esc(d.vi)}</p>`) +
    (d.author ? `<p class="by">— ${esc(d.author)}</p>` : '') +
    (d.note ? `<details class="by"><summary class="linkbtn">Chạm để đọc ghi chú</summary><p class="note">${esc(d.note)}</p></details>` : '');
  body.dataset.qid = d.id; // để kiểm thử biết câu nào đang hiện (không hiển thị)
  $('q-other').hidden = false;
  $('q-other').textContent = other ? 'Câu khác nữa' : 'Xem câu khác';
  $('q-back').hidden = other === 0;
}
