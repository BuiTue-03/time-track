// stats-extra.js — Phép tính MỚI thêm ở L4.5 (Oriana cho phép 26/11/2026, kèm điều kiện ghi lại vào bộ nhớ dự án).
// Hàm thuần, chỉ dùng kết quả có sẵn của core.js (stats, sessions); KHÔNG sửa cách tính cũ.
// Có test ở test/stats-extra.test.mjs.
import { WEEK_STATUS, CONFIG, weekNo, weekStart, weekStatus } from './core.js';
import { weeklyAverage } from './insights.js';
import { UI } from './ui-config.js';

// Phút của 1 ngày (theo stats.days; ngày không có dòng = 0)
export const dayMinutes = (stats, d) => stats.days[d]?.min ?? 0;

// 7 ngày của tuần w (thứ Tư -> thứ Ba): phút, có dòng "Bận đi làm" không, đã tới chưa
export function weekDays(stats, w, cfg = CONFIG) {
  const s = weekStart(w, cfg);
  return Array.from({ length: 7 }, (_, i) => {
    const d = s + i, info = stats.days[d];
    return { date: d, min: info?.min ?? 0, busy: !!info?.busy, open: info?.open ?? 0, count: info?.count ?? 0, hasRows: !!info, future: d > stats.today };
  });
}

// Tấm "Tuần này" ở trang Hôm nay: thứ Ba (ngày cuối tuần) so với tuần liền trước theo từng thứ
export function weekVsPrevByDay(stats, cfg = CONFIG) {
  const w = weekNo(stats.today, cfg);
  if (w < 2) return null;
  const cur = weekDays(stats, w, cfg), prev = weekDays(stats, w - 1, cfg);
  const sum = a => a.reduce((x, d) => x + d.min, 0);
  return { week: w, prevWeek: w - 1, cur, prev, curMin: sum(cur), prevMin: sum(prev) };
}

// [DỰ ĐOÁN] Xu hướng (cách 1, Oriana chọn 26/11/2026): trung bình 4 tuần gần nhất đã qua
// (không tính tuần Đang diễn ra) + dải dao động thấp nhất–cao nhất của 4 tuần đó.
// Dự báo cho các tuần tới = trung bình đó (đường ngang), dải = [min, max].
export function trendAvg4(stats, n = 4) {
  const base = weeklyAverage(stats, n);
  if (!base) return null;
  const mins = stats.weeks.filter(w => base.weeks.includes(w.week)).map(w => w.min);
  return { avgMin: base.avgMin, lo: Math.min(...mins), hi: Math.max(...mins), baseWeeks: base.weeks, includesProvisional: base.includesProvisional };
}

// Phút theo khung giờ trong ngày. Khung theo giờ đồng hồ (giờ ghi trong Sheet):
//   Sáng 05:00–12:00, Chiều 12:00–18:00, Tối 18:00–24:00, Khuya 00:00–05:00.
// Ca vắt qua nhiều khung được CHIA phút cho từng khung (ví dụ 11:30–12:30 = Sáng 30 + Chiều 30;
// 23:30–00:30 = Tối 30 + Khuya 30). Chỉ tính ca có đủ giờ (duration khác null), ngày trong [from, to].
// Tổng 4 khung = tổng phút của các ca đó.
export const TOD_BUCKETS = [
  { key: 'Sáng', label: '05–12 giờ', from: 300, to: 720 },
  { key: 'Chiều', label: '12–18 giờ', from: 720, to: 1080 },
  { key: 'Tối', label: '18–24 giờ', from: 1080, to: 1440 },
  { key: 'Khuya', label: '0–5 giờ', from: 0, to: 300 },
];
const bucketOf = m => TOD_BUCKETS.findIndex(b => m >= b.from && m < b.to);
export function timeOfDay(sessions, from, to) {
  const out = TOD_BUCKETS.map(b => ({ ...b, min: 0 }));
  for (const s of sessions) {
    if (s.duration === null || s.duration <= 0 || typeof s.start !== 'number' || s.date < from || s.date > to) continue;
    let t = Math.round((s.start % 1) * 1440) % 1440, left = s.duration;
    while (left > 0) {
      const i = bucketOf(t), b = TOD_BUCKETS[i];
      const take = Math.min(left, b.to - t);
      out[i].min += take;
      left -= take;
      t = (t + take) % 1440;
    }
  }
  return out;
}

