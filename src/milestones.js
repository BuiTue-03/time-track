// milestones.js — Huy hiệu mốc giờ tích lũy (L5, Hướng dẫn mục 6 · C3). Hàm thuần, không đụng giao diện.
// Mốc Oriana duyệt 26/11/2026: 10/25/50/100/150/200/300/500/750/1000 giờ.
// Tổng = phút của các ca ĐÃ ĐÓNG kể từ 21/10/2026 (tab "Dữ liệu cũ" không tính, ca mở không tính).
// Ngày đạt mốc tính lại từ dữ liệu mỗi lần tải, KHÔNG lưu riêng: sửa/xóa ca thì ngày đạt mốc đổi theo.
import { CONFIG } from './core.js';

export const MILESTONES_H = [10, 25, 50, 100, 150, 200, 300, 500, 750, 1000];

// Cộng dồn phút theo thứ tự thời gian (ngày, giờ bắt đầu, số dòng). Ca qua đêm tính vào ngày bắt đầu (như core.js).
// Mốc h đạt vào ngày của ca làm tổng chạm ≥ h × 60 phút.
export function milestoneProgress(sessions, cfg = CONFIG, milestones = MILESTONES_H) {
  const done = sessions
    .filter(s => s.duration !== null && s.duration > 0 && typeof s.date === 'number' && s.date >= cfg.startDate)
    .sort((a, b) => a.date - b.date || (a.start % 1) - (b.start % 1) || (a.rowNumber ?? 0) - (b.rowNumber ?? 0));
  const list = milestones.map(h => ({ hours: h, min: h * 60, reached: false, date: null }));
  let total = 0, i = 0;
  for (const s of done) {
    total += s.duration;
    while (i < list.length && total >= list[i].min) { list[i].reached = true; list[i].date = s.date; i++; }
  }
  const next = list.find(x => !x.reached) ?? null;
  return { totalMin: total, list, next: next && { hours: next.hours, leftMin: next.min - total } };
}

// Kế hoạch ăn mừng. reachedHours = các mốc đang đạt; seen = các mốc thiết bị này đã "xem"
// (đọc từ localStorage; null = thiết bị chưa từng lưu -> lần chạy đầu).
//  - Lần chạy đầu: KHÔNG ăn mừng hồi tố, chỉ đánh dấu đã xem.
//  - Sau đó: mốc mới (chưa từng xem) -> ăn mừng 1 lần; đạt nhiều mốc cùng lúc -> 1 lần, với mốc lớn nhất.
//  - "seen" chỉ thêm, không bớt: xóa ca làm mất mốc rồi đạt lại thì không ăn mừng lần 2.
export function celebrationPlan(reachedHours, seen) {
  if (seen === null || seen === undefined) return { celebrate: [], seen: [...reachedHours].sort((a, b) => a - b) };
  const fresh = reachedHours.filter(h => !seen.includes(h));
  const all = [...new Set([...seen, ...reachedHours])].sort((a, b) => a - b);
  return { celebrate: fresh.length ? [Math.max(...fresh)] : [], seen: all };
}
