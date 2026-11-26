// page-today.js — Trang "Hôm nay" (L4.5): câu khích lệ, nút Thêm ca, ca đang mở, vòng tiến độ, ô Tuần này.
// Chỉ vẽ. Số liệu lấy từ core.js / insights.js / stats-extra.js. Nút chỉ MỞ form (luồng ghi vẫn ở form.js).
import { WEEK_STATUS, WEEKDAY_NAMES, weekday, weekNo, fmtDate } from './core.js';
import { breakdown } from './insights.js';
import { dayMinutes, weekDays, weekVsPrevByDay, latestOpen, staleOpen, closeAction, weekRing, avg4Marker } from './stats-extra.js';
import { fmtH1, fmtHM, fmtDiff, fmtTime, fmtDayShort } from './format.js';
import { UI, QUOTE, catStyle } from './ui-config.js';
import { mochiSvg, party, jump } from './mochi.js';
import { esc, barChart, pairRows, pairBars } from './ui-charts.js';

const $ = id => document.getElementById(id);
const SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const RING_C = 314.16; // chu vi vòng r = 50

export const chip = (category, text = category) => {
  const c = catStyle(category);
  return `<span class="chip ${c.cls}">${c.kao ? `${c.kao} ` : ''}${esc(text)}</span>`;
};

export function initToday({ onAdd, onFinish }) {
  $('quote-jp').innerHTML = QUOTE.jp.map(p => `<span>${esc(p)}</span>`).join('');
  $('quote-vi').textContent = QUOTE.vi;
  $('peek').innerHTML = mochiSvg();
  $('peek').addEventListener('click', () => jump($('peek')));
  $('add').addEventListener('click', onAdd);
  $('open-card').addEventListener('click', e => {
    const b = e.target.closest('button[data-finish]');
    if (b) onFinish(Number(b.dataset.finish));
  });
  $('alert').addEventListener('click', e => {
    const b = e.target.closest('button[data-finish]');
    if (b) onFinish(Number(b.dataset.finish));
  });
  $('week').addEventListener('click', () => { $('sheet').showModal(); renderSheet(); });
  $('sheet-close').addEventListener('click', () => $('sheet').close());
}

let model = null, lastTodayMin = null, lastWeekMin = null;

// nowMin: phút hiện tại trong ngày (giờ VN); canFinish: form đang bật (không phải chế độ xem mẫu); sheetUrl: link mở Sheet
export function renderToday(m, { nowMin, canFinish, sheetUrl }) {
  model = m;
  const { stats, sessions } = m, t = stats.today;
  $('today-line').textContent = `${WEEKDAY_NAMES[weekday(t)]}, ${fmtDate(t)} · tuần ${weekNo(t)}`;

  renderAlert(stats, nowMin, canFinish, sheetUrl);

  // --- Ca đang mở (mới nhất) ---
  const o = latestOpen(stats, nowMin);
  $('open-card').hidden = !o;
  if (o) {
    const s = o.session, closable = closeAction(s, t) === 'close';
    $('open-body').innerHTML = `<div>
        <p class="time">${s.date === t ? '' : `${fmtDayShort(s.date)} · `}từ ${fmtTime(s.start)}${o.runningMin !== null ? ` · ${fmtHM(o.runningMin)}` : ''}</p>
        ${chip(s.category, s.topic ?? '')}
        <p class="muted">Ca chưa đóng thì chưa tính giờ: phút đang chạy chưa cộng vào tổng, vòng và huy hiệu.</p>
        ${o.others ? `<p class="muted">Còn ${o.others} ca đang mở khác, xem ở tab Lịch.</p>` : ''}
      </div>
      ${canFinish && closable ? `<button class="btn3d small" type="button" data-finish="${s.rowNumber}">Kết thúc ca</button>` : ''}`;
  }

  // --- Vòng tiến độ hôm nay ---
  const min = dayMinutes(stats, t), p = Math.min(1, min / UI.goalDayMin);
  const cats = breakdown(sessions, t, t, 'category');
  $('ring-num').innerHTML = `${Math.floor(min / 60)} giờ<br>${Math.round(min % 60)} phút`;
  $('ring-goal').textContent = `trên ${fmtHM(UI.goalDayMin)}`;
  $('ring').dataset.tip = [`${Math.round(min)} phút / ${UI.goalDayMin} phút`, ...cats.map(c => `${c.key}: ${fmtHM(c.min)}`)].join('\n');
  $('ring-msg').textContent = p >= 1 ? 'Đủ mục tiêu rồi! Nghỉ ngơi xíu nha (˘ω˘)' : min > 0 ? 'Đang học đều tay nè (＾▽＾)' : `Hôm nay mình bắt đầu nhé, ${UI.name} (•ω•)`;
  $('cats').innerHTML = cats.map(c => chip(c.key)).join('');
  requestAnimationFrame(() => { $('ring-bar').style.strokeDashoffset = String(RING_C * (1 - p)); });
  // --- Tuần này (L5): vòng tuần + vạch "trung bình 4 tuần gần nhất" + 7 ô ngày ---
  const ring = weekRing(stats);
  renderWeekRing(ring, avg4Marker(stats));

  // Ăn mừng khi vừa chạm mục tiêu trong lúc đang mở app (không ăn mừng lại mỗi lần tải trang).
  // Cùng lúc đủ cả ngày lẫn tuần: chỉ ăn mừng tuần.
  const weekHit = lastWeekMin !== null && lastWeekMin < ring.goal && ring.reached;
  const dayHit = lastTodayMin !== null && lastTodayMin < UI.goalDayMin && min >= UI.goalDayMin;
  if (weekHit) setTimeout(() => party([$('peek'), $('brand-mochi')], `${mochiSvg()}<span>Đủ ${fmtHM(ring.goal)} tuần này rồi, ${esc(UI.name)}! (≧▽≦)♪</span><small>Nghỉ ngơi xíu nha</small>`), 900);
  else if (dayHit) setTimeout(() => party([$('peek'), $('brand-mochi')]), 900);
  lastTodayMin = min;
  lastWeekMin = ring.min;

  const cur = stats.weeks.find(w => w.status === WEEK_STATUS.CURRENT);
  $('days').innerHTML = cur ? weekDays(stats, cur.week).map(d =>
    `<i class="${d.min >= UI.goalDayMin ? 'full' : d.min > 0 ? 'on' : ''} ${d.date === t ? 'today' : ''}"></i>`).join('') : '';
  if ($('sheet').open) renderSheet();
}

