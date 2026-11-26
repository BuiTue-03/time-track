// ui-charts.js — Biểu đồ SVG tự vẽ cho giao diện L4.5 (không thư viện). Chỉ vẽ: nhận số đã tính sẵn.
// Số trên cột chỉ hiện khi rê chuột / chạm (theo ý Oriana); chi tiết nằm trong data-tip.
// Màu lấy từ biến CSS nên đổi sáng/tối không phải sửa ở đây.
import { fmtH1Short } from './format.js';

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const W = el => Math.max(260, Math.round(el.clientWidth || 320));
let uid = 0;

// Cột dọc. items: [{ v, label, sub?, tip, short?, partial?, color? }]; avg = đường trung bình (phút) hoặc null
export function barChart(el, items, { avg = null, h = 200, color = 'var(--a1)', avgLabel = 'TB' } = {}) {
  const id = `hp${++uid}`;
  const w = W(el), m = { t: 28, r: avg ? 54 : 8, b: items.some(i => i.sub) ? 46 : 30, l: 8 }, iw = w - m.l - m.r, ih = h - m.t - m.b;
  const max = Math.max(...items.map(i => i.v), avg ?? 0) * 1.08 || 1;
  const band = iw / Math.max(1, items.length), bw = Math.min(46, band * 0.62), y = v => m.t + ih - (v / max) * ih;
  let s = `<svg viewBox="0 0 ${w} ${h}" role="img"><defs><pattern id="${id}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="var(--surface)"/><rect width="3" height="7" fill="${color}"/></pattern></defs>`;
  s += `<line class="grid-l" x1="${m.l}" x2="${w - m.r}" y1="${m.t + ih}" y2="${m.t + ih}"/>`;
  items.forEach((it, i) => {
    const cx = m.l + band * i + band / 2, top = y(it.v), bh = Math.max(0, m.t + ih - top), r = Math.min(8, bw / 2, bh);
    const fill = it.partial ? `url(#${id})` : it.color || color;
    s += `<g class="mk" tabindex="0" data-tip="${esc(it.tip)}"><rect class="hit" x="${cx - band / 2}" y="${m.t - 24}" width="${band}" height="${ih + 24}"/>`;
    if (bh > 0) s += `<path class="b grow" style="animation-delay:${i * 60}ms" fill="${fill}" stroke="${it.partial ? color : 'none'}" stroke-width="2" d="M${cx - bw / 2},${m.t + ih}V${top + r}Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top}H${cx + bw / 2 - r}Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r}V${m.t + ih}Z"/>`;
    s += `<text class="v" x="${cx}" y="${top - 8}" text-anchor="middle">${esc(it.short ?? fmtH1Short(it.v))}</text></g>`;
    s += `<text x="${cx}" y="${h - m.b + 22}" text-anchor="middle">${esc(it.label)}</text>`;
    if (it.sub) s += `<text x="${cx}" y="${h - m.b + 42}" text-anchor="middle">${esc(it.sub)}</text>`;
  });
  if (avg) {
    const ya = y(avg);
    s += `<line x1="${m.l}" x2="${w - m.r}" y1="${ya}" y2="${ya}" stroke="var(--text)" stroke-width="2" stroke-dasharray="6 5"/><text x="${w - m.r + 6}" y="${ya + 5}" style="fill:var(--text);font-weight:800">${esc(avgLabel)}</text>`;
  }
  el.innerHTML = s + `</svg>`;
}

// 2 thanh ngang so sánh (tuần này / tuần trước…). rows: [{ lab, v, cls: 'cur'|'prev', tip }]
export function pairRows(rows) {
  const max = Math.max(...rows.map(r => r.v)) || 1;
  return `<div class="pair">` + rows.map(r => `<div class="row" data-tip="${esc(r.tip)}"><span class="lab">${esc(r.lab)}</span><span class="track"><span class="fill ${r.cls} growx" style="width:${(r.v / max) * 100}%"></span></span></div>`).join('') + `</div>`;
}

