// page-stats.js — Trang "Thống kê" (L4.5). Chỉ vẽ; số liệu từ insights.js (L3, không đổi) và stats-extra.js (mới).
// Không ghi công thức lên màn hình: cách tính nằm trong tooltip (rê chuột / chạm).
import { WEEK_STATUS, ACTIVITIES, CATEGORIES, WEEKDAY_NAMES, fmtDate } from './core.js';
import { rankWeeks, weeklyAverage, breakdown, rankWeekdays, compareWeeks, compareMonths, forecastWeek } from './insights.js';
import { timeOfDay } from './stats-extra.js';
import { fmtHours, fmtH1, fmtHM, fmtDiff, fmtPct, fmtDayShort, fmtRange, monthLabel } from './format.js';
import { UI, catStyle } from './ui-config.js';
import { esc, barChart, pairRows, W } from './ui-charts.js';
import { chip } from './page-today.js';

const $ = id => document.getElementById(id);
const SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const MILESTONES = [10, 25, 50, 100, 150, 200, 300, 500, 750, 1000]; // CHỖ TRỐNG huy hiệu L5
let model = null, rankTab = 'w';

export function initStats() {
  $('st-rank-tabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    rankTab = b.dataset.v;
    $('st-rank-tabs').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderRank();
  });
  $('st-badges').innerHTML = MILESTONES.map(h => `<span class="badge" data-tip="Huy hiệu ${h} giờ · sẽ làm ở L5">${h}<br>giờ</span>`).join('');
}

export function renderStats(m) {
  model = m;
  const { stats } = m;
  $('totals').textContent = `Từ ${fmtDate(stats.weeks[0].start)} đến hôm nay: ${fmtHours(stats.totalMin)} · ${stats.rowsWithTime} ca · ${stats.studyDays} ngày có học`;
  renderCmpWeek(); renderPace(); renderMonth(); renderWeeks(); renderCats();
  renderActs(); renderWeekday(); renderTod(); renderRank();
}

// 1. Tuần này so với tuần trước: cùng số ngày đầu tuần + cả tuần trước
function renderCmpWeek() {
  const cw = compareWeeks(model.stats);
  if (!cw) { $('st-cmpweek').innerHTML = '<p class="sub2">Tuần đầu tiên: chưa có tuần trước để so.</p>'; return; }
  const tag = cw.prevStatus === WEEK_STATUS.PROVISIONAL ? ' <span class="tagp">tạm chốt</span>' : '';
  const n = cw.daysElapsed, a = cw.sameDays, f = cw.fullWeek;
  let h = '';
  if (n < 7) {
    h += `<p class="sub2">${n} ngày đầu tuần (${fmtDayShort(a.from)}–${fmtDayShort(a.to)})</p>` +
      pairRows([{ lab: `Tuần ${cw.week}`, v: a.cur, cls: 'cur', tip: `Tuần ${cw.week}, ${n} ngày đầu: ${fmtHM(a.cur)}` },
        { lab: `Tuần ${cw.prevWeek}`, v: a.prev, cls: 'prev', tip: `Tuần ${cw.prevWeek}, cùng ${n} ngày đầu (${fmtRange(a.prevFrom, a.prevTo)}): ${fmtHM(a.prev)}` }]) +
      `<p><b class="big2">${fmtDiff(a.diff)}</b>${a.pct !== null ? ` <span class="muted">(${pct(a.pct)})</span>` : ''}</p>`;
  }
  h += `<p class="sub2">So với cả tuần ${cw.prevWeek}${tag}</p>` +
    pairRows([{ lab: `Tuần ${cw.week}`, v: f.cur, cls: 'cur', tip: `Tuần ${cw.week}${n < 7 ? ' (đến hôm nay)' : ''}: ${fmtHM(f.cur)}` },
      { lab: `Tuần ${cw.prevWeek}`, v: f.prev, cls: 'prev', tip: `Cả tuần ${cw.prevWeek} (${fmtRange(f.prevFrom, f.prevTo)}): ${fmtHM(f.prev)}` }]) +
    (n < 7 ? `<p class="sub2">Tuần này còn ${7 - n} ngày nữa</p>` : `<p><b class="big2">${fmtDiff(f.diff)}</b>${f.pct !== null ? ` <span class="muted">(${pct(f.pct)})</span>` : ''}</p>`);
  $('st-cmpweek').innerHTML = h;
}
// Nhãn gần mép phải thì canh phải, gần mép trái thì canh trái (không tràn khỏi thẻ)
const side = f => (f > 0.7 ? 'al-r' : f < 0.2 ? 'al-l' : '');
const pct = p => `${p > 0 ? '+' : p < 0 ? '−' : '±'}${fmtPct(Math.abs(p))}`;

