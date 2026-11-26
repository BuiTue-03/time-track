// app.js — Phần hiển thị. Đọc Sheet bằng gviz -> tính bằng core.js/insights.js -> vẽ ra trang.
// L4: thêm form thêm/sửa/xóa (form.js). App đọc số liệu từ CHÍNH Sheet mà nó ghi vào (config.SPREADSHEET_ID),
// để số dòng và số liệu luôn cùng một Sheet. Không lưu số liệu vào localStorage/IndexedDB/service worker:
// mỗi lần tải là đọc mới từ Sheet (fetch cache: 'no-store').
import { buildModel, todaySerial, serialFromYMD, weekNo, WEEK_STATUS, fmtDate } from './core.js';
import { gvizUrl, parseGvizText, TAB_SESSIONS, TAB_TOPICS } from './gviz.js';
import { SPREADSHEET_ID, REAL_SPREADSHEET_ID, ALLOW_WRITE_TO_REAL_SHEET } from './config.js';
import { initForm, onModel, openAddCurrentWeek, openFinish, formEnabled } from './form.js';
import { initToday, renderToday } from './page-today.js';
import { rankWeeks, weeklyAverage, breakdown, rankWeekdays, compareWeeks, compareMonths, forecastWeek } from './insights.js';
import { weeklyBars, activityBar, heatmap, HEAT_BINS, activityColorVar, installTooltip, esc } from './charts.js';
import {
  fmtMin, fmtHours, fmtPct, fmtSignedPct, fmtSignedMin, fmtRange, fmtDayShort, fmtTime, clockNow, monthLabel,
} from './format.js';
import { WEEKDAY_NAMES } from './core.js';
import { initShell, setScreen, seg, applyTheme, getTheme, showPage, currentPage } from './shell.js';
import { initStats, renderStats } from './page-stats.js';
import { mochiSvg, jump } from './mochi.js';
import { UI } from './ui-config.js';

const TIMEOUT_MS = 8000;
const params = new URLSearchParams(location.search);
// Chế độ thử: ?nguon=mau dùng dữ liệu mẫu (fixture) thay vì Sheet; ?homnay=2026-11-25 giả lập ngày hôm nay.
const USE_FIXTURE = params.get('nguon') === 'mau';
const TODAY_OVERRIDE = /^\d{4}-\d{2}-\d{2}$/.test(params.get('homnay') ?? '') ? params.get('homnay') : null;
const $ = id => document.getElementById(id);
// Sheet để ĐỌC: mặc định = Sheet app ghi vào. ?nguon=that -> xem Sheet thật, chỉ đọc (tắt form nếu đang ghi bản thử).
const VIEW_REAL = params.get('nguon') === 'that';
const DATA_SHEET_ID = VIEW_REAL ? REAL_SPREADSHEET_ID : SPREADSHEET_ID;
const WRITES_REAL = SPREADSHEET_ID === REAL_SPREADSHEET_ID;
const FORM_ENABLED = !USE_FIXTURE && !TODAY_OVERRIDE && !VIEW_REAL && DATA_SHEET_ID === SPREADSHEET_ID && (!WRITES_REAL || ALLOW_WRITE_TO_REAL_SHEET);
const FORM_DISABLED_REASON = USE_FIXTURE ? 'Đang xem dữ liệu mẫu: tắt form để không ghi nhầm.'
  : TODAY_OVERRIDE ? 'Đang giả lập ngày hôm nay: tắt form để không ghi nhầm.'
  : VIEW_REAL ? 'Đang xem Sheet thật ở chế độ chỉ đọc (?nguon=that). Mở trang không có ?nguon=that để thêm, sửa, xóa.'
  : 'Khóa an toàn đang bật: app trỏ vào Sheet thật nhưng chưa cho phép ghi.';