// Tấm "Tuần này": thứ Ba (ngày cuối tuần) so với tuần trước; ngày khác xem 6 tuần gần nhất
function renderSheet() {
  if (!model) return;
  const { stats } = model, t = stats.today;
  const cmp = weekday(t) === 2 ? weekVsPrevByDay(stats) : null;
  if (cmp) {
    $('sheet-body').innerHTML = `<h2>Tuần ${cmp.week} khép lại hôm nay</h2><p class="sub2">${fmtDayShort(cmp.cur[0].date)}–${fmtDate(cmp.cur[6].date)} so với tuần ${cmp.prevWeek}</p>` +
      pairRows([{ lab: `Tuần ${cmp.week}`, v: cmp.curMin, cls: 'cur', tip: `Tuần ${cmp.week}: ${fmtHM(cmp.curMin)}` }, { lab: `Tuần ${cmp.prevWeek}`, v: cmp.prevMin, cls: 'prev', tip: `Tuần ${cmp.prevWeek}: ${fmtHM(cmp.prevMin)}` }]) +
      `<p><b class="big2">${fmtDiff(cmp.curMin - cmp.prevMin)}</b></p><div class="legend"><span class="lg"><i style="background:var(--a1)"></i>Tuần ${cmp.week}</span><span class="lg"><i style="background:var(--prev)"></i>Tuần ${cmp.prevWeek}</span></div><div class="chart" id="sheet-chart"></div>`;
    pairBars($('sheet-chart'), cmp.cur.map((d, i) => ({ a: d.min, b: cmp.prev[i].min, label: SHORT[weekday(d.date)],
      tip: `${WEEKDAY_NAMES[weekday(d.date)]}\nTuần ${cmp.week}: ${fmtHM(d.min)}\nTuần ${cmp.prevWeek}: ${fmtHM(cmp.prev[i].min)}` })));
  } else {
    const cur = stats.weeks.find(w => w.status === WEEK_STATUS.CURRENT);
    $('sheet-body').innerHTML = `<h2>6 tuần gần nhất</h2><p class="sub2">Tuần ${cur.week} đang diễn ra · mới qua ${cur.daysElapsed}/7 ngày</p><div class="chart" id="sheet-chart"></div>`;
    barChart($('sheet-chart'), stats.weeks.slice(-6).map(w => ({ v: w.min, label: `T${w.week}`, partial: w.status === WEEK_STATUS.CURRENT,
      tip: `Tuần ${w.week} (${fmtDayShort(w.start)}–${fmtDayShort(w.end)}): ${fmtHM(w.min)}${w.status === WEEK_STATUS.CURRENT ? ' (đến hôm nay)' : ''}` })), { h: 190 });
  }
}

