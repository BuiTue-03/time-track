// page-cal.js — Tab "Lịch" (L4.5): heatmap chọn tuần + khung tuần (‹ ›) + chủ đề/nhóm của tuần + điểm cần xem lại.
// Danh sách ca, nút thêm/sửa/xóa và dải trạng thái tuần do form.js vẽ (luật khóa tuần không đổi).
import { WEEK_STATUS, WEEKDAY_NAMES, weekday, weekNo, fmtDate } from './core.js';
import { breakdown } from './insights.js';
import { weekDays } from './stats-extra.js';
import { fmtHM, fmtPct, fmtDayShort } from './format.js';
import { esc, calHeat, W } from './ui-charts.js';

const $ = id => document.getElementById(id);
// 6 mức heatmap (giữ ngưỡng của L3): 0 · <1 giờ · 1–2 · 2–3 · 3–4 · ≥4 giờ
const HEAT = [[0, '0'], [59, '< 1 giờ'], [119, '1–2 giờ'], [179, '2–3 giờ'], [239, '3–4 giờ'], [Infinity, '≥ 4 giờ']];
const level = v => HEAT.findIndex(([mx]) => v <= mx);
let model = null, api = null;

export function initCal({ getWeek, setWeek }) {
  api = { getWeek, setWeek };
  $('cal-prev').addEventListener('click', () => setWeek(getWeek() - 1));
  $('cal-next').addEventListener('click', () => setWeek(getWeek() + 1));
  $('cal-heat').addEventListener('click', e => { const c = e.target.closest('.calcell'); if (c) setWeek(Number(c.dataset.week)); });
  $('cal-heat-legend').innerHTML = `Ít ${HEAT.map((_, k) => `<i style="background:var(--h${k})"></i>`).join('')} Nhiều <i class="busy-sw"></i> Bận`;
}

export function renderCal(m) {
  model = m;
  const { issues } = m;
  $('issues').hidden = !issues.length;
  $('issues').innerHTML = `<summary>${issues.length} điểm cần xem lại trong Sheet</summary><ul>` +
    issues.map(i => `<li>Dòng ${i.rowNumber}: ${esc(i.msg)}</li>`).join('') + `</ul>`;
  onWeek(api.getWeek() ?? weekNo(m.stats.today));
}

// Gọi mỗi khi tuần đang xem đổi (form.js báo lại sau khi vẽ danh sách ca)
export function onWeek(sel) {
  if (!model) return;
  const { stats, sessions } = model, cur = weekNo(stats.today), wk = stats.weeks.find(w => w.week === sel);
  if (!wk) return;
  $('cal-wtitle').textContent = `Tuần ${wk.week}`;
  $('cal-wrange').textContent = `${fmtDayShort(wk.start)}–${fmtDate(wk.end)} · ${wk.status}`;
  $('cal-prev').disabled = sel <= 1;
  $('cal-next').disabled = sel >= cur;

  // Heatmap: số cột vừa khung (mỗi cột ≥ 44 px để dễ chạm); luôn chứa tuần đang chọn
  const el = $('cal-heat'), n = Math.max(4, Math.min(cur, Math.floor((W(el) - 40) / 44)));
  const end = sel >= cur - n + 1 ? cur : sel + n - 1, start = Math.max(1, end - n + 1);
  const cols = [];
  for (let w = start; w <= end; w++) cols.push({ week: w, days: weekDays(stats, w).map(d => ({ ...d,
    tip: [`${WEEKDAY_NAMES[weekday(d.date)]}, ${fmtDate(d.date)}${d.date === stats.today ? ' · hôm nay' : ''}`, `${fmtHM(d.min)} · ${d.count} ca`,
      d.busy ? 'Bận đi làm (không tính là ngày có học)' : '', d.open ? `${d.open} ca đang mở` : ''].filter(Boolean).join('\n') })) });
  calHeat(el, cols, { selected: sel, today: stats.today, level });

  // Chủ đề và nhóm của tuần đang xem (bảng L3 cũ, nay gọn trong 1 mục mở/đóng)
  const to = Math.min(wk.end, stats.today);
  const list = (rows) => rows.length ? `<ol class="rank">` + rows.map((r, i) => `<li data-tip="${esc(`${fmtPct(r.share)} · ${r.count} ca`)}"><span class="n">${i + 1}</span><span>${esc(r.key)}</span><span class="r">${fmtHM(r.min)}</span></li>`).join('') + `</ol>` : '<p class="muted">Tuần này chưa có ca nào có giờ.</p>';
  $('cal-break').innerHTML = `<summary>Chủ đề và nhóm của tuần ${wk.week}${wk.status === WEEK_STATUS.CURRENT ? ' (tạm thời, đến hôm nay)' : ''}</summary>` +
    `<h3>Theo nhóm</h3>${list(breakdown(sessions, wk.start, to, 'category'))}<h3>Theo chủ đề</h3>${list(breakdown(sessions, wk.start, to, 'topic'))}`;
}
