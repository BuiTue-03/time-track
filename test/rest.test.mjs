// rest.test.mjs — Ngày nghỉ, số dư cộng dồn, gợi ý quy đổi, đọc tab Cài đặt / Tích lũy (L6, Phần A đã duyệt 26/11/2026).
// Không gọi Google. Giờ giả: truyền thẳng "hôm nay" (serial) và phút trong ngày, hoặc một Date cố định cho vnClock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { serialFromYMD as D, BUSY_TOPIC, parseSessions, parseTopics, computeStats, buildModel } from '../src/core.js';
import {
  DEFAULT_SETTINGS, parseSettings, parseAccrual, restSummary, conversionSuggestion, accrualTag, composeAccrualNote,
  canMarkRest, vnClock, fmtVnd,
} from '../src/rest.js';

const H = (h, m = 0) => (h * 60 + m) / 1440;
const topics = parseTopics([['Chủ đề', 'Nhóm'], ['JP - Từ vựng', 'Ngoại ngữ'], [BUSY_TOPIC, 'Không học'], ['Nghỉ ngơi', 'Không học']], 'values');
const parse = rows => parseSessions([['h'], ...rows], 'values', topics).sessions;
const rest = (d, topic = 'Nghỉ ngơi') => [d, null, null, topic, null, null];
const jp = (d, s = H(9), e = H(10)) => [d, s, e, 'JP - Từ vựng', 'Ôn tập', ''];
const S = DEFAULT_SETTINGS;
const nov = d => D(2026, 11, d), dec = d => D(2026, 12, d);
const sum = (rows, today, entries = []) => restSummary(parse(rows), entries, today, S);
const acc = (date, days, note = '') => ({ rowNumber: 2, date, days, note, month: null });

// ---------------------------------------------------------------- Cài đặt
const settingsRows = [
  ['Khóa (key)', 'Tên cài đặt', 'Giá trị', 'Ghi chú'],
  ['goal_min_per_day', 'x', 240, ''], ['goal_days_per_week', 'x', 6, ''], ['rest_quota_per_month', 'x', 4, ''],
  ['rest_accrual_start', 'x', 46327, ''], ['money_per_rest_day', 'x', 100000, ''],
];
test('Cài đặt: đọc đủ 5 khóa theo tên, mục tiêu tuần = ngày × số ngày', () => {
  const r = parseSettings(settingsRows, 'values');
  assert.deepEqual(r.warnings, []);
  assert.equal(r.settings.restAccrualStart, nov(1));
  assert.equal(r.settings.moneyPerRestDay, 100000);
  assert.equal(r.settings.goalWeekMin, 1440);
  assert.equal(r.fromSheet, true);
  assert.equal(r.rowOf.restAccrualStart, 5);
  assert.equal(r.rowOf.moneyPerRestDay, 6);
});
test('Cài đặt: thiếu ô (gviz bỏ ô ngày) -> dùng dự phòng cho ô đó + cảnh báo', () => {
  const rows = settingsRows.map(r => [...r]); rows[4][2] = null;
  const r = parseSettings(rows, 'values');
  assert.equal(r.settings.restAccrualStart, S.restAccrualStart);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /rest_accrual_start/);
});
test('Cài đặt: money_per_rest_day không ở C6 -> cảnh báo (công thức cột C Tích lũy đọc C6)', () => {
  const rows = [settingsRows[0], settingsRows[5], ...settingsRows.slice(1, 5)];
  const r = parseSettings(rows, 'values');
  assert.equal(r.settings.moneyPerRestDay, 100000);
  assert.ok(r.warnings.some(w => /C6/.test(w)));
});
test('Cài đặt: không đọc được gì -> toàn bộ dự phòng, fromSheet = false', () => {
  const r = parseSettings(null, 'values');
  assert.deepEqual(r.settings, S);
  assert.equal(r.fromSheet, false);
});
test('Cài đặt: giá trị sai (âm, chữ) -> dự phòng + cảnh báo', () => {
  const rows = settingsRows.map(r => [...r]); rows[3][2] = -1; rows[1][2] = 'bốn giờ';
  const r = parseSettings(rows, 'values');
  assert.equal(r.settings.restQuotaPerMonth, 4);
  assert.equal(r.settings.goalMinPerDay, 240);
  assert.equal(r.warnings.length, 2);
});