// L5: thanh báo "ca chưa đóng" — ca mở của NGÀY TRƯỚC, chỉ từ 06:00 (giờ VN). Không bao giờ tự đóng ca.
// Ca hôm qua (tuần Đang diễn ra / Tạm chốt): nút "Đóng ca" mở form gọn. Ca cũ hơn hoặc tuần Chốt hẳn: nút "Mở Sheet".
function renderAlert(stats, nowMin, canFinish, sheetUrl) {
  const list = staleOpen(stats, nowMin);
  $('alert').hidden = !list.length;
  $('ndot').hidden = !list.length;
  $('ndot-sr').hidden = !list.length;
  if (!list.length) { $('alert').innerHTML = ''; return; }
  const { session: s, status, action } = list[0];
  const more = list.length > 1 ? ` Còn ${list.length - 1} ca chưa đóng khác, xem ở tab Lịch.` : '';
  const what = `${WEEKDAY_NAMES[weekday(s.date)]} ${fmtDayShort(s.date)}, từ ${fmtTime(s.start)} · ${esc(s.topic ?? '')}.`;
  const title = `<b>Có ${list.length} ca chưa đóng</b>`;
  $('alert').innerHTML = action === 'close'
    ? `<span class="kao">(・・?)</span><p class="txt">${title}${what} Ca chưa đóng thì chưa tính giờ.${status === WEEK_STATUS.PROVISIONAL ? ' Tuần đó đang <span class="tagp">tạm chốt</span>: chỉ điền được giờ kết thúc.' : ''}${more}</p>` +
      (canFinish ? `<button class="btn3d small" type="button" data-finish="${s.rowNumber}">Đóng ca</button>` : '')
    : `<span class="kao">(・・?)</span><p class="txt">${title}${what} ${status === WEEK_STATUS.FINAL ? 'Tuần này đã chốt hẳn.' : 'Ca này từ 2 ngày trước trở lên.'} Muốn sửa, hãy sửa trực tiếp trên Sheet.${more}</p>` +
      (sheetUrl ? `<a class="btn3d small ghost" href="${esc(sheetUrl)}" target="_blank" rel="noopener">Mở Sheet</a>` : '');
}

// L5: vòng tuần (phút tuần / mục tiêu tuần, đầy khi vượt) + vạch mốc trung bình 4 tuần đã qua gần nhất.
// Vạch nằm ở góc = TB / mục tiêu (vượt mục tiêu thì nằm ở đỉnh vòng). Chưa có tuần nào đã qua -> không có vạch.
const WR = 46, WC = 2 * Math.PI * WR;
function renderWeekRing(ring, avg) {
  let mark = '';
  if (avg) {
    const ang = Math.min(1, avg.avgMin / ring.goal) * 2 * Math.PI, c = Math.cos(ang), s = Math.sin(ang);
    mark = `<line class="mark" x1="${56 + (WR - 11) * c}" y1="${56 + (WR - 11) * s}" x2="${56 + (WR + 11) * c}" y2="${56 + (WR + 11) * s}"/>`;
  }
  $('wring').innerHTML = `<svg viewBox="0 0 112 112" aria-hidden="true"><circle class="track" cx="56" cy="56" r="${WR}" fill="none" stroke-width="14"/>` +
    `<circle class="bar" id="wring-bar" cx="56" cy="56" r="${WR}" fill="none" stroke-width="14" stroke-linecap="round" stroke-dasharray="${WC}" stroke-dashoffset="${WC}"/>${mark}</svg>` +
    `<span class="mid">${Math.round(ring.pct * 100)}%</span>`;
  requestAnimationFrame(() => requestAnimationFrame(() => { const b = $('wring-bar'); if (b) b.style.strokeDashoffset = String(WC * (1 - ring.pct)); }));
  $('week-num').innerHTML = `${fmtH1(ring.min)} <span class="of">/ ${fmtHM(ring.goal)}</span>`;
  $('week-days-txt').textContent = `${ring.studyDays}/${ring.goalDays} ngày có học`;
  const wl = avg && (avg.weeks.length > 1 ? `tuần ${avg.weeks[0]}–${avg.weeks.at(-1)}` : `tuần ${avg.weeks[0]}`);
  const prov = avg?.includesProvisional ? `, có tuần ${avg.weeks.at(-1)} <span class="tagp">tạm chốt</span>` : '';
  $('week-mark').innerHTML = !avg ? 'Chưa có tuần nào đã qua để so sánh.'
    : `<span class="legend-mark"></span>Vạch: trung bình ${avg.enough ? '4 tuần gần nhất' : `${avg.n} tuần đã qua (chưa đủ 4 tuần)`} ${fmtH1(avg.avgMin)} (${wl}${prov})` +
      (ring.reached ? '<br>Đủ mục tiêu tuần rồi. Nghỉ ngơi xíu nha (˘ω˘)' : '');
}