// Ca đang mở để hiện ở trang Hôm nay: ca mở mới nhất (ngày gần nhất, giờ bắt đầu muộn nhất).
// nowMin = phút hiện tại trong ngày (giờ VN). Thời lượng tạm = từ giờ bắt đầu đến bây giờ, chỉ khi ca là của hôm nay.
export function latestOpen(stats, nowMin) {
  const list = [...stats.openSessions].sort((a, b) => b.date - a.date || (b.start % 1) - (a.start % 1));
  const s = list[0];
  if (!s) return null;
  const startMin = Math.round((s.start % 1) * 1440);
  const runningMin = s.date === stats.today && nowMin >= startMin ? nowMin - startMin : null;
  return { session: s, startMin, runningMin, others: list.length - 1 };
}

export const isCurrent = w => w.status === WEEK_STATUS.CURRENT;

// ---------------------------------------------------------------------------------------------
// L5 (Oriana duyệt Phần A 26/11/2026)
// ---------------------------------------------------------------------------------------------
// Ca chưa đóng của NGÀY TRƯỚC (ngày < hôm nay, giờ VN). Chỉ báo từ 06:00 để khỏi báo nhầm lúc học qua nửa đêm.
// nowMin = phút hiện tại trong ngày; null (chế độ giả lập ngày) -> coi như đã qua 06:00.
// action: 'close' = đóng được trong app (ca của hôm qua, tuần Đang diễn ra hoặc Tạm chốt);
//         'sheet' = ca từ 2 ngày trước trở lên hoặc tuần Chốt hẳn -> Oriana sửa tay trong Sheet.
export const STALE_FROM_MIN = 6 * 60;
export function staleOpen(stats, nowMin, cfg = CONFIG) {
  if (nowMin !== null && nowMin !== undefined && nowMin < STALE_FROM_MIN) return [];
  return stats.openSessions
    .filter(s => s.date < stats.today)
    .sort((a, b) => a.date - b.date || (a.start % 1) - (b.start % 1))
    .map(s => ({ session: s, status: weekStatus(weekNo(s.date, cfg), stats.today, cfg), action: closeAction(s, stats.today, cfg) }));
}

// Ca mở này đóng ở đâu (dùng chung cho thanh báo, thẻ "Ca đang mở" và danh sách ca ở tab Lịch):
//   'close' = đóng trong app: ca của hôm nay, hoặc ca của hôm qua khi tuần đó Đang diễn ra / Tạm chốt;
//   'sheet' = ca từ 2 ngày trước trở lên, hoặc tuần Chốt hẳn -> sửa tay trong Sheet (Oriana chọn, Phần A d);
//   null    = không phải ca đang mở.
export function closeAction(s, today, cfg = CONFIG) {
  if (!s || !s.open) return null;
  if (s.date === today) return 'close';
  const status = weekStatus(weekNo(s.date, cfg), today, cfg);
  return s.date === today - 1 && (status === WEEK_STATUS.CURRENT || status === WEEK_STATUS.PROVISIONAL) ? 'close' : 'sheet';
}
// Ô "Giờ kết thúc" khi đóng ca có điền sẵn giờ hiện tại không:
//   ca hôm nay -> có; ca hôm qua mà chưa tới 06:00 (đang học qua đêm) -> có; còn lại để trống để Oriana tự điền giờ thật.
export const closePrefillNow = (s, today, nowMin) =>
  s.date === today || (s.date === today - 1 && nowMin !== null && nowMin !== undefined && nowMin < STALE_FROM_MIN);

// Vòng tuần: phút tuần Đang diễn ra / mục tiêu tuần (1440). Vượt 100% -> vòng đầy (pct = 1), reached = true.
// Số ngày có học hiện dạng chữ "x/6 ngày" (không vẽ vòng phụ, Oriana chọn ở Phần A).
export function weekRing(stats, goal = UI.goalWeekMin, goalDays = UI.goalWeekDays) {
  const w = stats.weeks.find(isCurrent) ?? stats.weeks.at(-1);
  const min = w?.min ?? 0;
  return { week: w?.week ?? null, min, goal, pct: Math.min(1, min / goal), reached: min >= goal, studyDays: w?.studyDays ?? 0, goalDays, daysElapsed: w?.daysElapsed ?? 0 };
}

// Vạch mốc "trung bình 4 tuần gần nhất": TB tổng phút của tối đa 4 tuần đã qua gần nhất (tính cả tuần Tạm chốt,
// kèm cờ để giao diện ghi "tạm chốt"). Ít hơn 4 tuần -> dùng số tuần có, enough = false ("chưa đủ 4 tuần").
export function avg4Marker(stats, n = 4) {
  const base = weeklyAverage(stats, n);
  if (!base) return null;
  return { avgMin: base.avgMin, weeks: base.weeks, n: base.weeks.length, enough: base.weeks.length >= n, includesProvisional: base.includesProvisional };
}