// 2. Nhịp độ cuối tuần [DỰ ĐOÁN]: công thức L3 (insights.forecastWeek), không đổi
function renderPace() {
  const fc = forecastWeek(model.stats);
  if (!fc) { $('st-pace').innerHTML = '<p class="sub2">Cần ít nhất 1 tuần đã qua để dự báo.</p>'; return; }
  const goal = UI.goalWeekMin, scale = Math.max(fc.forecastMin, goal) * 1.1, pc = x => `${(x / scale) * 100}%`;
  const tip = [`Đã học: ${fmtHM(fc.soFar)}`, `Dự báo cuối tuần ${fc.week}: khoảng ${fmtH1(fc.forecastMin)}`,
    `Cách tính: phút đã học + những ngày còn lại theo nhịp trung bình mỗi ngày của tuần ${fc.baseWeeks.join(', ')} (${Math.round(fc.ratePerDay)} phút/ngày); hôm nay tính ít nhất bằng nhịp đó.`,
    'Giả định: app không biết trước ngày bận hay ngày nghỉ.'].join('\n');
  $('st-pace').innerHTML = `<div class="pace-wrap" data-tip="${esc(tip)}">
      <div class="pace"><span class="done growx" style="width:${pc(fc.soFar)}"></span>
      <span class="more" style="left:${pc(fc.soFar)};width:${pc(Math.max(0, fc.forecastMin - fc.soFar))}"></span>
      <span class="goal" style="left:${pc(goal)}"><span class="${side(goal / scale)}">mục tiêu ${fmtHM(goal)}</span></span>
      <span class="end ${side(fc.forecastMin / scale)}" style="left:${pc(fc.forecastMin)}">≈ ${fmtH1(fc.forecastMin)}</span></div></div>
    <p class="sub2">Đã học ${fmtHM(fc.soFar)} · phần sọc là dự báo</p>`;
}

// 3. Tháng này so với tháng trước (cùng số ngày đầu tháng)
function renderMonth() {
  const cm = compareMonths(model.stats);
  const ml = (y, m) => `Tháng ${monthLabel(y, m)}`;
  $('st-month').innerHTML = `<p class="sub2">Ngày 1–${cm.day} của ${ml(cm.y, cm.m).toLowerCase()} và ${ml(cm.py, cm.pm).toLowerCase()}</p>` +
    pairRows([{ lab: `Tháng ${cm.m}`, v: cm.cur, cls: 'cur', tip: `${ml(cm.y, cm.m)}, ${fmtRange(cm.from, cm.to)}: ${fmtHM(cm.cur)}` },
      { lab: `Tháng ${cm.pm}`, v: cm.prev, cls: 'prev', tip: `${ml(cm.py, cm.pm)}, ${fmtRange(cm.prevFrom, cm.prevTo)}: ${fmtHM(cm.prev)}${cm.notEnoughData ? `\nDữ liệu chỉ có từ ${fmtDate(model.stats.weeks[0].start)}` : ''}` }]) +
    (cm.notEnoughData ? `<p class="sub2"><span class="tagp">chưa đủ tháng</span> dữ liệu chỉ có từ ${fmtDate(model.stats.weeks[0].start)}, nên không tính % tăng/giảm</p>`
      : `<p><b class="big2">${fmtDiff(cm.diff)}</b>${cm.pct !== null ? ` <span class="muted">(${pct(cm.pct)})</span>` : ''}</p>`);
}

