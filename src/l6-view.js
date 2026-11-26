// l6-view.js — Phần HIỂN THỊ của L6: nút tròn góc trên (chuỗi, số dư ngày nghỉ), tấm chi tiết, thanh báo ngày chưa có ca,
// thẻ gợi ý quy đổi, thẻ nhắc nghỉ, thẻ Cài đặt, danh sách ngày chưa có ca ở tab Lịch, ăn mừng mốc chuỗi.
// Chỉ vẽ: phép tính ở rest.js / streak.js (có test). Ghi Sheet ở rest-ui.js (đánh dấu nghỉ, quy đổi).
// localStorage chỉ giữ tùy chọn của MÁY NÀY (không lưu số liệu Sheet):
//   tt-remind (bật/tắt nhắc nghỉ), tt-miss (bật/tắt báo ngày chưa có ca), tt-conv-later (tháng đã bấm "Để sau"),
//   tt-streak-seen (mốc chuỗi đã ăn mừng).
import { WEEKDAY_NAMES, weekday, weekStart, weekEnd, fmtDate } from './core.js';
import { restSummary, conversionSuggestion, fmtVnd } from './rest.js';
import { DAY, classifyDays, streaks, restReminder, missedToFix, STREAK_MILESTONES, streakMilestonesReached } from './streak.js';
import { fmtHM, fmtDayShort } from './format.js';
import { esc, MOON, COIN, FLAME, BOX } from './ui-charts.js';
import { mochiSvg } from './mochi.js';

const $ = id => document.getElementById(id);

// ---------- Tùy chọn trên máy này ----------
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* chế độ riêng tư: bỏ qua */ } },
};
export const prefs = {
  remind: () => ls.get('tt-remind') !== '0',   // mặc định bật (Phần A, quyết định h)
  miss: () => ls.get('tt-miss') !== '0',       // mặc định bật (quyết định k)
  convLater: () => ls.get('tt-conv-later'),    // khóa tháng "YYYY-MM" đã bấm "Để sau"
};

