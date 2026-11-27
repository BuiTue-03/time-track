// app.js — Phần hiển thị. Đọc Sheet bằng gviz -> tính bằng core.js/insights.js -> vẽ ra trang.
// L4: thêm form thêm/sửa/xóa (form.js). App đọc số liệu từ CHÍNH Sheet mà nó ghi vào (config.SPREADSHEET_ID),
// để số dòng và số liệu luôn cùng một Sheet. Không lưu số liệu vào localStorage/IndexedDB/service worker:
// mỗi lần tải là đọc mới từ Sheet (fetch cache: 'no-store').
import { buildModel, todaySerial, serialFromYMD, fmtDate, weekNo } from './core.js';
import { gvizUrl, parseGvizText, TAB_SESSIONS, TAB_TOPICS, TAB_SETTINGS, TAB_ACCRUAL } from './gviz.js';
import { parseSettings, parseAccrual, DEFAULT_SETTINGS } from './rest.js';
import { SPREADSHEET_ID, REAL_SPREADSHEET_ID, ALLOW_WRITE_TO_REAL_SHEET } from './config.js';
import { initForm, onModel, openAddCurrentWeek, openAddForDate, openFinish, formEnabled, getListWeek, setListWeek, refreshSignin, showResult } from './form.js';
import { initRestUi, openMark, openConv, defaultMarkDate } from './rest-ui.js';
import { initL6, computeL6, renderL6, renderCalMiss, checkStreakCelebration } from './l6-view.js';
import { vnClock } from './rest.js';
import { initCal, renderCal, onWeek } from './page-cal.js';
import { initToday, renderToday } from './page-today.js';
import { clockNow, fmtHM } from './format.js';
import { initShell, setScreen, seg, applyTheme, getTheme, showPage, currentPage } from './shell.js';
import { initStats, renderStats } from './page-stats.js';
import { mochiSvg, jump } from './mochi.js';
import { UI } from './ui-config.js';
import { checkCelebration, renderBadges } from './badges.js';
import { initQuoteCard, getShowJapanese, setShowJapanese } from './quote-card.js';
import { eligible } from './quotes.js';

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
    return { caRows: fx.caHoc, cdRows: fx.chuDe, source: 'values', label: `dữ liệu mẫu (chụp ${fx.meta.capturedAt}, đến ${fx.meta.cutoff})`,
      l6: { settings: { ...DEFAULT_SETTINGS }, warnings: [], fromSheet: false, accrual: { entries: [], issues: [] }, accrualOk: true } };
  }
  // L6: Cài đặt + Tích lũy đọc song song nhưng KHÔNG chặn trang: lỗi -> giá trị mặc định + cảnh báo (allSettled)
  const [ca, cd, st, tl] = await Promise.allSettled([
    fetchText(gvizUrl(TAB_SESSIONS, 'A1:F', DATA_SHEET_ID)), fetchText(gvizUrl(TAB_TOPICS, 'A1:B', DATA_SHEET_ID)),
    fetchText(gvizUrl(TAB_SETTINGS, 'A1:C', DATA_SHEET_ID)), fetchText(gvizUrl(TAB_ACCRUAL, 'A1:D', DATA_SHEET_ID)),
  ]);
  if (ca.status === 'rejected') throw ca.reason;
  if (cd.status === 'rejected') throw cd.reason;
  return { caRows: parseGvizText(ca.value), cdRows: parseGvizText(cd.value), source: 'gviz', label: null, l6: await loadL6(st, tl) };
}
// Đọc tab Cài đặt (5 khóa) và Tích lũy. Trả { settings, warnings, accrual:{entries,issues}, accrualOk }.
async function loadL6(st, tl) {
  const warnings = [];
  let set = { settings: { ...DEFAULT_SETTINGS }, warnings: [], fromSheet: false, rowOf: {} };
  if (st.status === 'fulfilled') {
    try {
      const rows = parseGvizText(st.value);
      set = parseSettings(rows, 'gviz');
      // gviz đoán kiểu theo cả cột C (đa số là số) -> ô ngày rest_accrual_start có thể về null. Đọc lại riêng ô đó.
      const r = set.rowOf.restAccrualStart;
      if (r && set.warnings.some(w => w.includes('rest_accrual_start'))) {
        const one = parseGvizText(await fetchText(gvizUrl(TAB_SETTINGS, `A${r}:C${r}`, DATA_SHEET_ID, 0)));
        const fixed = parseSettings([rows[0], ...rows.slice(1).map((x, i) => (i + 2 === r ? one[1] ?? x : x))], 'gviz');
        if (!fixed.warnings.some(w => w.includes('rest_accrual_start'))) set = fixed;
      }
    } catch (e) { warnings.push(`Không đọc được tab Cài đặt (${e.message}): đang dùng giá trị mặc định.`); }
  } else warnings.push(`Không tải được tab Cài đặt (${st.reason?.message}): đang dùng giá trị mặc định.`);
  let accrual = { entries: [], issues: [] }, accrualOk = false;
  if (tl.status === 'fulfilled') {
    try { accrual = parseAccrual(parseGvizText(tl.value), 'gviz'); accrualOk = true; }
    catch (e) { warnings.push(`Không đọc được tab Tích lũy (${e.message}): số dư ngày nghỉ có thể chưa đúng.`); }
  } else warnings.push(`Không tải được tab Tích lũy (${tl.reason?.message}): số dư ngày nghỉ có thể chưa đúng.`);
  return { settings: set.settings, warnings: [...set.warnings, ...warnings], fromSheet: set.fromSheet, accrual, accrualOk };
}
// Mục tiêu hiển thị lấy từ Cài đặt (mục tiêu tuần = phút/ngày × số ngày); thiếu -> hằng số ui-config.js
function applySettings(s) {
  UI.goalDayMin = s.goalMinPerDay; UI.goalWeekDays = s.goalDaysPerWeek; UI.goalWeekMin = s.goalWeekMin;
  $('set-goal-day').textContent = fmtHM(UI.goalDayMin);
  $('set-goal-week').textContent = `${UI.goalWeekDays} ngày · ${fmtHM(UI.goalWeekMin)}`;
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
    model.l6 = raw.l6; // L6: settings, warnings, accrual (Tích lũy), accrualOk
    applySettings(raw.l6.settings);
    computeL6(model, TODAY_OVERRIDE ? null : vnClock().nowMin); // L6: loại ngày, chuỗi, số dư, gợi ý quy đổi, ngày bỏ lỡ
    const head = raw.caRows[0]; // dữ liệu mẫu (fixture) lưu dòng dạng { rowNumber, cells }
    model.headers = ((Array.isArray(head) ? head : head?.cells) ?? []).map(c => (c && typeof c === 'object' && 'v' in c ? c.v : c)); // tiêu đề A1:F1
    $('updated').textContent = `Cập nhật lúc ${clockNow()}`;
    if (!model.sessions.length) { setState('empty'); onModel(); return; } // vẫn chuẩn bị form để nút "Thêm ca" dùng được
    setState('ready');
    render();
    onModel();
    if (!USE_FIXTURE && !TODAY_OVERRIDE) {
      const h = checkCelebration(model); // L5: mốc huy hiệu mới -> ăn mừng 1 lần trên máy này
      checkStreakCelebration(model, h ? 3800 : 1200); // L6: mốc chuỗi mới; nếu vừa ăn mừng huy hiệu giờ thì chờ xong (3 giây)
    }
  } catch (e) {
    setState('error', e.message);
  }
}