// 4. Tổng giờ theo tuần + đường trung bình (không tính tuần đang diễn ra)
function renderWeeks() {
  const { stats } = model, avg = weeklyAverage(stats);
  barChart($('st-weeks'), stats.weeks.map(w => {
    const cur = w.status === WEEK_STATUS.CURRENT;
    return { v: w.min, label: `T${w.week}`, partial: cur,
      sub: cur ? 'đang' : w.status === WEEK_STATUS.PROVISIONAL ? 'tạm' : fmtDayShort(w.start),
      tip: [`Tuần ${w.week} (${fmtRange(w.start, w.end)}) · ${w.status}`, `${fmtHM(w.min)} · ${w.count} ca · ${w.studyDays} ngày có học`, cur ? `Tạm thời: mới qua ${w.daysElapsed}/7 ngày` : ''].filter(Boolean).join('\n') };
  }), { avg: avg?.avgMin ?? null });
  $('st-weeks-foot').textContent = avg ? `Đường đứt nét: trung bình ${fmtH1(avg.avgMin)}/tuần của tuần ${avg.weeks[0]}–${avg.weeks.at(-1)} (không tính tuần đang diễn ra). Cột sọc = tuần đang diễn ra.` : '';
}

// 5. Theo nhóm học: cột chồng mỗi tuần
function renderCats() {
  const { stats, sessions } = model;
  const per = stats.weeks.map(w => ({ w, parts: breakdown(sessions, w.start, Math.min(w.end, stats.today), 'category') }));
  const seen = new Set(per.flatMap(p => p.parts.map(x => x.key)));
  const order = [...CATEGORIES.filter(c => seen.has(c)), ...[...seen].filter(c => !CATEGORIES.includes(c))];
  $('st-cat-legend').innerHTML = order.map(c => chip(c)).join('');
  const el = $('st-cats'), w = W(el), h = 200, m = { t: 12, b: 30 }, ih = h - m.t - m.b;
  const max = Math.max(1, ...stats.weeks.map(x => x.min)) * 1.05, band = w / per.length, bw = Math.min(46, band * 0.62);
  let s = `<svg viewBox="0 0 ${w} ${h}" role="img"><line class="grid-l" x1="0" x2="${w}" y1="${m.t + ih}" y2="${m.t + ih}"/>`;
  per.forEach(({ w: wk, parts }, i) => {
    const cx = band * i + band / 2;
    let y = m.t + ih;
    const by = Object.fromEntries(parts.map(p => [p.key, p.min]));
    const tip = [`Tuần ${wk.week}${wk.status === WEEK_STATUS.CURRENT ? ' (đến hôm nay)' : ''}`, ...order.map(c => `${c}: ${fmtHM(by[c] ?? 0)}`)].join('\n');
    s += `<g class="mk" tabindex="0" data-tip="${esc(tip)}"><rect class="hit" x="${cx - band / 2}" y="${m.t}" width="${band}" height="${ih}"/><g class="grow" style="animation-delay:${i * 60}ms">`;
    for (const c of order) {
      const v = by[c] ?? 0;
      if (!v) continue;
      const hh = (v / max) * ih;
      y -= hh;
      s += `<rect class="b" x="${cx - bw / 2}" y="${y + 1}" width="${bw}" height="${Math.max(0, hh - 2)}" rx="4" fill="${catStyle(c).color}"/>`;
    }
    s += `</g></g><text x="${cx}" y="${h - 6}" text-anchor="middle">T${wk.week}</text>`;
  });
  el.innerHTML = s + `</svg>`;
}

