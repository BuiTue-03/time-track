// shell.js — Khung giao diện (L4.5): chọn sáng/tối, chuyển tab, màn hình tải/lỗi/trống/mất mạng, tooltip.
// Chỉ là giao diện: không đọc/ghi Google Sheet, không lưu số liệu.
// localStorage chỉ giữ 1 khóa 'tt-theme' (auto | light | dark), luôn bọc try/catch.
import { mochiSvg } from './mochi.js';

const $ = id => document.getElementById(id);

// ---------- Sáng / tối ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* chế độ riêng tư: bỏ qua */ } },
};
export const getTheme = () => store.get('tt-theme') || 'auto';
export function applyTheme(v) {
  if (v === 'light' || v === 'dark') document.documentElement.dataset.theme = v;
  else delete document.documentElement.dataset.theme;
  store.set('tt-theme', v);
}

// Nhóm nút chọn 1 trong n (aria-pressed)
export function seg(el, value, on) {
  const mark = v => el.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  mark(value);
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    mark(b.dataset.v);
    on(b.dataset.v);
  });
}

// ---------- Tab + đường dẫn (#lich, #thong-ke, #cai-dat) ----------
const ROUTES = { '': 'today', '#hom-nay': 'today', '#lich': 'cal', '#thong-ke': 'stats', '#cai-dat': 'settings' };
const HASH = { today: '#hom-nay', cal: '#lich', stats: '#thong-ke', settings: '#cai-dat' };
let page = 'today', screen = 'ok', onShow = () => {};
export const currentPage = () => page;

function paint() {
  const st = screen !== 'ok';
  document.querySelectorAll('.page').forEach(x => { x.hidden = st ? x.id !== 'pg-state' : x.id !== `pg-${page}`; });
  document.querySelectorAll('.tab').forEach(t => {
    if (t.dataset.page === page) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  if (!st) onShow(page);
}
export function showPage(p, { push = true } = {}) {
  if (!HASH[p]) return;
  const changed = p !== page;
  page = p;
  if (push && location.hash !== HASH[p]) history.pushState(null, '', HASH[p]);
  paint();
  if (changed) scrollTo(0, 0);
}

// Màn hình thay cho nội dung khi chưa có số liệu
const STATES = {
  loading: ['Đang tải dữ liệu', 'Đang đọc tab "Ca học" từ Google Sheet.'],
  error: ['Chưa tải được dữ liệu', ''],
  empty: ['Chưa có ca nào', 'Tab "Ca học" chưa có dòng nào. Thêm ca đầu tiên nhé.'],
  offline: ['Đang không có mạng', 'App không hiện số liệu cũ để tránh nhầm. Có mạng lại thì bấm Tải lại.'],
};
export function setScreen(mode, text = '') {
  screen = mode;
  if (mode !== 'ok') {
    const [t, txt] = STATES[mode];
    $('pg-state').classList.toggle('loading', mode === 'loading');
    $('state-mochi').innerHTML = mochiSvg();
    $('state-title').innerHTML = mode === 'loading' ? `${t}<span class="dots"></span>` : t;
    $('state-text').textContent = text || txt;
    $('state-retry').hidden = mode === 'loading' || mode === 'empty';
    $('state-add').hidden = mode !== 'empty';
  }
  paint();
}

// ---------- Tooltip dùng chung: rê chuột (máy tính) hiện; chạm (điện thoại) bật/tắt ----------
let tip, tipFor = null;
function showTip(el) {
  if (!el.dataset.tip) return;
  const host = el.closest('dialog') || document.body; // trong tấm trượt, tooltip phải nằm trong tấm đó mới hiện lên trên
  if (tip.parentNode !== host) host.appendChild(tip);
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const r = el.getBoundingClientRect(), bw = tip.offsetWidth, bh = tip.offsetHeight;
  tip.style.left = `${Math.min(innerWidth - bw - 8, Math.max(8, r.left + r.width / 2 - bw / 2))}px`;
  tip.style.top = `${r.top - bh - 10 < 8 ? r.bottom + 10 : r.top - bh - 10}px`;
}
const hideTip = () => { tip.hidden = true; tipFor = null; };

export function initShell({ onPage }) {
  onShow = onPage;
  tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);
  document.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return;
    const el = e.target.closest?.('[data-tip]');
    el ? showTip(el) : hideTip();
  });
  document.addEventListener('click', e => {
    const el = e.target.closest?.('[data-tip]');
    if (el && el !== tipFor) { tipFor = el; showTip(el); } else hideTip();
    // Chạm vào cột / điểm: hiện số trên cột đó (1 cột mỗi lần)
    const mk = e.target.closest?.('.chart .mk');
    document.querySelectorAll('.chart .mk.sel').forEach(x => { if (x !== mk) x.classList.remove('sel'); });
    if (mk) mk.classList.toggle('sel');
  });
  document.addEventListener('focusin', e => { const el = e.target.closest?.('[data-tip]'); if (el) showTip(el); });
  document.addEventListener('focusout', hideTip);
  addEventListener('scroll', hideTip, { passive: true });
  document.querySelector('.tabs').addEventListener('click', e => {
    const t = e.target.closest('.tab');
    if (t) showPage(t.dataset.page);
  });
  addEventListener('popstate', () => showPage(ROUTES[location.hash] ?? 'today', { push: false }));
  page = ROUTES[location.hash] ?? 'today';
  paint();
}