// ---------------------------------------------------------------- Tích lũy
test('Tích lũy: bỏ dòng trống (chỉ có công thức C), đọc nhãn tháng, dòng gõ tay không nhãn -> tháng liền trước cột A', () => {
  const rows = [['Ngày quy đổi', 'Số ngày nghỉ quy đổi', 'Số tiền', 'Ghi chú'],
    [dec(1), 2, 200000, '[T11/2026 · a7c2] tiết kiệm'], [null, null, '', null], [dec(5), 1, 100000, 'gõ tay'], [null, null, null, null]];
  const r = parseAccrual(rows, 'values');
  assert.deepEqual(r.issues, []);
  assert.equal(r.entries.length, 2);
  assert.deepEqual(r.entries[0].month, { y: 2026, m: 11 });
  assert.equal(r.entries[0].tag, 'a7c2');
  assert.equal(r.entries[0].rowNumber, 2);
  assert.deepEqual(r.entries[1].month, { y: 2026, m: 11 });
  assert.equal(r.entries[1].rowNumber, 4);
});
test('Tích lũy: số ngày không phải số nguyên dương -> báo vấn đề, không cộng', () => {
  const r = parseAccrual([['h'], [dec(1), 'hai', null, ''], [dec(1), 0, null, ''], [null, 1, null, '']], 'values');
  assert.equal(r.entries.length, 0);
  assert.equal(r.issues.length, 3);
});
test('nhãn quy đổi: [T11/2026 · mã] + ghi chú', () => {
  assert.equal(accrualTag(2026, 11, 'a7c2'), '[T11/2026 · a7c2]');
  assert.equal(composeAccrualNote('[T11/2026 · a7c2]', ''), '[T11/2026 · a7c2]');
  assert.equal(composeAccrualNote('[T11/2026 · a7c2]', 'mua sách'), '[T11/2026 · a7c2] mua sách');
  assert.equal(fmtVnd(200000), '200.000 VND');
});

// ---------------------------------------------------------------- Ngày nghỉ & số dư
for (const [n, bal] of [[0, 4], [3, 1], [4, 0], [5, -1]]) {
  test(`tháng 11 dùng ${n} ngày nghỉ -> số dư ${bal} (tính tới 30/11)`, () => {
    const rows = Array.from({ length: n }, (_, i) => rest(nov(2 + i)));
    const s = sum(rows, nov(30));
    assert.equal(s.months.length, 1);
    assert.equal(s.months[0].used, n);
    assert.equal(s.balance, bal);
  });
}
test('cộng dồn nhiều tháng: T11 dùng 1, T12 dùng 5, T1 dùng 0 -> 3 + (−1) + 4 = 6', () => {
  const rows = [rest(nov(5)), ...[1, 2, 3, 4, 5].map(d => rest(dec(d))), jp(D(2027, 1, 2))];
  const s = sum(rows, D(2027, 1, 20));
  assert.deepEqual(s.months.map(m => [m.key, m.used]), [['2026-11', 1], ['2026-12', 5], ['2027-01', 0]]);
  assert.equal(s.balance, 6);
});
test('tháng hiện tại được đủ hạn mức ngay từ ngày 1', () => {
  assert.equal(sum([], dec(1)).balance, 8);
});
test('tháng 10/2026: ngày nghỉ không trừ hạn mức, không có hạn mức', () => {
  const s = sum([rest(D(2026, 10, 25)), rest(nov(3))], nov(10));
  assert.deepEqual(s.months.map(m => m.key), ['2026-11']);
  assert.equal(s.balance, 3);
  assert.deepEqual(s.preAccrual, [D(2026, 10, 25)]);
});
test('một ngày có nhiều dòng nghỉ (Nghỉ ngơi + Bận đi làm) chỉ tính 1 ngày; ngày vừa học vừa nghỉ vẫn tính nghỉ', () => {
  const s = sum([rest(nov(3)), rest(nov(3), BUSY_TOPIC), rest(nov(4)), jp(nov(4))], nov(10));
  assert.equal(s.months[0].used, 2);
  assert.deepEqual(s.months[0].dates, [nov(3), nov(4)]);
});
test('ngày bỏ lỡ (không có dòng) KHÔNG tự trừ ngày nghỉ', () => {
  assert.equal(sum([jp(nov(2))], nov(30)).balance, 4);
});
test('quy đổi trừ khỏi số dư (một phần và toàn phần)', () => {
  const rows = [rest(nov(2))];
  assert.equal(sum(rows, dec(3), [acc(dec(1), 1)]).balance, 3 + 4 - 1);
  assert.equal(sum(rows, dec(3), [acc(dec(1), 3)]).balance, 4);
  assert.equal(sum(rows, dec(3), [acc(dec(1), 3)]).converted, 3);
});
test('dữ liệu rỗng', () => {
  const s = sum([], nov(1));
  assert.equal(s.balance, 4);
  assert.equal(s.usedTotal, 0);
  assert.equal(conversionSuggestion(s, nov(1), 8 * 60, S), null);
});

