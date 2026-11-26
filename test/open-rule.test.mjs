// open-rule.test.mjs — Quy tắc ca mở (L5, Oriana chốt 26/11/2026):
// "Ngày chỉ có ca mở không tính là có học, chỉ khi ca đó được đóng lại. Nếu sang hôm sau mà ca đó chưa được đóng,
//  thì sẽ có thông báo là phải đóng ca. Lúc đóng rồi mới tính giờ cho ca đó."
// Phần A: báo từ 06:00 (giờ VN); đóng ca ở tuần Tạm chốt chỉ điền giờ kết thúc; Chốt hẳn chặn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { serialFromYMD as D, WEEK_STATUS as W, BUSY_TOPIC, parseSessions, parseTopics, computeStats } from '../src/core.js';
import { staleOpen, latestOpen, STALE_FROM_MIN } from '../src/stats-extra.js';
import { validateRow, checkEdit, EXPECTED_HEADERS, MSG_FINAL, splitNote, isOffsetNote } from '../src/rules.js';

const H = (h, m = 0) => (h * 60 + m) / 1440;
const TODAY = D(2026, 11, 26);    // thứ Năm, tuần 6 (Đang diễn ra)
const YDAY = D(2026, 11, 25);     // thứ Tư, tuần 6
const TUE5 = D(2026, 11, 24);     // thứ Ba, tuần 5 (Tạm chốt)
const WED5 = D(2026, 11, 18);     // thứ Tư, tuần 5 (Tạm chốt)
const TUE4 = D(2026, 11, 17);     // thứ Ba, tuần 4 (Chốt hẳn)
const topics = parseTopics([['Chủ đề', 'Nhóm'], ['JP - Từ vựng', 'Ngoại ngữ'], ['BA - Thực hành', 'Chuyên môn BA'], [BUSY_TOPIC, 'Không học']], 'values');
// Dòng Sheet: [ngày, bắt đầu, kết thúc, chủ đề, hoạt động, ghi chú]; số dòng = 2, 3, ...
const parse = rows => parseSessions([['h'], ...rows], 'values', topics).sessions;
const stats = (rows, today = TODAY) => computeStats(parse(rows), today);
const jp = (date, s, e, act = 'Lý thuyết') => [date, s, e, 'JP - Từ vựng', act];
const wk = (st, w) => st.weeks.find(x => x.week === w);
const ctx = (original, today = TODAY) => ({ mode: 'edit', original, today, nowFrac: H(23, 59), topics, headers: EXPECTED_HEADERS, sessions: [] });
const asInput = (o, extra = {}) => ({ date: o.date, start: o.start, end: o.end, topic: o.topic, activity: o.activity, noteText: splitNote(o.note).text, isOffset: isOffsetNote(o.note), ...extra });

// 1. Ca mở hôm nay
test('ca mở hôm nay: 0 phút, ngày chưa là ngày có học, thẻ ca mở có phút chạy, KHÔNG bị báo "chưa đóng"', () => {
  const st = stats([jp(TODAY, H(8), null)]);
  assert.equal(st.totalMin, 0);
  assert.equal(st.days[TODAY].studyDay, false);
  assert.equal(st.studyDays, 0);
  assert.equal(latestOpen(st, 9 * 60).runningMin, 60);
  assert.deepEqual(staleOpen(st, 23 * 60), []);
});

// 2. Ca mở hôm trước
test('ca mở hôm trước: chỉ báo từ 06:00, báo kèm cách xử lý "đóng trong app"', () => {
  const st = stats([jp(YDAY, H(20), null)]);
  assert.equal(STALE_FROM_MIN, 6 * 60);
  assert.deepEqual(staleOpen(st, 5 * 60 + 59), []);          // 05:59: chưa báo
  const s = staleOpen(st, 6 * 60);                            // 06:00: báo
  assert.equal(s.length, 1);
  assert.equal(s[0].session.date, YDAY);
  assert.equal(s[0].status, W.CURRENT);
  assert.equal(s[0].action, 'close');
  assert.equal(latestOpen(st, 9 * 60).runningMin, null);    // không đoán phút cho ca hôm trước
  assert.equal(st.days[YDAY].studyDay, false);
});
test('ca mở từ 2 ngày trước trở lên: báo, nhưng hướng dẫn sửa trong Sheet', () => {
  const st = stats([jp(TODAY - 2, H(20), null)]);
  assert.equal(staleOpen(st, 7 * 60)[0].action, 'sheet');
});

// 3. Ca mở ở tuần Tạm chốt
test('ca mở ở tuần Tạm chốt: đóng được (chỉ điền giờ kết thúc), đổi trường khác cùng lúc bị chặn', () => {
  const [o] = parse([jp(TUE5, H(21), null)]);
  const st = computeStats([o], TODAY - 1); // hôm nay = thứ Tư 25/11
  const s = staleOpen(st, 7 * 60);
  assert.equal(s[0].status, W.PROVISIONAL);
  assert.equal(s[0].action, 'close');
  assert.deepEqual(validateRow(asInput(o, { end: H(23) }), ctx(o, YDAY)).errors, []);
  assert.ok(validateRow(asInput(o, { end: H(23), activity: 'Ôn tập' }), ctx(o, YDAY)).errors.length);
  assert.ok(validateRow(asInput(o, { end: H(23), start: H(20) }), ctx(o, YDAY)).errors.length);
  assert.ok(validateRow(asInput(o, { end: H(23), noteText: 'x' }), ctx(o, YDAY)).errors.length);
  // Ca đã đóng ở Tạm chốt vẫn KHÔNG đổi giờ được (luật L4 giữ nguyên)
  const [c] = parse([jp(TUE5, H(21), H(22))]);
  assert.ok(checkEdit(asInput(c, { end: H(23) }), c, YDAY).length);
});
test('ca mở ghi bù [OFFSET] ở Tạm chốt: vẫn sửa mọi trường như L4', () => {
  const [o] = parse([[WED5, H(9), null, 'JP - Từ vựng', 'Lý thuyết', '[OFFSET] quên']]);
  assert.deepEqual(validateRow(asInput(o, { end: H(10), activity: 'Ôn tập' }), ctx(o, YDAY)).errors, []);
});