// Nhãn nhỏ cuối trang (thay banner đỏ, theo ý Oriana ở L4.5): luôn cho thấy app đang ghi vào đâu
function renderBanner() {
  $('realtag').textContent = WRITES_REAL && ALLOW_WRITE_TO_REAL_SHEET && !VIEW_REAL ? 'Đang ghi vào Sheet thật'
    : VIEW_REAL ? 'Đang xem Sheet thật · chỉ đọc, không ghi'
    : 'Bản thử nghiệm · không ghi vào Sheet thật';
  $('footer').textContent = FORM_ENABLED
    ? (WRITES_REAL ? 'Form ghi vào Sheet thật (chỉ cột A–F của tab Ca học).' : 'Form ghi vào BẢN THỬ NGHIỆM của Sheet (chỉ cột A–F của tab Ca học). Số liệu trên trang là của bản thử.')
    : 'Chỉ đọc: app không ghi gì vào Google Sheet.';
}

// ---------- Tải dữ liệu, có thời gian chờ 8 giây ----------
async function fetchText(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`Máy chủ trả lỗi ${r.status}`);
    return await r.text();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Quá 8 giây chưa tải được dữ liệu (mạng chậm hoặc mất kết nối).');
    if (e instanceof TypeError) throw new Error('Không kết nối được tới Google Sheet (kiểm tra mạng).');
    throw e;
  } finally { clearTimeout(timer); }
}
async function loadRaw() {
  if (USE_FIXTURE) {
    const fx = JSON.parse(await fetchText('test/fixtures/sheet-to-2026-11-23.json'));
    return { caRows: fx.caHoc, cdRows: fx.chuDe, source: 'values', label: `dữ liệu mẫu (chụp ${fx.meta.capturedAt}, đến ${fx.meta.cutoff})` };
  }
  const [ca, cd] = await Promise.all([fetchText(gvizUrl(TAB_SESSIONS, 'A1:F', DATA_SHEET_ID)), fetchText(gvizUrl(TAB_TOPICS, 'A1:B', DATA_SHEET_ID))]);
  return { caRows: parseGvizText(ca), cdRows: parseGvizText(cd), source: 'gviz', label: null };
}
function today() {
  if (TODAY_OVERRIDE) { const [y, m, d] = TODAY_OVERRIDE.split('-').map(Number); return serialFromYMD(y, m, d); }
  return todaySerial();
}

// ---------- Trạng thái trang ----------
let model = null, selectedWeek = null;
let screen = 'loading';
function setState(state, msg = '') {
  // Mất mạng: báo riêng, không hiện số liệu cũ (app không lưu số liệu)
  screen = state === 'error' && navigator.onLine === false ? 'offline' : state === 'ready' ? 'ok' : state;
  $('reload').disabled = state === 'loading';
  setScreen(screen, screen === 'error' ? msg : '');
}
async function load() {
  setState('loading');
  try {
    const raw = await loadRaw();
    model = buildModel({ ...raw, today: today() });
    model.label = raw.label;
    const head = raw.caRows[0]; // dữ liệu mẫu (fixture) lưu dòng dạng { rowNumber, cells }
    model.headers = ((Array.isArray(head) ? head : head?.cells) ?? []).map(c => (c && typeof c === 'object' && 'v' in c ? c.v : c)); // tiêu đề A1:F1
    $('updated').textContent = `Cập nhật lúc ${clockNow()}`;
    if (!model.sessions.length) { setState('empty'); return; }
    if (selectedWeek === null || selectedWeek > weekNo(model.stats.today)) selectedWeek = weekNo(model.stats.today);
    setState('ready');
    render();
    onModel();
  } catch (e) {
    setState('error', e.message);
  }
}

// ---------- Vẽ ----------
const deltaText = c => `${c.diff > 0 ? '▲' : c.diff < 0 ? '▼' : '='} ${fmtSignedMin(c.diff)}${c.pct !== null ? ` (${fmtSignedPct(c.pct)})` : ''}`;
const width = id => Math.max(280, $(id).clientWidth);