// Cột đôi theo 7 ngày: tuần này (màu nhấn) cạnh tuần trước (xám xanh)
export function pairBars(el, days, { h = 180 } = {}) {
  const w = W(el), m = { t: 10, b: 30 }, ih = h - m.t - m.b, band = w / days.length, bw = Math.min(18, band * 0.3);
  const max = Math.max(1, ...days.flatMap(d => [d.a, d.b])) * 1.08;
  let s = `<svg viewBox="0 0 ${w} ${h}" role="img"><line class="grid-l" x1="0" x2="${w}" y1="${m.t + ih}" y2="${m.t + ih}"/>`;
  days.forEach((d, i) => {
    const cx = band * i + band / 2, ha = (d.a / max) * ih, hb = (d.b / max) * ih;
    s += `<g class="mk" tabindex="0" data-tip="${esc(d.tip)}"><rect class="hit" x="${cx - band / 2}" y="${m.t}" width="${band}" height="${ih}"/>`;
    if (ha > 0) s += `<rect class="b grow" x="${cx - bw - 1}" y="${m.t + ih - ha}" width="${bw}" height="${ha}" rx="4" fill="var(--a1)"/>`;
    if (hb > 0) s += `<rect class="b grow" x="${cx + 1}" y="${m.t + ih - hb}" width="${bw}" height="${hb}" rx="4" fill="var(--prev)"/>`;
    s += `</g><text x="${cx}" y="${h - 6}" text-anchor="middle">${esc(d.label)}</text>`;
  });
  el.innerHTML = s + `</svg>`;
}

// Heatmap kiểu GitHub ở tab Lịch: cột = tuần, hàng = thứ (thứ Tư -> thứ Ba). Chạm ô = chọn tuần đó.
// cells: [{ week, days: [{ date, min, busy, future, label, tip }] }] đã tính sẵn; level(min) -> 0..5
export function calHeat(el, cols, { selected, today, level, colW = 44 } = {}) {
  const w = W(el), lab = 40, cell = Math.min(52, Math.max(colW, Math.floor((w - lab) / Math.max(1, cols.length)))), H = 26 + cell * 7;
  const rowLabels = ['T4', 'T5', 'T6', 'T7', 'CN', 'T2', 'T3'];
  let s = `<svg viewBox="0 0 ${lab + cell * cols.length} ${H}" style="max-width:${lab + cell * cols.length}px" role="img" aria-label="Lịch học theo ngày"><defs><pattern id="busyp" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--h0)"/><rect width="2.5" height="6" fill="var(--grey-cat)"/></pattern></defs>`;
  cols.forEach((c, i) => {
    const sel = c.week === selected;
    if (sel) s += `<rect x="${lab + i * cell}" y="22" width="${cell}" height="${cell * 7 + 4}" rx="10" fill="var(--surface-2)"/>`;
    s += `<text x="${lab + i * cell + cell / 2}" y="16" text-anchor="middle" style="${sel ? 'fill:var(--text);font-weight:800' : ''}">T${c.week}</text>`;
  });
  rowLabels.forEach((d, r) => { s += `<text x="0" y="${26 + r * cell + cell / 2 + 6}">${d}</text>`; });
  cols.forEach((c, i) => c.days.forEach((d, r) => {
    const x = lab + i * cell, y = 26 + r * cell;
    if (d.future) { s += `<rect x="${x + 4}" y="${y + 4}" width="${cell - 8}" height="${cell - 8}" rx="6" fill="none" stroke="var(--border)" stroke-dasharray="3 3"/>`; return; }
    s += `<g class="mk calcell" tabindex="0" data-week="${c.week}" data-tip="${esc(d.tip)}"><rect class="hit" x="${x}" y="${y}" width="${cell}" height="${cell}"/>` +
      `<rect class="b" x="${x + 4}" y="${y + 4}" width="${cell - 8}" height="${cell - 8}" rx="6" fill="${d.busy ? 'url(#busyp)' : `var(--h${level(d.min)})`}"/>` +
      (d.date === today ? `<rect x="${x + 2}" y="${y + 2}" width="${cell - 4}" height="${cell - 4}" rx="8" fill="none" stroke="var(--text)" stroke-width="2.5"/>` : '') + `</g>`;
  }));
  el.innerHTML = s + `</svg>`;
}
