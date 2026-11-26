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
import { initShell, setScreen, seg, applyTheme, getTheme, showPage } from './shell.js';
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

  // --- Tuần này (thống kê tạm thời) + so sánh + dự báo ---
  const cw = compareWeeks(stats), fc = forecastWeek(stats), cur = rankWeeks(stats).current;
  let h = '';
  if (cur) {
    h += `<p class="big">${fmtHours(cur.min)}</p><p class="muted">Tuần ${cur.week} (${fmtRange(cur.start, cur.end)}) · ${cur.status} · đã qua ${cur.daysElapsed}/7 ngày · ${cur.count} ca · ${cur.studyDays} ngày có học. Số liệu tạm thời, tính đến hôm nay.</p>`;
  }
  if (stats.openSessions.length) {
    h += `<p class="open">${stats.openSessions.length} ca đang mở (chưa có giờ kết thúc, chưa tính phút): ` +
      stats.openSessions.map(s => `${fmtDayShort(s.date)} từ ${fmtTime(s.start)}, dòng ${s.rowNumber}`).join('; ') + `</p>`;
  }
  if (cw) {
    const prevTag = cw.prevStatus === WEEK_STATUS.PROVISIONAL ? ' <span class="tag">tạm chốt</span>' : '';
    h += `<dl class="cmp">
      <dt>So với cùng ${cw.daysElapsed} ngày đầu tuần ${cw.prevWeek}${prevTag}</dt>
      <dd>${fmtMin(cw.sameDays.cur)} so với ${fmtMin(cw.sameDays.prev)} <span class="muted">(${fmtRange(cw.sameDays.prevFrom, cw.sameDays.prevTo)})</span><br><span class="delta">${deltaText(cw.sameDays)}</span></dd>
      <dt>So với cả tuần ${cw.prevWeek}${prevTag}</dt>
      <dd>${fmtMin(cw.fullWeek.cur)} so với ${fmtMin(cw.fullWeek.prev)} <span class="muted">(7 ngày, ${fmtRange(cw.fullWeek.prevFrom, cw.fullWeek.prevTo)})</span><br><span class="delta">${deltaText(cw.fullWeek)}</span></dd>
    </dl>`;
  }
  if (fc) {
    h += `<div class="forecast"><p><span class="tag">dự báo</span> Nếu những ngày còn lại theo nhịp trung bình của tuần ${fc.baseWeeks.join(', ')}, cuối tuần ${fc.week} khoảng <b>${fmtHours(fc.forecastMin)}</b>.</p>
      <details><summary>Cách tính</summary><p class="muted">Dự báo = phút các ngày đã qua trước hôm nay (${fmtMin(fc.before)}) + lớn hơn trong hai số: phút hôm nay (${fmtMin(fc.today)}) hoặc nhịp ngày r + r × ${fc.remainingDays} ngày còn lại.
      r = trung bình phút mỗi ngày lịch của tuần ${fc.baseWeeks.join(', ')} = ${fmtMin(fc.ratePerDay)}/ngày. Giả định: các ngày còn lại giống trung bình đó; app không biết trước ngày bận hay ngày nghỉ.</p></details></div>`;
  }
  $('this-week').innerHTML = h;

  // --- Tháng này vs tháng trước ---
  const cm = compareMonths(stats);
  $('this-month').innerHTML = `<p class="big">${fmtHours(cm.cur)}</p>
    <p class="muted">Tháng ${monthLabel(cm.y, cm.m)}, ngày 1–${cm.day} (${fmtRange(cm.from, cm.to)})</p>
    <dl class="cmp"><dt>So với cùng ${cm.day} ngày đầu tháng ${monthLabel(cm.py, cm.pm)}</dt>
    <dd>${fmtMin(cm.cur)} so với ${fmtMin(cm.prev)} <span class="muted">(${fmtRange(cm.prevFrom, cm.prevTo)})</span><br>
    ${cm.notEnoughData ? `<span class="tag">chưa đủ tháng</span> <span class="muted">Dữ liệu chỉ có từ ${fmtDate(stats.weeks[0].start)}, nên không tính % tăng/giảm.</span>` : `<span class="delta">${deltaText(cm)}</span>`}</dd></dl>`;

  // --- A1 ---
  const avg = weeklyAverage(stats);
  $('a1').innerHTML = weeklyBars(stats.weeks, avg, width('a1'));
  $('a1-note').textContent = avg
    ? `Đường đứt nét: trung bình ${fmtHours(avg.avgMin)}/tuần, tính trên ${avg.weeks.length} tuần (tuần ${avg.weeks[0]}–${avg.weeks.at(-1)}${avg.includesProvisional ? ', có tuần tạm chốt' : ''}), không tính tuần Đang diễn ra. Cột sọc = tuần Đang diễn ra (tạm thời).`
    : 'Chưa có tuần nào đã qua để tính trung bình.';

  // --- A3 ---
  const acts = breakdown(sessions, stats.weeks[0].start, t, 'activity');
  $('a3').innerHTML = activityBar(acts, width('a3'));
  $('a3-legend').innerHTML = `<table><thead><tr><th>Hoạt động</th><th class="num">Giờ</th><th class="num">Tỷ lệ</th><th class="num">Số ca</th></tr></thead><tbody>` +
    acts.map(a => `<tr><td><span class="sw" style="background:${activityColorVar(a.key)}"></span>${esc(a.key)}</td><td class="num">${fmtHours(a.min)}</td><td class="num">${fmtPct(a.share)}</td><td class="num">${a.count}</td></tr>`).join('') +
    `</tbody></table><p class="muted">Tính từ ${fmtDate(stats.weeks[0].start)} đến hôm nay; tỷ lệ trên tổng ${fmtHours(stats.totalMin)}.</p>`;

  // --- A4 ---
  $('a4').innerHTML = heatmap(stats.weeks, stats.days, t, width('a4'));
  $('a4-legend').innerHTML = HEAT_BINS.map((b, i) => `<span><i class="cell-sw h${i}"></i>${b.label}</span>`).join('') +
    `<span><i class="cell-sw busy"></i>Bận đi làm (B)</span><span><i class="cell-sw today-sw"></i>Hôm nay</span>`;

  // --- Xếp hạng (1): tuần ---
  const rw = rankWeeks(stats);
  $('rank-weeks').innerHTML = `<table><thead><tr><th>Hạng</th><th>Tuần</th><th class="num">Giờ</th><th class="num">Số ca</th><th class="num">Ngày<br>có học</th></tr></thead><tbody>` +
    rw.ranked.map(w => `<tr><td>${w.rank}</td><td class="nowrap">T${w.week} <span class="muted range">${fmtRange(w.start, w.end)}</span>${w.status === WEEK_STATUS.PROVISIONAL ? ' <span class="tag">tạm chốt</span>' : ''}</td><td class="num">${fmtHours(w.min)}</td><td class="num">${w.count}</td><td class="num">${w.studyDays}/7</td></tr>`).join('') +
    `</tbody></table>` +
    (rw.current ? `<p class="muted">Tuần ${rw.current.week} đang diễn ra, chưa xếp hạng. Tạm thời: ${fmtHours(rw.current.min)}, ${rw.current.count} ca, ${rw.current.daysElapsed}/7 ngày đã qua.</p>` : '') +
    (rw.ranked.some(w => w.status === WEEK_STATUS.PROVISIONAL) ? `<p class="muted">"Tạm chốt": tuần liền trước, còn được ghi bù nên tổng có thể đổi.</p>` : '');

  // --- Xếp hạng (2): chủ đề / nhóm trong tuần được chọn ---
  $('week-select').innerHTML = stats.weeks.map(w => `<option value="${w.week}" ${w.week === selectedWeek ? 'selected' : ''}>Tuần ${w.week} (${fmtRange(w.start, w.end)}) · ${w.status}</option>`).join('');
  renderWeekBreakdown();

  // --- Xếp hạng (3): thứ trong tuần ---
  const wd = rankWeekdays(stats);
  $('rank-weekdays').innerHTML = `<table><thead><tr><th>Hạng</th><th>Thứ</th><th class="num">Tổng</th><th class="num">Số lần<br>xuất hiện</th><th class="num">TB mỗi lần</th></tr></thead><tbody>` +
    [...wd.rows].sort((a, b) => a.rank - b.rank).map(r => `<tr><td>${r.rank}</td><td class="nowrap">${WEEKDAY_NAMES[r.weekday]}</td><td class="num">${fmtHours(r.min)}</td><td class="num">${r.occurrences}</td><td class="num">${r.avgMin === null ? '—' : fmtHours(r.avgMin)}</td></tr>`).join('') +
    `</tbody></table><p class="muted">Khoảng tính: ${fmtRange(wd.from, wd.to)} (đến hết hôm qua). "Số lần xuất hiện" = số ngày lịch có thứ đó trong khoảng, kể cả ngày không học; TB mỗi lần = tổng ÷ số lần xuất hiện.</p>`;

  // --- Tổng quan + vấn đề dữ liệu ---
  $('totals').textContent = `Từ ${fmtDate(stats.weeks[0].start)} đến hôm nay: ${fmtHours(stats.totalMin)} · ${stats.rowsWithTime} ca · ${stats.studyDays} ngày có học.`;
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
