// insights.test.mjs — Test xếp hạng / so sánh / dự báo bằng fixture. Chạy: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildModel, serialFromYMD as D, WEEK_STATUS, fmtDate } from '../src/core.js';
import { rankWeeks, weeklyAverage, breakdown, rankWeekdays, compareWeeks, compareMonths, forecastWeek, minutesBetween } from '../src/insights.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/sheet-to-2026-11-23.json', import.meta.url), 'utf8'));
const at = today => buildModel({ caRows: fx.caHoc, cdRows: fx.chuDe, source: 'values', today });
const m23 = at(D(2026, 11, 23)), m25 = at(D(2026, 11, 25));

test('xếp hạng tuần: bỏ tuần Đang diễn ra, gắn Tạm chốt', () => {
  const r = rankWeeks(m25.stats);
  assert.deepEqual(r.ranked.map(w => [w.rank, w.week, w.min]), [[1, 2, 1715], [2, 1, 1530], [3, 4, 1273], [4, 3, 1200], [5, 5, 957]]);
  assert.equal(r.ranked.find(w => w.week === 5).status, WEEK_STATUS.PROVISIONAL);
  assert.equal(r.current.week, 6);
  assert.equal(rankWeeks(m23.stats).ranked.length, 4); // hôm nay 23/11 thì tuần 5 đang diễn ra
});
test('trung bình tuần (A1) chỉ trên các tuần đã qua', () => {
  const a = weeklyAverage(m25.stats);
  assert.deepEqual(a.weeks, [1, 2, 3, 4, 5]);
  assert.equal(a.avgMin, 6675 / 5);
  assert.equal(a.includesProvisional, true);
  assert.deepEqual(weeklyAverage(m25.stats, 4).weeks, [2, 3, 4, 5]);
});
test('chủ đề / nhóm trong 1 tuần: tổng khớp tuần', () => {
  for (const w of m25.stats.weeks) {
    for (const key of ['topic', 'category', 'activity']) {
      const b = breakdown(m25.sessions, w.start, w.end, key);
      assert.equal(b.reduce((s, x) => s + x.min, 0), w.min);
      assert.equal(b.reduce((s, x) => s + x.count, 0), w.count);
    }
  }
  const all = breakdown(m25.sessions, D(2026, 10, 21), D(2026, 11, 23), 'activity');
  assert.deepEqual(all.map(x => [x.key, x.min]), [['Thực hành', 2693], ['Lý thuyết', 2434], ['Ôn tập', 1284], ['Kiểm tra nhớ', 264]]);
});
test('thứ trong tuần: số lần xuất hiện tính đến hết hôm qua, tổng khớp', () => {
  const r = rankWeekdays(m25.stats); // 21/10 -> 24/11 = 35 ngày = 5 lần mỗi thứ
  assert.equal(fmtDate(r.to), '24/11/2026');
  assert.deepEqual(r.rows.map(x => x.occurrences), [5, 5, 5, 5, 5, 5, 5]);
  assert.equal(r.rows.reduce((s, x) => s + x.min, 0), 6675);
  assert.equal(r.rows[0].weekday, 3); // bắt đầu từ thứ Tư
  for (const x of r.rows) assert.equal(x.avgMin, x.min / 5);
});
test('so sánh tuần: cùng số ngày đã qua và cả tuần trước', () => {
  const c = compareWeeks(m25.stats); // tuần 6 mới qua 1 ngày, chưa có phút trong fixture
  assert.deepEqual([c.week, c.daysElapsed, c.sameDays.cur, c.fullWeek.prev], [6, 1, 0, 957]);
  assert.equal(c.sameDays.prev, minutesBetween(m25.stats, D(2026, 11, 18), D(2026, 11, 18)));
  const c23 = compareWeeks(m23.stats); // thứ Hai 23/11: 6 ngày của tuần 5 vs 6 ngày đầu tuần 4
  assert.deepEqual([c23.daysElapsed, c23.sameDays.cur, fmtDate(c23.sameDays.prevTo)], [6, 957, '16/11/2026']);
  assert.equal(c23.fullWeek.prev, 1273);
  assert.equal(c23.fullWeek.pct, (957 - 1273) / 1273);
});
test('so sánh tháng: 11/2026 vs 10/2026 cùng 25 ngày -> chưa đủ tháng, không có %', () => {
  const c = compareMonths(m25.stats);
  assert.deepEqual([c.m, c.pm, c.day, c.notEnoughData, c.pct], [11, 10, 25, true, null]);
  assert.equal(c.prev, minutesBetween(m25.stats, D(2026, 10, 1), D(2026, 10, 25)));
});
test('so sánh tháng khi đủ dữ liệu: 12/2026 vs 11/2026 có %', () => {
  const c = compareMonths(at(D(2026, 12, 5)).stats);
  assert.equal(c.notEnoughData, false);
  assert.equal(fmtDate(c.prevTo), '05/11/2026');
});
test('nhịp độ dự báo: công thức', () => {
  const f = forecastWeek(m23.stats); // hôm nay 23/11 (ngày 6 của tuần 5)
  assert.deepEqual(f.baseWeeks, [1, 2, 3, 4]);
  const r = (1530 + 1715 + 1200 + 1273) / 4 / 7;
  assert.equal(f.ratePerDay, r);
  assert.equal(f.remainingDays, 1);
  assert.equal(f.soFar, 957);
  assert.equal(f.forecastMin, f.before + Math.max(f.today, r) + r);
});
