// page-today.js — Trang "Hôm nay" (L4.5): câu khích lệ, nút Thêm ca, ca đang mở, vòng tiến độ, ô Tuần này.
// Chỉ vẽ. Số liệu lấy từ core.js / insights.js / stats-extra.js. Nút chỉ MỞ form (luồng ghi vẫn ở form.js).
import { WEEK_STATUS, WEEKDAY_NAMES, weekday, weekNo, fmtDate } from './core.js';
import { breakdown } from './insights.js';
import { dayMinutes, weekDays, weekVsPrevByDay, latestOpen } from './stats-extra.js';
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
  $('week').addEventListener('click', () => { $('sheet').showModal(); renderSheet(); });
  $('sheet-close').addEventListener('click', () => $('sheet').close());
}

let model = null, lastTodayMin = null;

// nowMin: phút hiện tại trong ngày (giờ VN); canFinish: form đang bật (không phải chế độ xem mẫu)
export function renderToday(m, { nowMin, canFinish }) {
  model = m;
  const { stats, sessions } = m, t = stats.today;
  $('today-line').textContent = `${WEEKDAY_NAMES[weekday(t)]}, ${fmtDate(t)} · tuần ${weekNo(t)}`;

  // --- Ca đang mở (mới nhất) ---
  const o = latestOpen(stats, nowMin);
  $('open-card').hidden = !o;
  if (o) {
    const s = o.session, sameWeek = weekNo(s.date) === weekNo(t);
    $('open-body').innerHTML = `<div>
        <p class="time">${s.date === t ? '' : `${fmtDayShort(s.date)} · `}từ ${fmtTime(s.start)}${o.runningMin !== null ? ` · ${fmtHM(o.runningMin)}` : ''}</p>
        ${chip(s.category, s.topic ?? '')}
        <p class="muted">Ca chưa đóng thì chưa tính giờ: phút đang chạy chưa cộng vào tổng, vòng và huy hiệu.</p>
        ${o.others ? `<p class="muted">Còn ${o.others} ca đang mở khác, xem ở tab Lịch.</p>` : ''}
      </div>
      ${canFinish && sameWeek ? `<button class="btn3d small" type="button" data-finish="${s.rowNumber}">Kết thúc ca</button>` : ''}`;
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
  // Ăn mừng khi vừa chạm mục tiêu trong lúc đang mở app (không ăn mừng lại mỗi lần tải trang)
  if (lastTodayMin !== null && lastTodayMin < UI.goalDayMin && min >= UI.goalDayMin) setTimeout(() => party([$('peek'), $('brand-mochi')]), 900);
  lastTodayMin = min;

  // --- Tuần này: tổng + 7 ô ngày ---
  const cur = stats.weeks.find(w => w.status === WEEK_STATUS.CURRENT);
  $('week-num').textContent = fmtH1(cur?.min ?? 0);
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