// ---------------------------------------------------------------- Gợi ý quy đổi
test('gợi ý quy đổi: chỉ từ 06:00 ngày 1 tháng mới, cho tháng vừa kết thúc', () => {
  const rows = [rest(nov(2))];
  assert.equal(conversionSuggestion(sum(rows, nov(30)), nov(30), 23 * 60, S), null);     // còn trong tháng 11
  assert.equal(conversionSuggestion(sum(rows, dec(1)), dec(1), 5 * 60 + 59, S), null);    // 05:59 ngày 1
  const g = conversionSuggestion(sum(rows, dec(1)), dec(1), 6 * 60, S);                   // 06:00 ngày 1
  assert.deepEqual([g.monthKey, g.unused, g.days, g.amount], ['2026-11', 3, 3, 300000]);
  assert.ok(conversionSuggestion(sum(rows, dec(20)), dec(20), 1, S));                     // ngày khác trong tháng: vẫn gợi ý
});
test('gợi ý quy đổi: đã quy đổi một phần -> gợi ý phần còn lại; đã đủ -> không gợi ý', () => {
  const rows = [rest(nov(2))];
  const part = [{ ...acc(dec(1), 1), month: { y: 2026, m: 11 } }];
  assert.equal(conversionSuggestion(sum(rows, dec(2), part), dec(2), 9 * 60, S).days, 2);
  const full = [{ ...acc(dec(1), 3), month: { y: 2026, m: 11 } }];
  assert.equal(conversionSuggestion(sum(rows, dec(2), full), dec(2), 9 * 60, S), null);
});
test('gợi ý quy đổi: tháng dùng vượt hạn mức -> không gợi ý', () => {
  const rows = [1, 2, 3, 4, 5].map(d => rest(nov(d)));
  assert.equal(conversionSuggestion(sum(rows, dec(1)), dec(1), 9 * 60, S), null);
});
test('gợi ý quy đổi: không vượt số dư tính tới hết tháng đó (tháng trước âm)', () => {
  // T11 dùng 6 (−2), T12 dùng 1 (chưa dùng 3) -> số dư hết T12 = 1 -> gợi ý 1, không phải 3
  const rows = [1, 2, 3, 4, 5, 6].map(d => rest(nov(d))).concat([rest(dec(2))]);
  const g = conversionSuggestion(sum(rows, D(2027, 1, 1)), D(2027, 1, 1), 9 * 60, S);
  assert.deepEqual([g.monthKey, g.unused, g.balanceEndOfMonth, g.days], ['2026-12', 3, 1, 1]);
});
test('gợi ý quy đổi: hạn mức tháng mới không bị đụng tới', () => {
  const g = conversionSuggestion(sum([], dec(1)), dec(1), 9 * 60, S);
  assert.equal(g.days, 4); // chỉ 4 của tháng 11, không cộng 4 của tháng 12
});
test('gợi ý quy đổi: tháng trước ngày bắt đầu tích lũy (tháng 10) -> không gợi ý', () => {
  assert.equal(conversionSuggestion(sum([], nov(1)), nov(1), 9 * 60, S), null);
});

// ---------------------------------------------------------------- Đánh dấu ngày nghỉ
test('đánh dấu nghỉ: tuần Đang diễn ra = dòng thường; Tạm chốt = [OFFSET]; Chốt hẳn / tương lai / trùng ngày bị chặn', () => {
  const today = nov(26); // tuần 6
  const s = parse([rest(nov(24))]);
  assert.deepEqual(canMarkRest(nov(26), today, s), { ok: true, isOffset: false, errors: [] });
  assert.deepEqual(canMarkRest(nov(20), today, s), { ok: true, isOffset: true, errors: [] });
  assert.equal(canMarkRest(nov(17), today, s).ok, false);
  assert.equal(canMarkRest(nov(27), today, s).ok, false);
  const dup = canMarkRest(nov(24), today, s);
  assert.equal(dup.ok, false);
  assert.match(dup.errors[0], /đã có dòng nghỉ/);
  assert.equal(canMarkRest(D(2026, 10, 20), today, s).ok, false);
});

// ---------------------------------------------------------------- Giờ giả: ranh giới tháng, 06:00
test('vnClock: 30/11 23:59 giờ VN vẫn là tháng 11; 00:00 là ngày 1/12; 05:59 vs 06:00', () => {
  assert.deepEqual(vnClock(new Date('2026-11-30T16:59:00Z')), { today: nov(30), nowMin: 23 * 60 + 59 });
  assert.deepEqual(vnClock(new Date('2026-11-30T17:00:00Z')), { today: dec(1), nowMin: 0 });
  assert.deepEqual(vnClock(new Date('2026-11-30T22:59:00Z')), { today: dec(1), nowMin: 5 * 60 + 59 });
  assert.deepEqual(vnClock(new Date('2026-11-30T23:00:00Z')), { today: dec(1), nowMin: 6 * 60 });
  const rows = [rest(nov(2))];
  const at = iso => { const c = vnClock(new Date(iso)); return conversionSuggestion(sum(rows, c.today), c.today, c.nowMin, S); };
  assert.equal(at('2026-11-30T22:59:00Z'), null);
  assert.equal(at('2026-11-30T23:00:00Z').days, 3);
});

// ---------------------------------------------------------------- Dữ liệu mẫu (đến 23/11)
test('dữ liệu mẫu: tháng 11 đã dùng 4 ngày nghỉ (06, 07, 08, 15/11) -> số dư 0', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/sheet-to-2026-11-23.json', import.meta.url), 'utf8'));
  const m = buildModel({ caRows: fx.caHoc, cdRows: fx.chuDe, source: 'values', today: nov(23) });
  const s = restSummary(m.sessions, [], nov(23), S);
  assert.deepEqual(s.months[0].dates, [nov(6), nov(7), nov(8), nov(15)]);
  assert.equal(s.balance, 0);
  assert.equal(computeStats(m.sessions, nov(23)).studyDays, 29);
});
