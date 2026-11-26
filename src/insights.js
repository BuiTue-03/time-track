// insights.js — Xếp hạng, so sánh với chính mình, nhịp độ dự báo. Hàm thuần, dùng kết quả của core.js.
// Không đụng giao diện. Mọi kết quả đều mang theo "mẫu số" (khoảng ngày / số tuần) để giao diện ghi rõ.
import { CONFIG, WEEK_STATUS, weekNo, weekStart, weekday, ymdFromSerial, serialFromYMD, daysInMonth } from './core.js';

// Gom phút + số ca theo một khóa ('topic' | 'category' | 'activity') trong khoảng ngày [from, to].
// Sắp theo phút giảm dần; share = tỷ lệ trên tổng phút của khoảng đó.
export function breakdown(sessions, from, to, key) {
  const map = {};
  for (const s of sessions) {
    if (s.duration === null || s.date < from || s.date > to) continue;
    const k = s[key] ?? '(trống)';
    const o = (map[k] ??= { key: k, min: 0, count: 0 });
    o.min += s.duration; o.count++;
  }
  const total = Object.values(map).reduce((a, o) => a + o.min, 0);
  return Object.values(map)
    .map(o => ({ ...o, share: total ? o.min / total : 0 }))
    .sort((a, b) => b.min - a.min || a.key.localeCompare(b.key, 'vi'));
}

// (1) Xếp hạng tuần theo tổng phút. Tuần Đang diễn ra KHÔNG vào bảng (trả riêng ở `current`).
// Bằng phút thì cùng hạng (xếp hạng kiểu 1, 2, 2, 4).
export function rankWeeks(stats) {
  const done = stats.weeks.filter(w => w.status !== WEEK_STATUS.CURRENT && w.status !== WEEK_STATUS.FUTURE);
  const sorted = [...done].sort((a, b) => b.min - a.min || a.week - b.week);
  const ranked = sorted.map((w, i) => ({ ...w, rank: i && w.min === sorted[i - 1].min ? null : i + 1 }));
  for (let i = 0; i < ranked.length; i++) if (ranked[i].rank === null) ranked[i].rank = ranked[i - 1].rank;
  return { ranked, current: stats.weeks.find(w => w.status === WEEK_STATUS.CURRENT) ?? null };
}

// Trung bình phút/tuần trên các tuần KHÔNG phải Đang diễn ra (dùng cho đường trung bình ở A1).
export function weeklyAverage(stats, lastN = Infinity) {
  const done = stats.weeks.filter(w => w.status !== WEEK_STATUS.CURRENT && w.status !== WEEK_STATUS.FUTURE).slice(-lastN);
  if (!done.length) return null;
  return {
    avgMin: done.reduce((a, w) => a + w.min, 0) / done.length,
    weeks: done.map(w => w.week),
    includesProvisional: done.some(w => w.status === WEEK_STATUS.PROVISIONAL),
  };
}

// (3) Thứ trong tuần: tổng phút, số lần xuất hiện (số ngày lịch có thứ đó), trung bình mỗi lần xuất hiện.
// Khoảng tính: từ start_date đến HẾT HÔM QUA (hôm nay chưa xong nên không tính là 1 lần xuất hiện).
// Thứ tự hiển thị theo tuần của Sheet: thứ Tư -> thứ Ba.
export function rankWeekdays(stats, cfg = CONFIG) {
  const to = stats.today - 1;
  const rows = [3, 4, 5, 6, 0, 1, 2].map(wd => ({ weekday: wd, min: 0, occurrences: 0, studyDays: 0 }));
  const byWd = Object.fromEntries(rows.map(r => [r.weekday, r]));
  for (let d = cfg.startDate; d <= to; d++) {
    const r = byWd[weekday(d)];
    r.occurrences++;
    const day = stats.days[d];
    if (day) { r.min += day.min; if (day.studyDay) r.studyDays++; }
  }
  for (const r of rows) r.avgMin = r.occurrences ? r.min / r.occurrences : null;
  const ranked = [...rows].sort((a, b) => (b.avgMin ?? -1) - (a.avgMin ?? -1));
  ranked.forEach((r, i) => { r.rank = i && r.avgMin === ranked[i - 1].avgMin ? ranked[i - 1].rank : i + 1; });
  return { rows, from: cfg.startDate, to };
}

