// streak.test.mjs — Chuỗi ngày học (streak), sửa chuỗi, nhắc nghỉ, mốc chuỗi (L6, Phần A đã duyệt 26/11/2026).
// Định nghĩa: ngày nghỉ TRUNG TÍNH (không tăng, không đứt); ngày chỉ có ca mở = "chờ đóng ca" (trung tính tới khi tuần Chốt hẳn);
// hôm nay chưa có gì, hoặc hôm qua trước 06:00 = "chưa tới" (trung tính); ngày không có gì = bỏ lỡ (đứt chuỗi).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { serialFromYMD as D, BUSY_TOPIC, parseSessions, parseTopics, computeStats, buildModel } from '../src/core.js';
import {
  DAY, classifyDays, streaks, restReminder, missedToFix, STREAK_MILESTONES, streakMilestonesReached, REMIND_AFTER,
} from '../src/streak.js';
import { celebrationPlan } from '../src/milestones.js';

const H = (h, m = 0) => (h * 60 + m) / 1440;
const topics = parseTopics([['Chủ đề', 'Nhóm'], ['JP - Từ vựng', 'Ngoại ngữ'], [BUSY_TOPIC, 'Không học'], ['Nghỉ ngơi', 'Không học']], 'values');
const parse = rows => parseSessions([['h'], ...rows], 'values', topics).sessions;
const jp = (d, s = H(9), e = H(10), note = '') => [d, s, e, 'JP - Từ vựng', 'Ôn tập', note];
const rest = d => [d, null, null, 'Nghỉ ngơi', null, null];
const nov = d => D(2026, 11, d);
const START = D(2026, 10, 21);
const run = (rows, today, nowMin = null) => {
  const st = computeStats(parse(rows), today);
  const days = classifyDays(st, nowMin);
  return { st, days, ...streaks(days), kind: d => days.find(x => x.date === d)?.kind };
};
const studyRange = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => jp(from + i));

test('học liên tiếp 21/10–30/10 (10 ngày): chuỗi 10, dài nhất 10', () => {
  const r = run(studyRange(START, D(2026, 10, 30)), D(2026, 10, 30));
  assert.equal(r.current, 10);
  assert.equal(r.longest, 10);
  assert.equal(r.days.length, 10);
});
test('hôm nay chưa học: trung tính "chưa tới", chuỗi vẫn giữ', () => {
  const r = run(studyRange(nov(20), nov(25)), nov(26), 10 * 60);
  assert.equal(r.kind(nov(26)), DAY.NOT_YET);
  assert.equal(r.current, 6);
});
test('hôm qua trống: trước 06:00 = chưa tới (giữ chuỗi), từ 06:00 = bỏ lỡ (chuỗi về 0)', () => {
  const rows = studyRange(nov(20), nov(24));
  const a = run(rows, nov(26), 5 * 60 + 59);
  assert.equal(a.kind(nov(25)), DAY.NOT_YET);
  assert.equal(a.current, 5);
  const b = run(rows, nov(26), 6 * 60);
  assert.equal(b.kind(nov(25)), DAY.MISSED);
  assert.equal(b.current, 0);
  assert.equal(b.longest >= 5, true);
});
test('ngày nghỉ giữa chuỗi: trung tính (không tăng, không đứt)', () => {
  const rows = [...studyRange(nov(20), nov(22)), rest(nov(23)), ...studyRange(nov(24), nov(25))];
  const r = run(rows, nov(25));
  assert.equal(r.kind(nov(23)), DAY.REST);
  assert.equal(r.current, 5);
});
test('ngày vừa học vừa đánh dấu nghỉ = ngày nghỉ (trung tính), giờ vẫn cộng', () => {
  const r = run([jp(nov(24)), jp(nov(25)), rest(nov(25))], nov(25));
  assert.equal(r.kind(nov(25)), DAY.REST);
  assert.equal(r.current, 1);
  assert.equal(r.st.totalMin, 120);
});
test('ngày bỏ lỡ làm đứt chuỗi; chuỗi dài nhất giữ đoạn trước', () => {
  const rows = [...studyRange(nov(10), nov(16)), ...studyRange(nov(18), nov(20))];
  const r = run(rows, nov(20));
  assert.equal(r.kind(nov(17)), DAY.MISSED);
  assert.equal(r.current, 3);
  assert.equal(r.longest, 7);
  assert.deepEqual([r.longestFrom, r.longestTo], [nov(10), nov(16)]);
});
test('sửa chuỗi bằng ca [OFFSET] cho ngày bỏ lỡ -> chuỗi nối lại', () => {
  const rows = [...studyRange(nov(10), nov(16)), ...studyRange(nov(18), nov(20))];
  const r = run([...rows, jp(nov(17), H(20), H(21), '[OFFSET] quên ghi')], nov(20));
  assert.equal(r.kind(nov(17)), DAY.STUDY);
  assert.equal(r.current, 11);
});
test('sửa chuỗi bằng đánh dấu nghỉ cho ngày bỏ lỡ -> chuỗi nối lại (ngày nghỉ không cộng)', () => {
  const rows = [...studyRange(nov(10), nov(16)), ...studyRange(nov(18), nov(20))];
  const r = run([...rows, rest(nov(17))], nov(20));
  assert.equal(r.current, 10);
});
test('ngày chỉ có ca mở: "chờ đóng ca" trung tính; khi tuần đó Chốt hẳn -> bỏ lỡ', () => {
  const rows = [jp(nov(24)), jp(nov(25), H(9), null), jp(nov(26))];
  const a = run(rows, nov(26), 10 * 60); // tuần 6 Đang diễn ra
  assert.equal(a.kind(nov(25)), DAY.PENDING);
  assert.equal(a.current, 2);
  const b = run(rows, D(2026, 12, 9), 10 * 60); // 09/12: tuần 8 bắt đầu -> tuần 6 Chốt hẳn
  assert.equal(b.kind(nov(25)), DAY.MISSED);
});
test('ca qua đêm 23:30–00:30 tính vào ngày bắt đầu', () => {
  const r = run([jp(nov(24), H(23, 30), H(0, 30))], nov(25), 7 * 60);
  assert.equal(r.kind(nov(24)), DAY.STUDY);
  assert.equal(r.st.days[nov(24)].min, 60);
  assert.equal(r.kind(nov(25)), DAY.NOT_YET);
});
test('dữ liệu rỗng: không lỗi, chuỗi 0', () => {
  const r = run([], START, 8 * 60);
  assert.deepEqual([r.current, r.longest], [0, 0]);
  assert.equal(r.days.length, 1);
  assert.equal(restReminder(r.days).show, false);
});