// ---------- Ký hiệu ----------
// Huy hiệu ngọn lửa 11×14 cho mốc chuỗi: o viền, f lửa, y lõi sáng (thiết kế gốc)
const FL = ['....o......', '...ofo..o..', '...offo.ofo', '..offfoofo.', '..offffffo.', '.offfyfffo.', '.offfyyffo.', 'offfyyyfffo', 'offyyyyyffo', 'offyyyyyffo', 'offyyyyyffo', '.offyyyffo.', '..offfffo..', '...ooooo...'];
export function flameBadge(on) {
  const C = on ? { o: 'var(--mochi-line)', f: 'var(--streak)', y: 'var(--streak-on)' } : { o: 'var(--grey-cat)', f: 'var(--surface-2)', y: 'var(--border)' };
  let r = '';
  FL.forEach((row, y) => [...row].forEach((ch, x) => { if (C[ch]) r += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${C[ch]}"/>`; }));
  return `<svg viewBox="0 0 11 14" class="pixel" aria-hidden="true">${r}</svg>`;
}
export const fmtBal = b => (b < 0 ? `−${Math.abs(b)}` : String(b));
const dayLabel = d => `${WEEKDAY_NAMES[weekday(d)]} ${fmtDayShort(d)}`;
export const KIND_TEXT = { [DAY.STUDY]: 'Ngày học', [DAY.REST]: 'Ngày nghỉ', [DAY.PENDING]: 'Chờ đóng ca', [DAY.NOT_YET]: 'Hôm nay chưa có ca', [DAY.MISSED]: 'Chưa có ca nào' };

// ---------- Tính số liệu L6 cho model (gọi sau buildModel) ----------
// nowMin = phút trong ngày giờ VN; null = chế độ giả lập ngày (coi như đã qua 06:00)
export function computeL6(m, nowMin) {
  const t = m.stats.today, s = m.l6.settings;
  m.days = classifyDays(m.stats, nowMin);
  m.streak = streaks(m.days);
  m.rest = restSummary(m.sessions, m.l6.accrual.entries, t, s);
  m.conv = m.l6.accrualOk ? conversionSuggestion(m.rest, t, nowMin, s) : null; // không đọc được Tích lũy -> không gợi ý (tránh ghi trùng)
  m.remind = restReminder(m.days);
  m.missed = missedToFix(m.days, t);
  return m;
}

let model = null, opts = {};
// opts: { canWrite, onFixAdd(date), onFixRest(date), onConv() }
export function initL6(o) {
  opts = o;
  const openDetail = () => { renderDetail(); $('detail').showModal(); };
  $('pill-streak').addEventListener('click', () => model && openDetail());
  $('pill-rest').addEventListener('click', () => model && openDetail());
  $('detail-close').addEventListener('click', () => $('detail').close());
  document.addEventListener('click', e => {
    const r = e.target.closest('[data-fix-rest]');
    if (r) { if ($('detail').open) $('detail').close(); opts.onFixRest?.(Number(r.dataset.fixRest)); return; }
    const a = e.target.closest('[data-fix-add]');
    if (a) { opts.onFixAdd?.(Number(a.dataset.fixAdd)); return; }
    if (e.target.closest('[data-conv-open]')) { if ($('detail').open) $('detail').close(); opts.onConv?.(); return; }
    if (e.target.closest('[data-conv-later]')) { if (model?.conv) ls.set('tt-conv-later', model.conv.monthKey); $('conv-card').hidden = true; }
  });
  for (const [id, key] of [['sw-remind', 'tt-remind'], ['sw-miss', 'tt-miss']]) {
    $(id).setAttribute('aria-checked', String(ls.get(key) !== '0'));
    $(id).addEventListener('click', () => {
      const on = ls.get(key) === '0';
      ls.set(key, on ? '1' : '0');
      $(id).setAttribute('aria-checked', String(on));
      if (model) renderL6(model);
    });
  }
}

const fixButtons = (d, offset) => opts.canWrite?.()
  ? `<span class="acts"><button class="btn3d small ghost" type="button" data-fix-add="${d}">${offset ? 'Ghi bù ca' : 'Thêm ca'}</button><button class="btn3d small" type="button" data-fix-rest="${d}">Đánh dấu nghỉ</button></span>`
  : '';

// Vẽ mọi phần L6 (trừ heatmap: page-cal.js đọc model.days)
export function renderL6(m) {
  model = m;
  const t = m.stats.today, { streak: st, rest: r } = m, S = m.l6.settings;
  // Nút tròn góc trên
  $('pill-streak').className = 'pill live';
  $('pill-streak').innerHTML = `<span class="ic-streak">${FLAME}</span><b>${st.current}</b>`;
  $('pill-streak').setAttribute('aria-label', `Chuỗi ${st.current} ngày học. Chạm để xem chi tiết`);
  $('pill-rest').className = 'pill live';
  $('pill-rest').innerHTML = `${BOX}<b>${fmtBal(r.balance)}</b>`;
  $('pill-rest').setAttribute('aria-label', `Số dư ngày nghỉ ${fmtBal(r.balance)} ngày. Chạm để xem chi tiết`);

  // Thanh báo ngày chưa có ca: ngày gần nhất còn sửa được. Nhường chỗ cho thanh "ca chưa đóng" của L5.
  const miss = prefs.miss() && $('alert').hidden ? m.missed.at(-1) : null;
  $('alert-miss').hidden = !miss;
  if (miss) {
    const yday = miss.date === t - 1, more = m.missed.length > 1 ? ` Còn ${m.missed.length - 1} ngày khác như vậy, xem ở tab Lịch.` : '';
    $('alert-miss').innerHTML = `<span class="kao">(・ω・)</span><p class="txt"><b>${yday ? 'Hôm qua' : dayLabel(miss.date)} chưa có ca nào.</b>` +
      `${opts.canWrite?.() ? 'Muốn ghi bù ca hoặc đánh dấu nghỉ không?' : 'Ngày này đang làm đứt chuỗi.'}` +
      `${miss.offset ? ' Tuần đó đang <span class="tagp">tạm chốt</span>: ghi vào sẽ có nhãn [OFFSET].' : ''}${more}</p>${fixButtons(miss.date, miss.offset)}`;
  } else $('alert-miss').innerHTML = '';

  // Thẻ gợi ý quy đổi (tháng vừa kết thúc, từ 06:00 ngày 1). "Để sau" nhớ theo tháng trên máy này.
  const c = m.conv, showConv = !!c && prefs.convLater() !== c.monthKey;
  $('conv-card').hidden = !showConv;
  if (showConv) {
    $('conv-card').innerHTML = `<h2>Tháng ${c.m}/${c.y} còn ${c.unused} ngày nghỉ chưa dùng</h2>
      <p class="muted" style="margin:0">Có thể quy đổi tối đa ${c.days} ngày, mỗi ngày ${fmtVnd(S.moneyPerRestDay)}. Phần chưa quy đổi vẫn giữ lại, cộng dồn sang tháng sau.</p>
      <p class="amt" style="margin:10px 0 0">${fmtVnd(c.amount)}</p>
      <div class="row">${opts.canWrite?.() ? '<button class="btn3d small" type="button" data-conv-open>Quy đổi…</button>' : ''}<button class="btn3d small ghost" type="button" data-conv-later>Để sau</button></div>`;
  }


  // Cài đặt
  $('set-bal').textContent = `${fmtBal(r.balance)} ngày`;
  $('set-conv').textContent = `${r.converted} ngày · ${fmtVnd(r.converted * S.moneyPerRestDay)}`;
  $('set-quota').textContent = `${S.restQuotaPerMonth} ngày mỗi tháng từ ${fmtDate(S.restAccrualStart)} · ${fmtVnd(S.moneyPerRestDay)}/ngày · ${m.l6.fromSheet ? 'đọc từ tab Cài đặt của Sheet' : 'giá trị mặc định (chưa đọc được tab Cài đặt)'}`;
  const warns = [...m.l6.warnings, ...m.l6.accrual.issues.map(i => `Dòng ${i.rowNumber}: ${i.msg}`)];
  $('set-l6-warn').hidden = !warns.length;
  $('set-l6-warn-txt').textContent = warns.join(' ');
  $('set-cur').textContent = `${st.current} ngày học`;
  $('set-long').textContent = `${st.longest} ngày học`;
  $('set-miles').textContent = `${streakMilestonesReached(st.longest).length}/${STREAK_MILESTONES.length} mốc đã đạt (${STREAK_MILESTONES.join(', ')} ngày) · mỗi mốc ăn mừng 1 lần trên máy này`;
  if ($('detail').open) renderDetail();
}

// ---------- Tấm chi tiết ----------
function renderDetail() {
  const m = model, { streak: st, rest: r } = m, S = m.l6.settings;
  const miles = STREAK_MILESTONES.map(x => `<button class="smile ${st.longest >= x ? '' : 'lock'}" type="button" data-tip="${st.longest >= x ? `${x} ngày học liền · đã đạt` : `${x} ngày học liền · chuỗi hiện tại cần thêm ${x - st.current} ngày`}">${flameBadge(st.longest >= x)}<b>${x}</b><span>ngày</span></button>`).join('');
  const nx = STREAK_MILESTONES.find(x => x > st.longest); // mốc chưa từng đạt
  const months = r.months.map(mo => {
    const used = mo.dates.length, over = Math.max(0, used - mo.quota);
    const slots = Array.from({ length: Math.max(mo.quota, used) }, (_, i) => i < Math.min(used, mo.quota) ? `<span class="slot used" data-tip="${fmtDate(mo.dates[i])}">${MOON}</span>`
      : i < mo.quota ? '<span class="slot" aria-hidden="true"></span>' : `<span class="slot over" data-tip="${fmtDate(mo.dates[i])} · dùng trước">${MOON}</span>`).join('') +
      Array.from({ length: mo.converted }, () => `<span class="slot conv">${COIN}</span>`).join('');
    return `<div class="mrow"><span class="mk">${String(mo.m).padStart(2, '0')}/${mo.y}</span><span class="slots" aria-label="Tháng ${mo.m}: dùng ${used} trên ${mo.quota} ngày">${slots}</span>
      <p class="mtxt">Dùng ${used}/${mo.quota} ngày${used ? ` (${mo.dates.map(fmtDayShort).join(', ')})` : ''}${over ? ` · dùng trước ${over} ngày của tháng sau` : ''}${mo.converted ? ` · đã quy đổi ${mo.converted}` : ''}</p></div>`;
  }).join('');
  const conv = m.conv && opts.canWrite?.() ? `<p style="margin:10px 0 0"><button class="btn3d small" type="button" data-conv-open>Quy đổi tháng ${m.conv.m}/${m.conv.y}…</button></p>` : '';
  $('detail-body').innerHTML = `
    <section><h3 style="margin:0 0 4px">Chuỗi ngày học</h3>
      <div class="kpi"><span class="n">${st.current}</span><span class="u">ngày học</span></div>
      <p class="sub-line">${st.current ? `Từ ${fmtDate(st.currentFrom)}` : 'Bắt đầu lại từ hôm nay nhé (＾▽＾)'} · dài nhất ${st.longest} ngày${st.longestFrom ? ` (${fmtDayShort(st.longestFrom)}–${fmtDate(st.longestTo)})` : ''}</p>
      <p class="sub-line">Ngày nghỉ không cộng vào chuỗi và cũng không làm đứt chuỗi.</p>
      <div class="smiles">${miles}</div>
      ${nx ? `<div class="next6"><div class="row"><b>Mốc mới tiếp theo: ${nx} ngày</b><span class="muted">chuỗi hiện tại cần thêm ${nx - st.current} ngày học</span></div><div class="bar" role="img" aria-label="${st.current} trên ${nx} ngày"><i style="width:${Math.min(100, (st.current / nx) * 100)}%"></i></div></div>` : ''}
    </section>
    <section style="margin-top:20px"><h3 style="margin:0 0 4px">Ngày nghỉ</h3>
      <div class="kpi"><span class="n">${fmtBal(r.balance)}</span><span class="u">ngày còn lại</span></div>
      <p class="sub-line">${r.balance < 0 ? `Đã dùng trước ${Math.abs(r.balance)} ngày. Mỗi tháng mới cộng thêm ${S.restQuotaPerMonth} ngày.` : `Mỗi tháng ${S.restQuotaPerMonth} ngày, ngày chưa dùng cộng dồn sang tháng sau.`}</p>
      ${months}
      <div class="mrow"><span class="mk">Quy đổi</span><span>${r.converted} ngày · ${fmtVnd(r.converted * S.moneyPerRestDay)}</span></div>
      ${conv}
      <div class="legend6"><span><span class="slot used">${MOON}</span>đã nghỉ</span><span><span class="slot"></span>còn trống</span><span><span class="slot over">${MOON}</span>dùng trước</span><span><span class="slot conv">${COIN}</span>đã quy đổi</span></div>
    </section>`;
}

// ---------- Tab Lịch: ngày chưa có ca của tuần đang xem (còn sửa được) ----------
export function renderCalMiss(week) {
  const box = $('cal-miss');
  if (!model || !box) return;
  const ws = weekStart(week), we = weekEnd(week);
  const list = model.missed.filter(x => x.date >= ws && x.date <= we);
  box.hidden = !list.length;
  box.innerHTML = !list.length ? '' : `<h3>Ngày chưa có ca</h3><p class="muted" style="margin:0">Những ngày này đang làm đứt chuỗi. Đã học thật thì ghi bù ca; nghỉ thì đánh dấu nghỉ.</p>` +
    list.map(x => `<div class="drow"><div><span class="d">${dayLabel(x.date)}</span><p class="k">${KIND_TEXT[DAY.MISSED]}${x.offset ? ' · tuần tạm chốt, ghi vào có nhãn [OFFSET]' : ''}</p></div>${fixButtons(x.date, x.offset) || '<span></span>'}</div>`).join('');
}