// Tổng phút trong khoảng [from, to] (theo phút từng ngày của stats.days).
export function minutesBetween(stats, from, to) {
  let m = 0;
  for (let d = from; d <= to; d++) m += stats.days[d]?.min ?? 0;
  return m;
}

const change = (cur, prev) => ({ cur, prev, diff: cur - prev, pct: prev > 0 ? (cur - prev) / prev : null });

// So sánh tuần này với tuần trước.
//  - sameDays: n ngày đầu tuần này (tính cả hôm nay) vs n ngày đầu tuần trước.
//  - fullWeek: tuần này tới hôm nay vs CẢ tuần trước (7 ngày).
export function compareWeeks(stats, cfg = CONFIG) {
  const w = weekNo(stats.today, cfg);
  if (w < 2) return null;
  const s = weekStart(w, cfg), p = weekStart(w - 1, cfg);
  const n = stats.today - s + 1;
  const cur = minutesBetween(stats, s, stats.today);
  return {
    week: w, prevWeek: w - 1, daysElapsed: n,
    sameDays: { ...change(cur, minutesBetween(stats, p, p + n - 1)), from: s, to: stats.today, prevFrom: p, prevTo: p + n - 1 },
    fullWeek: { ...change(cur, minutesBetween(stats, p, p + 6)), prevFrom: p, prevTo: p + 6 },
    prevStatus: stats.weeks.find(x => x.week === w - 1)?.status,
  };
}

// So sánh tháng dương lịch này với tháng trước, cùng số ngày đã qua (ngày 1 -> ngày d).
// Nếu khoảng so sánh có ngày trước start_date -> notEnoughData = true ("chưa đủ tháng"), KHÔNG tính %.
export function compareMonths(stats, cfg = CONFIG) {
  const { y, m, d } = ymdFromSerial(stats.today);
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const from = serialFromYMD(y, m, 1), prevFrom = serialFromYMD(py, pm, 1);
  const prevTo = prevFrom + Math.min(d, daysInMonth(py, pm)) - 1;
  const cur = minutesBetween(stats, from, stats.today), prev = minutesBetween(stats, prevFrom, prevTo);
  const notEnoughData = prevFrom < cfg.startDate || from < cfg.startDate;
  const c = change(cur, prev);
  return { y, m, py, pm, day: d, from, to: stats.today, prevFrom, prevTo, notEnoughData, ...c, pct: notEnoughData ? null : c.pct };
}

// [DỰ ĐOÁN] Nhịp độ dự báo tổng phút cuối tuần Đang diễn ra:
//   dự báo = (phút các ngày đã qua trước hôm nay)
//          + max(phút hôm nay, r)            // hôm nay chưa hết: ít nhất bằng nhịp thường ngày
//          + r × (số ngày còn lại sau hôm nay)
//   r = trung bình phút / NGÀY LỊCH của tối đa 4 tuần gần nhất đã qua (không tính tuần Đang diễn ra).
// Giả định: những ngày còn lại giống trung bình 4 tuần gần nhất; không biết trước ngày bận / ngày nghỉ.
export function forecastWeek(stats, cfg = CONFIG) {
  const w = weekNo(stats.today, cfg);
  const base = weeklyAverage(stats, 4);
  if (!base) return null;
  const s = weekStart(w, cfg);
  const r = base.avgMin / 7;
  const before = minutesBetween(stats, s, stats.today - 1);
  const today = stats.days[stats.today]?.min ?? 0;
  const remaining = s + 6 - stats.today;
  return {
    week: w, ratePerDay: r, baseWeeks: base.weeks, before, today, remainingDays: remaining,
    soFar: before + today, forecastMin: before + Math.max(today, r) + r * remaining,
  };
}