// ---------------------------------------------------------------- Nhắc nghỉ
test('nhắc nghỉ: 7 ngày học liền -> hiện; 6 ngày -> không; có ngày nghỉ hoặc bỏ lỡ xen giữa -> đếm lại', () => {
  assert.equal(REMIND_AFTER, 7);
  assert.deepEqual(restReminder(run(studyRange(nov(10), nov(16)), nov(16)).days), { show: true, count: 7 });
  assert.equal(restReminder(run(studyRange(nov(10), nov(15)), nov(15)).days).show, false);
  const withRest = [...studyRange(nov(10), nov(13)), rest(nov(14)), ...studyRange(nov(15), nov(17))];
  assert.deepEqual(restReminder(run(withRest, nov(17)).days), { show: false, count: 3 });
  assert.equal(restReminder(run(studyRange(nov(10), nov(16)), nov(18), 9 * 60).days).show, false); // 17/11 bỏ lỡ
});
test('nhắc nghỉ: hôm nay chưa học (chưa tới) vẫn tính chuỗi 7 ngày kết thúc hôm qua', () => {
  assert.equal(restReminder(run(studyRange(nov(10), nov(16)), nov(17), 9 * 60).days).show, true);
});

// ---------------------------------------------------------------- Ngày bỏ lỡ cần sửa
test('ngày bỏ lỡ còn sửa được: chỉ tuần Đang diễn ra và Tạm chốt; kèm cách sửa', () => {
  const rows = [jp(nov(10)), jp(nov(16)), jp(nov(20))];
  const r = run(rows, nov(26), 9 * 60);
  const list = missedToFix(r.days, nov(26));
  assert.deepEqual(list.map(x => x.date), [nov(18), nov(19), nov(21), nov(22), nov(23), nov(24), nov(25)]);
  assert.deepEqual(list.find(x => x.date === nov(25)), { date: nov(25), offset: false });
  assert.deepEqual(list.find(x => x.date === nov(18)), { date: nov(18), offset: true });
});

// ---------------------------------------------------------------- Mốc chuỗi
test('mốc chuỗi 7/14/30/60/100 tính theo chuỗi DÀI NHẤT (đứt rồi đạt lại không ăn mừng lần 2)', () => {
  assert.deepEqual(STREAK_MILESTONES, [7, 14, 30, 60, 100]);
  assert.deepEqual(streakMilestonesReached(15), [7, 14]);
  assert.deepEqual(streakMilestonesReached(6), []);
  assert.deepEqual(celebrationPlan(streakMilestonesReached(15), null).celebrate, []); // lần đầu: chỉ đánh dấu đã xem
  assert.deepEqual(celebrationPlan(streakMilestonesReached(30), [7, 14]).celebrate, [30]);
});

// ---------------------------------------------------------------- Dữ liệu mẫu (đến 23/11)
test('dữ liệu mẫu đến 23/11: chuỗi 19 (01–23/11, đứt ở 31/10), dài nhất 19, nhắc nghỉ (16–23/11 = 8 ngày)', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/sheet-to-2026-11-23.json', import.meta.url), 'utf8'));
  const m = buildModel({ caRows: fx.caHoc, cdRows: fx.chuDe, source: 'values', today: nov(23) });
  const days = classifyDays(m.stats, null);
  const s = streaks(days);
  assert.equal(days.find(d => d.date === D(2026, 10, 31)).kind, DAY.MISSED);
  assert.deepEqual([s.current, s.longest, s.currentFrom], [19, 19, nov(1)]);
  assert.deepEqual(restReminder(days), { show: true, count: 8 });
  assert.equal(days.filter(d => d.kind === DAY.REST).length, 4);
});