function render() {
  const { stats, sessions, issues } = model;
  const t = stats.today;
  const nowMin = (() => { const [h, mm] = clockNow().split(':').map(Number); return h * 60 + mm; })();
  renderToday(model, { nowMin: TODAY_OVERRIDE ? null : nowMin, canFinish: formEnabled() });
  $('notice').hidden = !(model.label || TODAY_OVERRIDE);
  $('notice').textContent = [model.label && `Đang xem ${model.label}.`, TODAY_OVERRIDE && `Đang giả lập hôm nay = ${fmtDate(t)}.`].filter(Boolean).join(' ');

  if (currentPage() === 'stats') renderStats(model);

  // --- A4 (tạm, bước 5 thay bằng heatmap mới ở tab Lịch) ---
  $('a4').innerHTML = heatmap(stats.weeks, stats.days, t, width('a4'));
  $('a4-legend').innerHTML = HEAT_BINS.map((b, i) => `<span><i class="cell-sw h${i}"></i>${b.label}</span>`).join('') +
    `<span><i class="cell-sw busy"></i>Bận đi làm (B)</span><span><i class="cell-sw today-sw"></i>Hôm nay</span>`;

  // --- Xếp hạng (2): chủ đề / nhóm trong tuần được chọn ---
  $('week-select').innerHTML = stats.weeks.map(w => `<option value="${w.week}" ${w.week === selectedWeek ? 'selected' : ''}>Tuần ${w.week} (${fmtRange(w.start, w.end)}) · ${w.status}</option>`).join('');
  renderWeekBreakdown();

  // --- Tổng quan + vấn đề dữ liệu ---
  $('issues').hidden = !issues.length;
  $('issues').innerHTML = `<summary>${issues.length} điểm cần xem lại trong Sheet</summary><ul>` +
    issues.map(i => `<li>Dòng ${i.rowNumber}: ${esc(i.msg)}</li>`).join('') + `</ul>`;
}

function renderWeekBreakdown() {
  const w = model.stats.weeks.find(x => x.week === selectedWeek);
  const table = (rows, label) => rows.length
    ? `<table><thead><tr><th>${label}</th><th class="num">Giờ</th><th class="num">Tỷ lệ</th><th class="num">Số ca</th></tr></thead><tbody>` +
      rows.map((r, i) => `<tr><td><span class="muted">${i + 1}.</span> ${esc(r.key)}</td><td class="num">${fmtHours(r.min)}</td><td class="num">${fmtPct(r.share)}</td><td class="num">${r.count}</td></tr>`).join('') + `</tbody></table>`
    : `<p class="muted">Tuần này chưa có ca nào có giờ.</p>`;
  const to = Math.min(w.end, model.stats.today);
  $('rank-topics').innerHTML =
    (w.status === WEEK_STATUS.CURRENT ? `<p class="muted">Tuần đang diễn ra: số liệu tạm thời tính đến hôm nay.</p>` : w.status === WEEK_STATUS.PROVISIONAL ? `<p class="muted"><span class="tag">tạm chốt</span> có thể còn ca ghi bù.</p>` : '') +
    `<h4>Theo nhóm</h4>` + table(breakdown(model.sessions, w.start, to, 'category'), 'Nhóm') +
    `<h4>Theo chủ đề</h4>` + table(breakdown(model.sessions, w.start, to, 'topic'), 'Chủ đề');
}

// ---------- Gắn sự kiện ----------
$('reload').addEventListener('click', load);
$('state-retry').addEventListener('click', load);
$('state-add').addEventListener('click', () => { setState('ready'); });
$('week-select').addEventListener('change', e => { selectedWeek = Number(e.target.value); renderWeekBreakdown(); });
let rt;
window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => model && screen === 'ok' && render(), 150); });
initStats();
initToday({
  onAdd: () => { showPage('cal'); openAddCurrentWeek(); },
  onFinish: row => { showPage('cal'); openFinish(row); },
});
initShell({ onPage: () => { if (model && screen === 'ok') render(); } });
seg($('set-theme'), getTheme(), applyTheme);
$('brand-mochi').innerHTML = mochiSvg();
$('brand').addEventListener('click', () => jump($('brand-mochi')));
$('hello').textContent = `Chào ${UI.name} ヾ(＾∇＾)`;
renderBanner();
initForm({ getModel: () => model, reload: load }, { enabled: FORM_ENABLED, disabledReason: FORM_DISABLED_REASON });
load();
