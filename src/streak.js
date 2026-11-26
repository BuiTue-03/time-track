// streak.js — Chuỗi ngày học (streak), "sửa chuỗi", nhắc nghỉ, mốc chuỗi (L6). Hàm thuần, chỉ đọc stats của core.js.
// Quyết định Oriana (Phần A L6, 26/11/2026):
//   - Chuỗi tính hoàn toàn từ dữ liệu, KHÔNG lưu trạng thái riêng; bắt đầu từ 21/10/2026.
//   - Mỗi ngày từ 21/10 tới hôm nay được xếp 1 loại:
//       học (study)       : ≥1 ca ĐÃ ĐÓNG và không có dòng nghỉ                     -> chuỗi +1
//       nghỉ (rest)       : có dòng "Bận đi làm…" / "Nghỉ ngơi" (kể cả khi có học)  -> trung tính
//       chờ đóng ca       : chỉ có ca mở, tuần chưa Chốt hẳn                        -> trung tính
//       chưa tới (not_yet): hôm nay chưa có ngày học/nghỉ, hoặc hôm qua khi chưa tới 06:00 -> trung tính
//       bỏ lỡ (missed)    : còn lại (không có dòng nào, hoặc ca mở mà tuần đã Chốt hẳn) -> chuỗi về 0
//   - Sửa chuỗi = thêm ca [OFFSET] (chỉ khi thật sự đã học) hoặc đánh dấu nghỉ cho ngày bỏ lỡ, ở tuần Đang diễn ra / Tạm chốt.
import { CONFIG, WEEK_STATUS, weekNo, weekStatus } from './core.js';

export const DAY = { STUDY: 'study', REST: 'rest', PENDING: 'pending', NOT_YET: 'not_yet', MISSED: 'missed' };
export const GRACE_MIN = 6 * 60;    // hôm qua chưa tính là bỏ lỡ trước 06:00 (giống thanh báo ca chưa đóng của L5)
export const REMIND_AFTER = 7;      // nhắc nghỉ sau 7 ngày học liên tiếp
export const STREAK_MILESTONES = [7, 14, 30, 60, 100];

// nowMin = phút hiện tại trong ngày (giờ VN); null = chế độ giả lập ngày -> coi như đã qua 06:00.
export function classifyDays(stats, nowMin, cfg = CONFIG) {
  const out = [], today = stats.today;
  const beforeGrace = nowMin !== null && nowMin !== undefined && nowMin < GRACE_MIN;
  for (let d = cfg.startDate; d <= today; d++) {
    const info = stats.days[d];
    let kind;
    if (info?.rest) kind = DAY.REST;
    else if (info?.studyDay) kind = DAY.STUDY;
    else if (info?.open > 0 && weekStatus(weekNo(d, cfg), today, cfg) !== WEEK_STATUS.FINAL) kind = DAY.PENDING;
    else if (d === today || (d === today - 1 && beforeGrace)) kind = DAY.NOT_YET;
    else kind = DAY.MISSED;
    out.push({ date: d, kind });
  }
  return out;
}

// Chuỗi hiện tại và dài nhất (đếm ngày học; ngày trung tính bỏ qua; ngày bỏ lỡ làm về 0)
export function streaks(days) {
  let run = 0, runFrom = null, longest = 0, longestFrom = null, longestTo = null;
  for (const { date, kind } of days) {
    if (kind === DAY.STUDY) {
      if (run === 0) runFrom = date;
      run++;
      if (run > longest) { longest = run; longestFrom = runFrom; longestTo = date; }
    } else if (kind === DAY.MISSED) { run = 0; runFrom = null; }
  }
  return { current: run, currentFrom: runFrom, longest, longestFrom, longestTo };
}

// Nhắc nghỉ: số ngày học liên tiếp gần nhất, không có ngày nghỉ hay bỏ lỡ xen giữa
// (ngày "chờ đóng ca" và "chưa tới" bỏ qua). show khi count ≥ REMIND_AFTER.
export function restReminder(days, threshold = REMIND_AFTER) {
  let count = 0;
  for (const { kind } of days) {
    if (kind === DAY.STUDY) count++;
    else if (kind === DAY.REST || kind === DAY.MISSED) count = 0;
  }
  return { show: count >= threshold, count };
}

// Ngày bỏ lỡ còn sửa được trong app (tuần Đang diễn ra / Tạm chốt). offset = true khi phải ghi bù ([OFFSET], tuần Tạm chốt).
export function missedToFix(days, today, cfg = CONFIG) {
  return days.filter(d => d.kind === DAY.MISSED).map(d => ({ date: d.date, status: weekStatus(weekNo(d.date, cfg), today, cfg) }))
    .filter(x => x.status === WEEK_STATUS.CURRENT || x.status === WEEK_STATUS.PROVISIONAL)
    .map(x => ({ date: x.date, offset: x.status === WEEK_STATUS.PROVISIONAL }));
}

// Mốc chuỗi đã đạt = các mốc ≤ chuỗi DÀI NHẤT (để chuỗi đứt rồi đạt lại mốc cũ không ăn mừng lần 2).
// Ăn mừng dùng chung milestones.celebrationPlan (lần đầu trên máy chỉ đánh dấu đã xem).
export const streakMilestonesReached = longest => STREAK_MILESTONES.filter(m => m <= longest);
