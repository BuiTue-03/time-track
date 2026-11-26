// app.js — Phần hiển thị. Đọc Sheet bằng gviz -> tính bằng core.js/insights.js -> vẽ ra trang.
// L4: thêm form thêm/sửa/xóa (form.js). App đọc số liệu từ CHÍNH Sheet mà nó ghi vào (config.SPREADSHEET_ID),
// để số dòng và số liệu luôn cùng một Sheet. Không lưu số liệu vào localStorage/IndexedDB/service worker:
// mỗi lần tải là đọc mới từ Sheet (fetch cache: 'no-store').
import { buildModel, todaySerial, serialFromYMD, fmtDate } from './core.js';
import { gvizUrl, parseGvizText, TAB_SESSIONS, TAB_TOPICS } from './gviz.js';
import { SPREADSHEET_ID, REAL_SPREADSHEET_ID, ALLOW_WRITE_TO_REAL_SHEET } from './config.js';
import { initForm, onModel, openAddCurrentWeek, openFinish, formEnabled, getListWeek, setListWeek } from './form.js';
import { initCal, renderCal, onWeek } from './page-cal.js';
import { initToday, renderToday } from './page-today.js';
import { clockNow, fmtHM } from './format.js';
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
let model = null;
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
    if (!model.sessions.length) { setState('empty'); onModel(); return; } // vẫn chuẩn bị form để nút "Thêm ca" dùng được
    setState('ready');
    render();
    onModel();
  } catch (e) {
    setState('error', e.message);
  }
}

// ---------- Vẽ ----------

function render() {
  const { stats } = model;
  const t = stats.today;
  const nowMin = (() => { const [h, mm] = clockNow().split(':').map(Number); return h * 60 + mm; })();
  renderToday(model, { nowMin: TODAY_OVERRIDE ? null : nowMin, canFinish: formEnabled() });
  $('notice').hidden = !(model.label || TODAY_OVERRIDE);
  $('notice').textContent = [model.label && `Đang xem ${model.label}.`, TODAY_OVERRIDE && `Đang giả lập hôm nay = ${fmtDate(t)}.`].filter(Boolean).join(' ');

  if (currentPage() === 'stats') renderStats(model);

  renderCal(model);
}

// ---------- Gắn sự kiện ----------
$('reload').addEventListener('click', load);
$('state-retry').addEventListener('click', load);
$('state-add').addEventListener('click', () => openAddCurrentWeek());
let rt;
window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => model && screen === 'ok' && render(), 150); });
initStats();
initCal({ getWeek: getListWeek, setWeek: setListWeek });
initToday({
  onAdd: () => { showPage('cal'); openAddCurrentWeek(); },
  onFinish: row => { showPage('cal'); openFinish(row); },
});
initShell({ onPage: () => { if (model && screen === 'ok') render(); } });
seg($('set-theme'), getTheme(), applyTheme);
$('brand-mochi').innerHTML = mochiSvg();
$('brand').addEventListener('click', () => jump($('brand-mochi')));
$('hello').textContent = `Chào ${UI.name} ヾ(＾∇＾)`;
// Cài đặt: chỉ hiển thị (tên, mục tiêu ở ui-config.js); Google dùng chung nút đăng nhập của tab Lịch
$('set-name').textContent = UI.name;
$('set-goal-day').textContent = fmtHM(UI.goalDayMin);
$('set-goal-week').textContent = `${UI.goalWeekDays} ngày · ${fmtHM(UI.goalWeekMin)}`;
$('set-source').textContent = `${DATA_SHEET_ID === REAL_SPREADSHEET_ID ? 'Sheet "Dữ liệu học tập"' : 'Bản thử nghiệm của Sheet'}${FORM_ENABLED ? ' · ghi cột A–F' : ' · chỉ đọc'}`;
$('set-sheet').href = `https://docs.google.com/spreadsheets/d/${DATA_SHEET_ID}/edit`;
$('set-google').hidden = !FORM_ENABLED;
$('set-signin').addEventListener('click', () => $('ca-signin').click());
renderBanner();
initForm({ getModel: () => model, reload: load, onListWeek: onWeek }, { enabled: FORM_ENABLED, disabledReason: FORM_DISABLED_REASON });
load();