// 4. Ca mở ở tuần Chốt hẳn
test('ca mở ở tuần Chốt hẳn: báo, hướng dẫn sửa Sheet, app chặn đóng bằng đúng câu đã chốt', () => {
  const [o] = parse([jp(TUE4, H(21), null)]);
  const st = computeStats([o], TODAY);
  const s = staleOpen(st, 7 * 60);
  assert.equal(s[0].status, W.FINAL);
  assert.equal(s[0].action, 'sheet');
  assert.deepEqual(checkEdit(asInput(o, { end: H(23) }), o, TODAY), [MSG_FINAL]);
});

// 5. Ca mở vắt qua tuần (thứ Ba 23:00 -> thứ Tư 00:30)
test('ca mở vắt qua tuần: phút tính vào tuần của ngày bắt đầu sau khi đóng; tuần mới không có phút', () => {
  const before = stats([jp(TUE5, H(23), null)], YDAY);
  assert.equal(wk(before, 5).min, 0);
  assert.equal(wk(before, 6).min, 0);
  const [o] = parse([jp(TUE5, H(23), null)]);
  assert.deepEqual(validateRow(asInput(o, { end: H(0, 30) }), { ...ctx(o, YDAY), nowFrac: H(7) }).errors, []);
  const after = stats([jp(TUE5, H(23), H(0, 30))], YDAY);
  assert.equal(wk(after, 5).min, 90);
  assert.equal(wk(after, 6).min, 0);
  assert.equal(after.days[TUE5].studyDay, true);
});

// 6. Ngày chỉ có ca mở
test('ngày CHỈ có ca mở: không phải ngày có học (thay quyết định L4 Q1c)', () => {
  const st = stats([jp(YDAY, H(8), H(9)), jp(TODAY, H(12), null)]);
  assert.equal(st.days[TODAY].studyDay, false);
  assert.equal(st.studyDays, 1);
  assert.equal(wk(st, 6).studyDays, 1);
  assert.equal(st.medianMinPerStudyDay, 60); // ngày 0 phút không kéo trung vị xuống
});
test('dòng có ngày + chủ đề nhưng không giờ (không phải Bận đi làm): không phải ngày có học', () => {
  const st = stats([[TODAY, null, null, 'JP - Từ vựng', 'Lý thuyết']]);
  assert.equal(st.days[TODAY].studyDay, false);
});

// 7. Ngày có ca mở và một ca đã đóng
test('ngày có 1 ca đã đóng + 1 ca mở: là ngày có học, chỉ tính phút ca đã đóng', () => {
  const st = stats([jp(TODAY, H(8), H(9, 15)), jp(TODAY, H(10), null)]);
  assert.equal(st.days[TODAY].studyDay, true);
  assert.equal(st.days[TODAY].min, 75);
  assert.equal(st.totalMin, 75);
  assert.equal(st.rowsWithTime, 1);
});

// 8. Đóng ca xong
test('đóng ca xong (tải lại dữ liệu): giờ và ngày có học tính đúng', () => {
  const open = stats([jp(TODAY, H(8), null)]);
  assert.equal(open.studyDays, 0);
  const closed = stats([jp(TODAY, H(8), H(10, 30))]);
  assert.equal(closed.studyDays, 1);
  assert.equal(closed.totalMin, 150);
  assert.equal(wk(closed, 6).min, 150);
});

// 9. Hai ca cùng ngày
test('hai ca đã đóng cùng ngày: 1 ngày có học, cộng phút', () => {
  const st = stats([jp(TODAY, H(8), H(9)), jp(TODAY, H(14), H(15, 30), 'Ôn tập')]);
  assert.equal(st.studyDays, 1);
  assert.equal(st.days[TODAY].count, 2);
  assert.equal(st.totalMin, 150);
});

// 10. Ca vắt qua nửa đêm
test('ca vắt qua nửa đêm: tính trọn vào ngày bắt đầu; ngày hôm sau không thành ngày có học', () => {
  const st = stats([jp(YDAY, H(23, 30), H(0, 45))]);
  assert.equal(st.days[YDAY].min, 75);
  assert.equal(st.days[YDAY].studyDay, true);
  assert.equal(st.days[TODAY], undefined);
});

// 11. Tuần Đang diễn ra
test('tổng tuần Đang diễn ra không có phút từ ca mở', () => {
  const st = stats([jp(YDAY, H(8), H(9)), jp(TODAY, H(7), null), jp(TODAY, H(5), null)]);
  assert.equal(wk(st, 6).status, W.CURRENT);
  assert.equal(wk(st, 6).min, 60);
  assert.equal(wk(st, 6).studyDays, 1);
});

// Ngày Bận đi làm có ca đã đóng: vẫn KHÔNG là ngày có học (mục 6 giữ nguyên)
test('ngày Bận đi làm có ca đã đóng: phút vẫn tính, không phải ngày có học', () => {
  const st = stats([[TODAY, null, null, BUSY_TOPIC, null], jp(TODAY, H(20), H(20, 30), 'Ôn tập')]);
  assert.equal(st.totalMin, 30);
  assert.equal(st.days[TODAY].studyDay, false);
});