// 6. Theo hoạt động: thanh 100% + danh sách (màu cố định theo thứ tự hoạt động)
const actColor = a => { const i = ACTIVITIES.indexOf(a); return i >= 0 ? `var(--a${i + 1})` : 'var(--grey-cat)'; };
function renderActs() {
  const { stats, sessions } = model;
  const acts = breakdown(sessions, stats.weeks[0].start, stats.today, 'activity')
    .sort((a, b) => (ACTIVITIES.indexOf(a.key) + 99) % 99 - (ACTIVITIES.indexOf(b.key) + 99) % 99);
  const tot = acts.reduce((a, x) => a + x.min, 0) || 1, el = $('st-acts'), w = W(el), gap = 2;
  let x = 0, s = `<svg viewBox="0 0 ${w} 48" role="img">`;
  acts.forEach((a, i) => {
    const ww = Math.max(1, (a.min / tot) * (w - gap * (acts.length - 1)));
    s += `<g class="mk" tabindex="0" data-tip="${esc(`${a.key}\n${fmtHM(a.min)} · ${fmtPct(a.share)} · ${a.count} ca`)}"><rect class="b growx" style="animation-delay:${i * 70}ms" x="${x}" y="2" width="${ww}" height="44" rx="8" fill="${actColor(a.key)}"/></g>`;
    x += ww + gap;
  });
  el.innerHTML = s + `</svg>`;
  $('st-acts-list').innerHTML = acts.map(a => `<li data-tip="${esc(`${fmtHours(a.min)} · ${a.count} ca`)}"><i style="background:${actColor(a.key)}"></i><span>${esc(a.key)}</span><b>${fmtPct(a.share)}</b></li>`).join('');
}

// 7. Theo thứ: trung bình mỗi lần thứ đó xuất hiện (kể cả ngày không học), tính đến hết hôm qua (insights.rankWeekdays)
function renderWeekday() {
  const wd = rankWeekdays(model.stats);
  barChart($('st-wd'), wd.rows.map(r => ({ v: r.avgMin ?? 0, label: SHORT[r.weekday],
    tip: `${WEEKDAY_NAMES[r.weekday]}: trung bình ${r.avgMin === null ? '—' : fmtHM(r.avgMin)} mỗi lần\n(${r.occurrences} lần, tổng ${fmtHM(r.min)}; tính ${fmtRange(wd.from, wd.to)})` })), { h: 180, color: 'var(--a3)' });
}

// 8. Theo khung giờ (phép tính mới stats-extra.timeOfDay)
function renderTod() {
  const { stats, sessions } = model;
  const tod = timeOfDay(sessions, stats.weeks[0].start, stats.today), tot = tod.reduce((a, b) => a + b.min, 0) || 1;
  barChart($('st-tod'), tod.map(b => ({ v: b.min, label: b.key, sub: b.label.replace(' giờ', 'h'),
    tip: `${b.key} (${b.label}): ${fmtHM(b.min)} · ${fmtPct(b.min / tot)}\nCa vắt qua 2 khung được chia phút cho từng khung.` })), { h: 190, color: 'var(--a4)' });
}

// 9. Xếp hạng: tuần / chủ đề / thứ (gộp 3 bảng L3)
function renderRank() {
  const { stats, sessions } = model;
  let rows, foot = '';
  if (rankTab === 'w') {
    const r = rankWeeks(stats);
    rows = r.ranked.map(w => [w.rank, `Tuần ${w.week}`, `${fmtRange(w.start, w.end)}${w.status === WEEK_STATUS.PROVISIONAL ? ' · tạm chốt' : ''}`, fmtHM(w.min), `${w.count} ca · ${w.studyDays}/7 ngày có học`]);
    if (r.current) foot = `Tuần ${r.current.week} đang diễn ra, chưa xếp hạng (tạm thời ${fmtHM(r.current.min)}).`;
  } else if (rankTab === 't') {
    rows = breakdown(sessions, stats.weeks[0].start, stats.today, 'topic').map((t, i) => [i + 1, t.key, '', fmtHM(t.min), `${fmtPct(t.share)} · ${t.count} ca`]);
  } else {
    const wd = rankWeekdays(stats);
    rows = [...wd.rows].sort((a, b) => a.rank - b.rank).map(r => [r.rank, WEEKDAY_NAMES[r.weekday], `TB mỗi lần · ${r.occurrences} lần`, r.avgMin === null ? '—' : fmtHM(r.avgMin), `tổng ${fmtHM(r.min)}`]);
    foot = `Tính ${fmtRange(wd.from, wd.to)} (đến hết hôm qua), kể cả ngày không học.`;
  }
  $('st-rank').innerHTML = rows.map(([n, a, b, v, tip]) => `<li data-tip="${esc(tip)}"><span class="n">${n}</span><span>${esc(a)}${b ? `<br><span class="muted">${esc(b)}</span>` : ''}</span><span class="r">${esc(v)}</span></li>`).join('');
  $('st-rank-foot').textContent = foot;
}
