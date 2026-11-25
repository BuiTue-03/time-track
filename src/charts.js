// charts.js — Biểu đồ SVG tự vẽ (không thư viện) + ô thông tin khi di chuột (tooltip).
// Mỗi hàm nhận dữ liệu đã tính sẵn (từ core.js / insights.js) và chiều rộng khung, trả về chuỗi SVG.
// Màu lấy từ biến CSS (styles.css) nên đổi giao diện sáng/tối không phải sửa code ở đây.
import { WEEK_STATUS, ACTIVITIES, weekday } from './core.js';
import { fmtHours, fmtHoursShort, fmtMin, fmtPct, fmtRange, fmtDay, fmtDayShort, weekdayName } from './format.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Nội dung tooltip: các dòng chữ, lưu vào thuộc tính data-tip (xuống dòng bằng \n)
const tip = lines => `data-tip="${esc(lines.filter(Boolean).join('\n'))}" tabindex="0"`;

// Thang trục "đẹp": làm tròn giá trị lớn nhất lên bội số của 2, 5, 10, 20… giờ
function niceMax(hours) {
  const steps = [1, 2, 4, 5, 10, 20, 25, 50, 100];
  for (const st of steps) if (hours <= st * 5) return { max: Math.max(st, Math.ceil(hours / st) * st), step: st };
  return { max: Math.ceil(hours / 100) * 100, step: 100 };
}
// Cột bo tròn 4px ở đầu trên, đáy phẳng nằm trên trục
const barPath = (x, y, w, h, r = 4) => {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

// ---------------- A1: cột tổng giờ theo tuần + đường trung bình ----------------
export function weeklyBars(weeks, avg, width) {
  const H = 260, m = { t: 26, r: 58, b: 40, l: 40 };
  const iw = width - m.l - m.r, ih = H - m.t - m.b;
  const maxH = Math.max(1, ...weeks.map(w => w.min / 60), avg ? avg.avgMin / 60 : 0);
  const { max, step } = niceMax(maxH);
  const y = h => m.t + ih - (h / max) * ih;
  const band = iw / Math.max(1, weeks.length), bw = Math.min(56, band * 0.62);
  let s = `<svg class="chart" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" role="img" aria-label="Tổng giờ học theo tuần">`;
  s += `<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="cur-fill"/><line x1="0" y1="0" x2="0" y2="6" class="hatch-line"/></pattern></defs>`;
  for (let v = 0; v <= max; v += step) {
    s += `<line class="grid" x1="${m.l}" x2="${width - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    s += `<text class="axis" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  s += `<text class="axis" x="${m.l - 6}" y="${m.t - 12}" text-anchor="end">giờ</text>`;
  const showValues = band >= 30;
  weeks.forEach((w, i) => {
    const cx = m.l + band * i + band / 2, h = w.min / 60, top = y(h);
    const cur = w.status === WEEK_STATUS.CURRENT;
    const lines = [
      `Tuần ${w.week} (${fmtRange(w.start, w.end)}) · ${w.status}`,
      `${fmtHours(w.min)} (${fmtMin(w.min)})`,
      `${w.count} ca · ${w.studyDays} ngày có học`,
      cur ? `Tạm thời: mới qua ${w.daysElapsed}/7 ngày` : '',
    ];
    // vùng di chuột rộng hơn cột để dễ trỏ
    s += `<g class="mark" ${tip(lines)}><rect class="hit" x="${cx - band / 2}" y="${m.t}" width="${band}" height="${ih}"/>`;
    if (w.min > 0) s += `<path class="${cur ? 'bar-cur' : 'bar'}" d="${barPath(cx - bw / 2, top, bw, m.t + ih - top)}"/>`;
    s += `</g>`;
    if (showValues) s += `<text class="val" x="${cx}" y="${top - 6}" text-anchor="middle">${fmtHoursShort(w.min)}</text>`;
    s += `<text class="axis" x="${cx}" y="${H - m.b + 16}" text-anchor="middle">T${w.week}</text>`;
    const sub = cur ? (band >= 70 ? 'đang diễn ra' : 'đang') : w.status === WEEK_STATUS.PROVISIONAL ? (band >= 50 ? 'tạm chốt' : 'tạm') : fmtDayShort(w.start);
    if (band >= 34) s += `<text class="axis sub" x="${cx}" y="${H - m.b + 30}" text-anchor="middle">${sub}</text>`;
  });
  s += `<line class="axis-line" x1="${m.l}" x2="${width - m.r}" y1="${m.t + ih}" y2="${m.t + ih}"/>`;
  if (avg) {
    const ya = y(avg.avgMin / 60);
    s += `<line class="avg" x1="${m.l}" x2="${width - m.r}" y1="${ya}" y2="${ya}"/>`;
    s += `<text class="avg-label" x="${width - m.r + 4}" y="${ya - 2}">TB</text><text class="avg-label" x="${width - m.r + 4}" y="${ya + 12}">${fmtHoursShort(avg.avgMin)}</text>`;
  }
  return s + `</svg>`;
}

// ---------------- A3: tỷ lệ theo hoạt động (thanh 100% xếp chồng) ----------------
// Màu theo hoạt động CỐ ĐỊNH (thứ tự trong ACTIVITIES), không theo thứ hạng.
export const activityColorVar = a => `var(--series-${ACTIVITIES.indexOf(a) + 1 || 6})`;
export function activityBar(items, width) {
  const H = 36, gap = 2;
  const total = items.reduce((a, x) => a + x.min, 0);
  let s = `<svg class="chart" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" role="img" aria-label="Tỷ lệ theo hoạt động">`;
  if (!total) return s + `<rect class="empty" x="0" y="4" width="${width}" height="28" rx="4"/></svg>`;
  const ordered = [...items].sort((a, b) => (ACTIVITIES.indexOf(a.key) + 99) % 99 - (ACTIVITIES.indexOf(b.key) + 99) % 99);
  const usable = width - gap * (ordered.length - 1);
  let x = 0;
  for (const it of ordered) {
    const w = Math.max(1, (it.min / total) * usable);
    s += `<g class="mark" ${tip([it.key, `${fmtHours(it.min)} (${fmtMin(it.min)})`, `${fmtPct(it.share)} tổng thời gian · ${it.count} ca`])}>`;
    s += `<rect x="${x}" y="4" width="${w}" height="28" rx="4" fill="${activityColorVar(it.key)}"/></g>`;
    x += w + gap;
  }
  return s + `</svg>`;
}

// ---------------- A4: heatmap lịch theo ngày (mỗi hàng 1 tuần, cột thứ Tư -> thứ Ba) ----------------
// 6 mức màu một sắc độ (nhạt -> đậm) theo số phút; ngày "Bận đi làm" tô sọc xám; hôm nay có viền đậm.
export const HEAT_BINS = [
  { max: 0, label: '0' }, { max: 59, label: '< 1 giờ' }, { max: 119, label: '1–2 giờ' },
  { max: 179, label: '2–3 giờ' }, { max: 239, label: '3–4 giờ' }, { max: Infinity, label: '≥ 4 giờ' },
];
const heatClass = min => `h${HEAT_BINS.findIndex(b => min <= b.max)}`;
export function heatmap(weeks, days, today, width) {
  const labelW = 76, head = 22;
  const cell = Math.max(26, Math.min(46, Math.floor((width - labelW) / 7)));
  const W = labelW + cell * 7, H = head + cell * weeks.length;
  let s = `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Lịch học theo ngày">`;
  s += `<defs><pattern id="busy" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="busy-bg"/><line x1="0" y1="0" x2="0" y2="6" class="busy-line"/></pattern></defs>`;
  const heads = [3, 4, 5, 6, 0, 1, 2].map(wd => ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][wd]);
  heads.forEach((h, i) => { s += `<text class="axis" x="${labelW + cell * i + cell / 2}" y="14" text-anchor="middle">${h}</text>`; });
  weeks.forEach((w, r) => {
    const y = head + cell * r;
    s += `<text class="axis" x="0" y="${y + cell / 2 + 4}">T${w.week} · ${fmtDayShort(w.start)}</text>`;
    for (let i = 0; i < 7; i++) {
      const d = w.start + i, x = labelW + cell * i, info = days[d];
      const future = d > today, isToday = d === today;
      const min = info?.min ?? 0;
      const cls = future ? 'future' : info?.busy ? 'busy' : heatClass(min);
      const lines = [
        `${weekdayName(d)}, ${fmtDay(d)}${isToday ? ' · hôm nay' : ''}`,
        future ? 'Chưa tới' : `${fmtHours(min)} (${fmtMin(min)}) · ${info?.count ?? 0} ca`,
        info?.busy ? 'Bận đi làm (không tính là ngày có học)' : info ? 'Ngày có học' : future ? '' : 'Không có dòng nào',
        info?.open ? `${info.open} ca đang mở (chưa có giờ kết thúc)` : '',
      ];
      s += `<g class="mark" ${tip(lines)}><rect class="cell ${cls}" x="${x + 2}" y="${y + 2}" width="${cell - 4}" height="${cell - 4}" rx="4"/>`;
      if (info?.busy) s += `<text class="busy-mark" x="${x + cell / 2}" y="${y + cell / 2 + 4}" text-anchor="middle">B</text>`;
      if (isToday) s += `<rect class="today" x="${x + 1}" y="${y + 1}" width="${cell - 2}" height="${cell - 2}" rx="5"/>`;
      s += `</g>`;
    }
  });
  return s + `</svg>`;
}

// ---------------- Tooltip: 1 ô dùng chung, hiện khi di chuột hoặc khi Tab tới mục ----------------
export function installTooltip(root) {
  const box = document.createElement('div');
  box.className = 'tooltip';
  box.setAttribute('role', 'tooltip');
  box.hidden = true;
  document.body.appendChild(box);
  const show = (el, x, y) => {
    box.textContent = el.dataset.tip;
    box.hidden = false;
    const bw = box.offsetWidth, bh = box.offsetHeight;
    const left = Math.min(window.innerWidth - bw - 8, Math.max(8, x + 12));
    const top = y - bh - 12 < 8 ? y + 16 : y - bh - 12;
    box.style.left = `${left}px`; box.style.top = `${top}px`;
  };
  const find = e => e.target.closest?.('[data-tip]');
  root.addEventListener('pointermove', e => { const el = find(e); el ? show(el, e.clientX, e.clientY) : (box.hidden = true); });
  root.addEventListener('pointerleave', () => { box.hidden = true; });
  root.addEventListener('focusin', e => { const el = find(e); if (el) { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); } });
  root.addEventListener('focusout', () => { box.hidden = true; });
  window.addEventListener('scroll', () => { box.hidden = true; }, { passive: true });
}
export { esc, weekday };
