// format.js — Định dạng hiển thị kiểu Việt Nam: ngày dd/mm/yyyy, giờ 24h, số thập phân dấu phẩy.
import { fmtDate, ymdFromSerial, WEEKDAY_NAMES, weekday, TIME_ZONE } from './core.js';

const nf0 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtMin = m => `${nf0.format(Math.round(m))} phút`;                 // 6.675 phút
export const fmtHours = m => `${nf2.format(m / 60)} giờ`;                      // 111,25 giờ
export const fmtHoursShort = m => nf1.format(m / 60);                          // 22,3 (nhãn trục)
export const fmtPct = p => (p === null || p === undefined ? '—' : `${nf1.format(p * 100)}%`);
export const fmtSignedPct = p => (p === null || p === undefined ? '' : `${p > 0 ? '+' : p < 0 ? '−' : '±'}${nf1.format(Math.abs(p) * 100)}%`);
export const fmtSignedMin = d => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${nf0.format(Math.abs(Math.round(d)))} phút`;
export const fmtDay = s => fmtDate(s);
export const fmtDayShort = s => { const { d, m } = ymdFromSerial(s); return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`; };
export const fmtRange = (a, b) => `${fmtDayShort(a)}–${fmtDate(b)}`;
export const weekdayName = s => WEEKDAY_NAMES[weekday(s)];
// Giờ trong ngày từ phần thập phân serial -> "hh:mm"
export const fmtTime = t => { const m = Math.round((t % 1) * 1440); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
// Giờ hiện tại ở Việt Nam -> "hh:mm" (24h)
export const clockNow = (now = new Date()) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
export const monthLabel = (y, m) => `${String(m).padStart(2, '0')}/${y}`;

// L4.5: cách ghi thân thiện ở giao diện mới
const nf1x = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const fmtH1 = m => `${nf1x.format(m / 60)} giờ`;                         // 15,9 giờ
export const fmtH1Short = m => nf1x.format(m / 60);                             // 15,9 (số trên cột)
export const fmtHM = m => {                                                     // 2 giờ 15 phút · 45 phút
  const t = Math.round(m), h = Math.floor(t / 60), r = t % 60;
  return h ? `${h} giờ${r ? ` ${r} phút` : ''}` : `${r} phút`;
};
// So sánh không phán xét: "nhiều hơn 1 giờ 5 phút" / "ít hơn 20 phút" / "bằng nhau" (không màu đỏ/xanh)
export const fmtDiff = d => (Math.round(d) === 0 ? 'bằng nhau' : `${d > 0 ? 'nhiều hơn' : 'ít hơn'} ${fmtHM(Math.abs(d))}`);