// ---------- Vẽ ----------

function render() {
  const { stats } = model;
  const t = stats.today;
  const nowMin = (() => { const [h, mm] = clockNow().split(':').map(Number); return h * 60 + mm; })();
  renderToday(model, { nowMin: TODAY_OVERRIDE ? null : nowMin, canFinish: formEnabled(), sheetUrl: `https://docs.google.com/spreadsheets/d/${DATA_SHEET_ID}/edit` });
  $('notice').hidden = !(model.label || TODAY_OVERRIDE);
  $('notice').textContent = [model.label && `Đang xem ${model.label}.`, TODAY_OVERRIDE && `Đang giả lập hôm nay = ${fmtDate(t)}.`].filter(Boolean).join(' ');

  if (currentPage() === 'stats') renderStats(model);
  else renderBadges(model); // L5: số huy hiệu ở Cài đặt luôn đúng (thẻ Thành tích vẽ sẵn, ẩn)

  renderCal(model);
  renderL6(model); // sau renderToday: thanh báo ngày chưa có ca nhường chỗ cho thanh "ca chưa đóng"
  renderCalMiss(getListWeek() ?? weekNo(t));
}

// ---------- Gắn sự kiện ----------
$('reload').addEventListener('click', load);
$('state-retry').addEventListener('click', load);
$('state-add').addEventListener('click', () => openAddCurrentWeek());
let rt;
window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => model && screen === 'ok' && render(), 150); });
initStats();
// L5 Cài đặt: công tắc "Hiện tiếng Nhật gốc" + số câu dùng hằng ngày
$('sw-jp').setAttribute('aria-checked', String(getShowJapanese()));
$('sw-jp').addEventListener('click', () => { const on = !getShowJapanese(); $('sw-jp').setAttribute('aria-checked', String(on)); setShowJapanese(on); });
initQuoteCard().then(q => {
  if (!q) { $('set-quotes').textContent = 'Chưa tải được quotes.json (đang dùng câu dự phòng).'; return; }
  const used = ['co_gang', 'nghi_ngoi', 'khong_nhu_y'].reduce((a, g) => a + eligible(q, g).length, 0);
  $('set-quotes').textContent = `${used} câu dùng hằng ngày (bỏ ${q.length - used} câu chưa đủ nguồn) · mỗi ngày 1 câu`;
});
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
initL6({
  canWrite: () => formEnabled(),
  onFixAdd: d => { showPage('cal'); openAddForDate(d); },
  onFixRest: d => { showPage('cal'); setListWeek(weekNo(d)); openMark(d); },
  onConv: () => { if (formEnabled()) openConv(); },
});
initRestUi({ getModel: () => model, reload: load, onSignin: refreshSignin, showResult });
$('mark-btn').addEventListener('click', () => { if (formEnabled()) openMark(defaultMarkDate(getListWeek())); });
initForm({ getModel: () => model, reload: load, onListWeek: w => { onWeek(w); renderCalMiss(w); } }, { enabled: FORM_ENABLED, disabledReason: FORM_DISABLED_REASON });
load();
