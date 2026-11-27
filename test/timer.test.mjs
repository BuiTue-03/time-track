// timer.test.mjs — L7 Phần B: phép tính của nút Bắt đầu / Kết thúc / Đổi ca (src/timer.js).
// Viết TRƯỚC khi có src/timer.js (Lệnh L7, luật an toàn 2). Đồng hồ giả: mọi hàm nhận "mốc thời gian" (ms) từ ngoài,
// không tự gọi Date.now(), nên test đặt được giờ tùy ý (ngủ máy, đổi giờ, đổi múi giờ).
// Quyết định Oriana 27/11/2026 (Phần A, duyệt hết a–l): giờ làm tròn PHÚT (cắt giây); ca cùng phút -> hỏi Hủy ca / Tiếp tục;
// lưu tạm giờ bấm (tt-timer-pending); lệch giờ Google > 2 phút -> cảnh báo; 3 chủ đề gần nhất (bỏ nhóm Không học);
// trùng giờ = cảnh báo; ca mở từ 2 ngày trước -> chặn Bắt đầu, Mở Sheet; ca ≥ 24 giờ -> chặn Kết thúc trong app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { serialFromYMD as D, BUSY_TOPIC, parseSessions, parseTopics, computeStats, todaySerial } from '../src/core.js';
import { validateRow, EXPECTED_HEADERS, nowFraction } from '../src/rules.js';
import { serializeRow } from '../src/write-core.js';
import {
  clockFromMs, sessionStartMs, elapsed, fmtElapsed, startBlock, buildStartInput, planEnd, planSwitch,
  makePending, parsePending, pendingStatus, clockSkew, SKEW_WARN_MS, recentTopics, defaultChoice, PENDING_KEY,
} from '../src/timer.js';

// Giờ Việt Nam (UTC+7) -> mốc ms. Không dùng giờ địa phương của máy chạy test.
const VN = (y, mo, d, h, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h - 7, mi, s);
const H = (h, m = 0) => (h * 60 + m) / 1440;
const MIN = 60_000, HOUR = 60 * MIN;
const TODAY = D(2026, 11, 26);      // thứ Năm, tuần 6 (Đang diễn ra)
const YDAY = D(2026, 11, 25);       // thứ Tư, tuần 6
const TUE5 = D(2026, 11, 24);       // thứ Ba, tuần 5
const topics = parseTopics([['Chủ đề', 'Nhóm'], ['JP - Từ vựng', 'Ngoại ngữ'], ['JP - Luyện nghe', 'Ngoại ngữ'], ['JP - Ngữ pháp', 'Ngoại ngữ'],
  ['BA - Thực hành', 'Chuyên môn BA'], [BUSY_TOPIC, 'Không học'], ['Nghỉ ngơi', 'Không học']], 'values');
const parse = rows => parseSessions([['h'], ...rows], 'values', topics).sessions;
const model = (rows, today = TODAY) => { const sessions = parse(rows); return { sessions, stats: computeStats(sessions, today) }; };
const jp = (date, s, e, act = 'Lý thuyết', topic = 'JP - Từ vựng', note = '') => [date, s, e, topic, act, note];
const vctx = (m, extra) => ({ today: m.stats.today, topics, headers: EXPECTED_HEADERS, sessions: m.sessions, ...extra });

// ---------------------------------------------------------------------------------------------
// 1. Đồng hồ giờ Việt Nam từ mốc ms (không phụ thuộc múi giờ của điện thoại)
// ---------------------------------------------------------------------------------------------
test('clockFromMs: ngày + phút theo giờ VN, cắt giây', () => {
  const c = clockFromMs(VN(2026, 11, 26, 10, 15, 40));
  assert.equal(c.date, TODAY);
  assert.equal(c.minOfDay, 10 * 60 + 15);
  assert.equal(c.frac, H(10, 15));
  // 23:59:59 vẫn là hôm đó; 00:00:00 là ngày mới
  assert.equal(clockFromMs(VN(2026, 11, 26, 23, 59, 59)).date, TODAY);
  assert.equal(clockFromMs(VN(2026, 11, 27, 0, 0, 0)).date, TODAY + 1);
  assert.equal(clockFromMs(VN(2026, 11, 27, 0, 0, 0)).minOfDay, 0);
});

test('clockFromMs khớp todaySerial/nowFraction (Intl, Asia/Ho_Chi_Minh) trên 2.000 mốc ngẫu nhiên', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 2000; i++) {
    const ms = VN(2026, 10, 21, 0) + Math.floor(rnd() * 400 * 24 * HOUR);
    const c = clockFromMs(ms), d = new Date(ms);
    assert.equal(c.date, todaySerial(d), `ngày lệch ở ${d.toISOString()}`);
    assert.equal(c.frac, nowFraction(d), `giờ lệch ở ${d.toISOString()}`);
  }
});

test('đổi múi giờ điện thoại: kết quả không đổi (TZ = New York, Tokyo, UTC)', () => {
  const ms = VN(2026, 11, 26, 23, 30, 10);
  const old = process.env.TZ;
  const seen = [];
  try {
    for (const tz of ['America/New_York', 'Asia/Tokyo', 'UTC', 'Asia/Ho_Chi_Minh']) {
      process.env.TZ = tz;
      const c = clockFromMs(ms);
      seen.push(`${c.date}/${c.minOfDay}`);
    }
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
  assert.deepEqual(new Set(seen).size, 1);
  assert.equal(seen[0], `${TODAY}/${23 * 60 + 30}`);
});

// ---------------------------------------------------------------------------------------------
// 2. Thời gian đã trôi: tính từ giờ bắt đầu thật trong Sheet, không cộng dồn từng giây
// ---------------------------------------------------------------------------------------------
test('elapsed: từ giờ bắt đầu ghi trong Sheet; đúng sau khi máy "ngủ" 2 giờ', () => {
  const m = model([jp(TODAY, H(8, 40), null)]);
  const s = m.sessions[0];
  assert.equal(sessionStartMs(s), VN(2026, 11, 26, 8, 40));
  assert.deepEqual(elapsed(s, VN(2026, 11, 26, 8, 40, 0)), { ms: 0, min: 0, behind: false, overDay: false });
  // Không có tick nào giữa chừng (máy ngủ): chỉ cần mốc hiện tại
  const e = elapsed(s, VN(2026, 11, 26, 10, 41, 5));
  assert.equal(e.min, 121);
  assert.equal(e.ms, 2 * HOUR + MIN + 5000);
  assert.equal(fmtElapsed(e.ms), '2:01:05');
  assert.equal(fmtElapsed(65_000), '1:05');
  assert.equal(fmtElapsed(0), '0:00');
});

test('elapsed: ca vắt qua nửa đêm (ngày = ngày bắt đầu)', () => {
  const s = model([jp(YDAY, H(23, 30), null)]).sessions[0];
  const e = elapsed(s, VN(2026, 11, 26, 0, 45));
  assert.equal(e.min, 75);
  assert.equal(e.overDay, false);
});

test('elapsed: đồng hồ máy bị chỉnh lùi trước giờ bắt đầu -> behind, không ra số âm', () => {
  const s = model([jp(TODAY, H(10), null)]).sessions[0];
  const e = elapsed(s, VN(2026, 11, 26, 9, 50));
  assert.equal(e.behind, true);
  assert.equal(e.ms, 0);
  assert.equal(e.min, 0);
});

test('elapsed: từ 24 giờ trở lên -> overDay', () => {
  const s = model([jp(YDAY, H(8), null)], TODAY).sessions[0];
  assert.equal(elapsed(s, VN(2026, 11, 26, 7, 59)).overDay, false);
  assert.equal(elapsed(s, VN(2026, 11, 26, 8, 0)).overDay, true);
});

// ---------------------------------------------------------------------------------------------
// 3. Bắt đầu: một ca mở tại một thời điểm
// ---------------------------------------------------------------------------------------------
test('startBlock: dữ liệu rỗng / chỉ có ca đã đóng -> không chặn', () => {
  assert.equal(startBlock(model([]).stats), null);
  assert.equal(startBlock(model([jp(TODAY, H(8), H(9))]).stats), null);
});

test('startBlock: đã có ca mở hôm nay -> chặn, hiện ca đó', () => {
  const m = model([jp(TODAY, H(8), null)]);
  const b = startBlock(m.stats);
  assert.equal(b.reason, 'open');
  assert.equal(b.action, 'close');
  assert.equal(b.session.rowNumber, 2);
});

test('startBlock: ca mở hôm qua (tuần Đang diễn ra) -> chặn, dẫn tới luồng đóng ca L5', () => {
  const b = startBlock(model([jp(YDAY, H(20), null)]).stats);
  assert.equal(b.action, 'close');
  assert.equal(b.session.date, YDAY);
});

test('startBlock: ca mở hôm qua thuộc tuần Tạm chốt -> chặn, vẫn đóng được trong app', () => {
  const m = model([jp(TUE5, H(20), null)], D(2026, 11, 25));
  assert.equal(startBlock(m.stats).action, 'close');
});

test('startBlock: ca mở từ 2 ngày trước -> chặn, nút Mở Sheet (Phần A câu l)', () => {
  const b = startBlock(model([jp(TUE5, H(20), null)]).stats);
  assert.equal(b.action, 'sheet');
});

test('startBlock: nhiều ca mở -> chọn ca cũ nhất để xử lý trước, đếm số ca', () => {
  const b = startBlock(model([jp(TODAY, H(9), null), jp(TUE5, H(20), null)]).stats);
  assert.equal(b.session.date, TUE5);
  assert.equal(b.count, 2);
});

test('buildStartInput: ngày hôm nay (VN), giờ bấm cắt giây, chưa có giờ kết thúc; validateRow không lỗi', () => {
  const m = model([jp(TODAY, H(8), H(9))]);
  const now = VN(2026, 11, 26, 10, 15, 40);
  const c = clockFromMs(now);
  const input = buildStartInput({ clock: c, topic: 'JP - Từ vựng', activity: 'Ôn tập' });
  assert.deepEqual(input, { date: TODAY, start: H(10, 15), end: null, topic: 'JP - Từ vựng', activity: 'Ôn tập', noteText: '', isOffset: false });
  const v = validateRow(input, vctx(m, { mode: 'add', nowFrac: c.frac }));
  assert.deepEqual(v.errors, []);
  assert.deepEqual(serializeRow(input), [TODAY, H(10, 15), '', 'JP - Từ vựng', 'Ôn tập', '']);
});

test('Bắt đầu lúc 23:59:59 (sắp sang ngày): ngày vẫn là hôm đó', () => {
  const c = clockFromMs(VN(2026, 11, 26, 23, 59, 59));
  const input = buildStartInput({ clock: c, topic: 'JP - Từ vựng', activity: 'Ôn tập' });
  assert.equal(input.date, TODAY);
  assert.equal(input.start, H(23, 59));
});

test('Bắt đầu trùng giờ một ca đã đóng (nhập tay) -> chỉ CẢNH BÁO, không chặn (Phần A câu i)', () => {
  const m = model([jp(TODAY, H(10), H(11))]);
  const c = clockFromMs(VN(2026, 11, 26, 10, 30));
  const v = validateRow(buildStartInput({ clock: c, topic: 'JP - Từ vựng', activity: 'Ôn tập' }), vctx(m, { mode: 'add', nowFrac: c.frac }));
  assert.deepEqual(v.errors, []);
  assert.ok(v.warnings.some(w => w.includes('Trùng giờ')), JSON.stringify(v.warnings));
  assert.equal(startBlock(m.stats), null);
});

test('bấm Bắt đầu hai lần liền: lần 2 thấy ca vừa mở (sau đọc lại) -> chặn', () => {
  const after = model([jp(TODAY, H(10, 15), null)]);
  assert.equal(startBlock(after.stats).reason, 'open');
});

// ---------------------------------------------------------------------------------------------
// 4. Kết thúc: giờ kết thúc = giờ lúc BẤM
// ---------------------------------------------------------------------------------------------
test('Kết thúc 3 giờ sau: giờ kết thúc = giờ bấm (cắt giây), 180 phút, validateRow (sửa) không lỗi', () => {
  const m = model([jp(TODAY, H(8, 40), null)]);
  const s = m.sessions[0];
  const c = clockFromMs(VN(2026, 11, 26, 11, 40, 59));
  const p = planEnd(s, c);
  assert.equal(p.kind, 'close');
  assert.equal(p.durMin, 180);
  assert.equal(p.input.end, H(11, 40));
  assert.equal(p.input.date, TODAY);
  assert.equal(p.input.start, s.start);
  assert.deepEqual(validateRow(p.input, vctx(m, { mode: 'edit', original: s, nowFrac: c.frac })).errors, []);
  assert.deepEqual(serializeRow(p.input).slice(0, 3), [TODAY, H(8, 40), H(11, 40)]);
});

test('Kết thúc kèm ghi chú (tuần Đang diễn ra) -> ghi chú vào cột F; ghi chú cũ giữ nếu không nhập', () => {
  const m = model([jp(TODAY, H(8), null, 'Lý thuyết', 'JP - Từ vựng', 'cũ')]);
  const s = m.sessions[0], c = clockFromMs(VN(2026, 11, 26, 9));
  assert.equal(planEnd(s, c).input.noteText, 'cũ');
  const p = planEnd(s, c, { note: 'Mina bài 12' });
  assert.equal(p.noteAllowed, true);
  assert.equal(p.input.noteText, 'Mina bài 12');
});

test('Kết thúc ca vắt qua nửa đêm: ngày = ngày bắt đầu, kết thúc < bắt đầu, 75 phút, validateRow không lỗi', () => {
  const m = model([jp(YDAY, H(23, 30), null)]);
  const s = m.sessions[0], c = clockFromMs(VN(2026, 11, 26, 0, 45));
  const p = planEnd(s, c);
  assert.equal(p.kind, 'close');
  assert.equal(p.input.date, YDAY);
  assert.equal(p.input.end, H(0, 45));
  assert.equal(p.durMin, 75);
  assert.equal(p.nextDay, true);
  assert.deepEqual(validateRow(p.input, vctx(m, { mode: 'edit', original: s, nowFrac: c.frac })).errors, []);
});

test('Kết thúc ca hôm qua thuộc tuần Tạm chốt (sau 00:00 thứ Tư): chỉ điền giờ kết thúc, ghi chú bị bỏ qua', () => {
  const m = model([jp(TUE5, H(23), null, 'Lý thuyết', 'JP - Từ vựng', 'cũ')], D(2026, 11, 25));
  const s = m.sessions[0], c = clockFromMs(VN(2026, 11, 25, 0, 30));
  const p = planEnd(s, c, { note: 'ghi chú mới' });
  assert.equal(p.kind, 'close');
  assert.equal(p.noteAllowed, false);
  assert.equal(p.input.noteText, 'cũ');
  assert.deepEqual(validateRow(p.input, vctx(m, { mode: 'edit', original: s, nowFrac: c.frac })).errors, []);
});

test('ca đúng 24 giờ và vượt 24 giờ -> kind "sheet" (không ghi được trong app, cột G sẽ ra 0)', () => {
  const s = model([jp(YDAY, H(8), null)]).sessions[0];
  assert.equal(planEnd(s, clockFromMs(VN(2026, 11, 26, 7, 59))).kind, 'close');
  assert.equal(planEnd(s, clockFromMs(VN(2026, 11, 26, 7, 59))).durMin, 1439);
  assert.equal(planEnd(s, clockFromMs(VN(2026, 11, 26, 8, 0))).kind, 'sheet');
  assert.equal(planEnd(s, clockFromMs(VN(2026, 11, 26, 9, 0))).kind, 'sheet');
  assert.equal(planEnd(s, clockFromMs(VN(2026, 11, 26, 9, 0))).reason, 'over24h');
});

test('ca mở từ 2 ngày trước -> kind "sheet"', () => {
  const s = model([jp(TUE5, H(20), null)]).sessions[0];
  const p = planEnd(s, clockFromMs(VN(2026, 11, 26, 9)));
  assert.equal(p.kind, 'sheet');
});

test('ca dưới 1 phút (cùng phút) -> kind "zero" (hỏi Hủy ca / Tiếp tục học)', () => {
  const s = model([jp(TODAY, H(10, 15), null)]).sessions[0];
  assert.equal(planEnd(s, clockFromMs(VN(2026, 11, 26, 10, 15, 59))).kind, 'zero');
  assert.equal(planEnd(s, clockFromMs(VN(2026, 11, 26, 10, 16, 0))).kind, 'close');
  assert.equal(planEnd(s, clockFromMs(VN(2026, 11, 26, 10, 16, 0))).durMin, 1);
});

test('đồng hồ máy chậm hơn giờ bắt đầu trong Sheet -> kind "behind", không ghi', () => {
  const s = model([jp(TODAY, H(10, 15), null)]).sessions[0];
  assert.equal(planEnd(s, clockFromMs(VN(2026, 11, 26, 10, 0))).kind, 'behind');
});

test('planEnd với ca đã đóng / không phải ca mở -> kind "not-open"', () => {
  const s = model([jp(TODAY, H(8), H(9))]).sessions[0];
  assert.equal(planEnd(s, clockFromMs(VN(2026, 11, 26, 10))).kind, 'not-open');
});

// ---------------------------------------------------------------------------------------------
// 5. Đổi ca: đóng ca hiện tại và mở ca mới cùng một thời điểm
// ---------------------------------------------------------------------------------------------
test('Đổi ca: giờ kết thúc ca cũ = giờ bắt đầu ca mới = giờ bấm', () => {
  const m = model([jp(TODAY, H(8), null)]);
  const s = m.sessions[0], c = clockFromMs(VN(2026, 11, 26, 9, 30, 20));
  const p = planSwitch(s, c, { topic: 'JP - Luyện nghe', activity: 'Thực hành' });
  assert.equal(p.ok, true);
  assert.equal(p.end.input.end, H(9, 30));
  assert.equal(p.start.start, H(9, 30));
  assert.equal(p.start.date, TODAY);
  assert.equal(p.start.topic, 'JP - Luyện nghe');
});

test('Đổi ca: cùng chủ đề + cùng hoạt động -> không phải ca mới (same)', () => {
  const s = model([jp(TODAY, H(8), null)]).sessions[0];
  const p = planSwitch(s, clockFromMs(VN(2026, 11, 26, 9)), { topic: 'JP - Từ vựng', activity: 'Lý thuyết' });
  assert.equal(p.ok, false);
  assert.equal(p.reason, 'same');
  // chỉ đổi hoạt động là đủ
  assert.equal(planSwitch(s, clockFromMs(VN(2026, 11, 26, 9)), { topic: 'JP - Từ vựng', activity: 'Ôn tập' }).ok, true);
});

test('Đổi ca qua nửa đêm: ca cũ giữ ngày hôm qua, ca mới mang ngày hôm nay', () => {
  const s = model([jp(YDAY, H(23), null)]).sessions[0];
  const p = planSwitch(s, clockFromMs(VN(2026, 11, 26, 0, 20)), { topic: 'JP - Luyện nghe', activity: 'Thực hành' });
  assert.equal(p.end.input.date, YDAY);
  assert.equal(p.start.date, TODAY);
  assert.equal(p.start.start, H(0, 20));
});

test('Đổi ca khi ca cũ dưới 1 phút / quá 24 giờ -> không đổi được, trả lý do của bước đóng', () => {
  const s = model([jp(TODAY, H(9), null)]).sessions[0];
  const z = planSwitch(s, clockFromMs(VN(2026, 11, 26, 9, 0, 30)), { topic: 'JP - Luyện nghe', activity: 'Thực hành' });
  assert.equal(z.ok, false);
  assert.equal(z.reason, 'zero');
  const old = model([jp(YDAY, H(8), null)]).sessions[0];
  assert.equal(planSwitch(old, clockFromMs(VN(2026, 11, 26, 9)), { topic: 'JP - Luyện nghe', activity: 'Thực hành' }).reason, 'sheet');
});

// ---------------------------------------------------------------------------------------------
// 6. Lưu tạm giờ bấm (tt-timer-pending) và đọc lại trước khi thử lại (không ghi trùng)
// ---------------------------------------------------------------------------------------------
test('khóa lưu tạm tên tt-timer-pending; make/parse giữ đúng giờ bấm', () => {
  assert.equal(PENDING_KEY, 'tt-timer-pending');
  const c = clockFromMs(VN(2026, 11, 26, 10, 15, 40));
  const p = makePending({ kind: 'start', clock: c, topic: 'JP - Từ vựng', activity: 'Ôn tập' });
  const back = parsePending(JSON.stringify(p));
  assert.equal(back.kind, 'start');
  assert.equal(back.date, TODAY);
  assert.equal(back.minOfDay, 10 * 60 + 15);
  assert.equal(back.topic, 'JP - Từ vựng');
});

test('parsePending: chuỗi hỏng / thiếu trường / loại lạ -> null (không làm treo app)', () => {
  assert.equal(parsePending(null), null);
  assert.equal(parsePending('{'), null);
  assert.equal(parsePending('{"kind":"start"}'), null);
  assert.equal(parsePending(JSON.stringify({ kind: 'hack', date: TODAY, minOfDay: 1, topic: 'x', activity: 'y' })), null);
  assert.equal(parsePending(JSON.stringify({ v: 1, kind: 'end', date: TODAY, minOfDay: 5000, rowNumber: 3 })), null);
});

test('mất mạng TRƯỚC khi ghi Bắt đầu: đọc lại thấy chưa có dòng -> "todo", thử lại dùng ĐÚNG giờ bấm', () => {
  const c = clockFromMs(VN(2026, 11, 26, 10, 15));
  const p = makePending({ kind: 'start', clock: c, topic: 'JP - Từ vựng', activity: 'Ôn tập' });
  const st = pendingStatus(p, model([jp(TODAY, H(8), H(9))]).sessions);
  assert.equal(st.state, 'todo');
  // 20 phút sau mới có mạng: dòng ghi vẫn là 10:15
  const retry = buildStartInput({ clock: st.clock, topic: p.topic, activity: p.activity });
  assert.equal(retry.start, H(10, 15));
});

test('mất mạng / quá 8 giây GIỮA khi ghi Bắt đầu: đọc lại thấy dòng đã vào -> "done", KHÔNG ghi lại', () => {
  const p = makePending({ kind: 'start', clock: clockFromMs(VN(2026, 11, 26, 10, 15)), topic: 'JP - Từ vựng', activity: 'Ôn tập' });
  const st = pendingStatus(p, model([jp(TODAY, H(10, 15), null, 'Ôn tập')]).sessions);
  assert.equal(st.state, 'done');
  assert.equal(st.rowNumber, 2);
});

test('lưu tạm Bắt đầu nhưng máy khác đã mở ca khác -> "conflict", không ghi', () => {
  const p = makePending({ kind: 'start', clock: clockFromMs(VN(2026, 11, 26, 10, 15)), topic: 'JP - Từ vựng', activity: 'Ôn tập' });
  const st = pendingStatus(p, model([jp(TODAY, H(10, 5), null, 'Thực hành', 'BA - Thực hành')]).sessions);
  assert.equal(st.state, 'conflict');
  assert.equal(st.reason, 'other-open');
});

test('token hết hạn lúc Kết thúc: giờ bấm giữ trong lưu tạm; đăng nhập xong 7 phút sau vẫn ghi đúng giờ bấm', () => {
  const m = model([jp(TODAY, H(8), null)]);
  const s = m.sessions[0];
  const pressed = clockFromMs(VN(2026, 11, 26, 11, 0, 30));
  const p = makePending({ kind: 'end', clock: pressed, session: s, note: 'xong bài 3' });
  assert.equal(p.rowNumber, 2);
  const st = pendingStatus(parsePending(JSON.stringify(p)), m.sessions);
  assert.equal(st.state, 'todo');
  const plan = planEnd(st.session, st.clock, { note: p.note, today: clockFromMs(VN(2026, 11, 26, 11, 7)).date });
  assert.equal(plan.input.end, H(11, 0));
  assert.equal(plan.durMin, 180);
  assert.equal(plan.input.noteText, 'xong bài 3');
});

test('lưu tạm Kết thúc: đọc lại thấy giờ kết thúc đã vào -> "done"; dòng bị sửa ở nơi khác -> "conflict"', () => {
  const pressed = clockFromMs(VN(2026, 11, 26, 11, 0));
  const s = model([jp(TODAY, H(8), null)]).sessions[0];
  const p = makePending({ kind: 'end', clock: pressed, session: s });
  assert.equal(pendingStatus(p, model([jp(TODAY, H(8), H(11))]).sessions).state, 'done');
  assert.equal(pendingStatus(p, model([jp(TODAY, H(8), H(10, 30))]).sessions).state, 'conflict');
  assert.equal(pendingStatus(p, model([jp(TODAY, H(7), null)]).sessions).state, 'conflict');   // giờ bắt đầu bị sửa
  assert.equal(pendingStatus(p, model([]).sessions).state, 'conflict');                       // dòng bị xóa
});

test('lưu tạm Kết thúc qua ngày Tạm chốt: thử lại sau 00:00 thứ Tư vẫn đóng được, ghi chú bị bỏ qua', () => {
  const m = model([jp(TUE5, H(22), null)], D(2026, 11, 24));
  const p = makePending({ kind: 'end', clock: clockFromMs(VN(2026, 11, 24, 23, 50)), session: m.sessions[0], note: 'mới' });
  const later = model([jp(TUE5, H(22), null)], D(2026, 11, 25));
  const st = pendingStatus(p, later.sessions);
  const plan = planEnd(st.session, st.clock, { note: p.note, today: D(2026, 11, 25) });
  assert.equal(plan.kind, 'close');
  assert.equal(plan.noteAllowed, false);
  assert.equal(plan.input.end, H(23, 50));
});

test('Đổi ca lỗi SAU bước đóng, TRƯỚC bước mở: lưu tạm cho biết bước đóng xong, bước mở còn lại với ĐÚNG giờ bấm', () => {
  const s = model([jp(TODAY, H(8), null)]).sessions[0];
  const pressed = clockFromMs(VN(2026, 11, 26, 9, 30));
  const p = makePending({ kind: 'switch', clock: pressed, session: s, topic: 'JP - Luyện nghe', activity: 'Thực hành' });
  // Sheet: ca cũ đã đóng 09:30, ca mới chưa có
  const st = pendingStatus(p, model([jp(TODAY, H(8), H(9, 30))]).sessions);
  assert.equal(st.state, 'todo');
  assert.equal(st.step, 'start');
  assert.equal(buildStartInput({ clock: st.clock, topic: p.topic, activity: p.activity }).start, H(9, 30));
  // Chưa bước nào xong -> step 'end'
  assert.equal(pendingStatus(p, model([jp(TODAY, H(8), null)]).sessions).step, 'end');
  // Cả hai bước đã vào -> done
  assert.equal(pendingStatus(p, model([jp(TODAY, H(8), H(9, 30)), jp(TODAY, H(9, 30), null, 'Thực hành', 'JP - Luyện nghe')]).sessions).state, 'done');
});

// ---------------------------------------------------------------------------------------------
// 7. So giờ điện thoại với giờ Google (tiêu đề Date), ngưỡng 2 phút
// ---------------------------------------------------------------------------------------------
test('clockSkew: lệch ≤ 2 phút không cảnh báo; > 2 phút cảnh báo; tiêu đề hỏng -> null', () => {
  assert.equal(SKEW_WARN_MS, 2 * MIN);
  const server = VN(2026, 11, 26, 10, 0, 0);
  const hdr = new Date(server).toUTCString();
  // gửi lúc t0, nhận lúc t1; giờ Google ước lượng ở giữa (+0,5 giây vì Date chỉ tới giây)
  const ok = clockSkew({ dateHeader: hdr, sentMs: server - 200, recvMs: server + 200 });
  assert.equal(ok.warn, false);
  assert.ok(Math.abs(ok.skewMs) <= 1000);
  const fast = clockSkew({ dateHeader: hdr, sentMs: server + 3 * MIN, recvMs: server + 3 * MIN + 400 });
  assert.equal(fast.warn, true);
  assert.ok(fast.skewMs > 2 * MIN);
  const slow = clockSkew({ dateHeader: hdr, sentMs: server - 5 * MIN, recvMs: server - 5 * MIN + 100 });
  assert.equal(slow.warn, true);
  assert.ok(slow.skewMs < -2 * MIN);
  assert.equal(clockSkew({ dateHeader: 'abc', sentMs: 0, recvMs: 1 }), null);
  assert.equal(clockSkew({ dateHeader: null, sentMs: 0, recvMs: 1 }), null);
});

test('clockSkew: mạng quá chậm (> 10 giây khứ hồi) -> không kết luận (null)', () => {
  const server = VN(2026, 11, 26, 10);
  assert.equal(clockSkew({ dateHeader: new Date(server).toUTCString(), sentMs: server - 20_000, recvMs: server + 20_000 }), null);
});

// ---------------------------------------------------------------------------------------------
// 8. Chủ đề nhanh + mặc định theo ca gần nhất
// ---------------------------------------------------------------------------------------------
test('recentTopics: 3 chủ đề gần nhất, không trùng, bỏ nhóm Không học và dòng không giờ', () => {
  const m = model([
    jp(YDAY, H(8), H(9), 'Lý thuyết', 'JP - Ngữ pháp'),
    jp(YDAY, H(9), H(10), 'Lý thuyết', 'BA - Thực hành'),
    [TODAY, '', '', 'Nghỉ ngơi', ''],
    jp(TODAY, H(7), H(8), 'Lý thuyết', 'JP - Luyện nghe'),
    jp(TODAY, H(8), H(9), 'Ôn tập', 'JP - Từ vựng'),
    jp(TODAY, H(9), H(10), 'Ôn tập', 'JP - Luyện nghe'),
  ]);
  assert.deepEqual(recentTopics(m.sessions, topics), ['JP - Luyện nghe', 'JP - Từ vựng', 'BA - Thực hành']);
  assert.deepEqual(recentTopics([], topics), []);
});

test('defaultChoice: chủ đề + hoạt động của ca có giờ gần nhất (kể cả ca mở); rỗng -> null', () => {
  const m = model([jp(YDAY, H(8), H(9), 'Ôn tập', 'JP - Ngữ pháp'), jp(TODAY, H(7), H(8), 'Thực hành', 'BA - Thực hành'), [TODAY, '', '', BUSY_TOPIC, '']]);
  assert.deepEqual(defaultChoice(m.sessions, topics), { topic: 'BA - Thực hành', activity: 'Thực hành' });
  assert.equal(defaultChoice([], topics), null);
});

// ---------------------------------------------------------------------------------------------
// 9. Quy tắc L5 giữ nguyên: ca mở không cộng phút, không tính ngày có học
// ---------------------------------------------------------------------------------------------
test('ca vừa Bắt đầu: tổng phút và ngày có học không đổi cho tới khi đóng', () => {
  const before = model([jp(TODAY, H(7), H(8))]);
  const opened = model([jp(TODAY, H(7), H(8)), jp(TODAY, H(8), null)]);
  assert.equal(opened.stats.totalMin, before.stats.totalMin);
  assert.equal(opened.stats.studyDays, before.stats.studyDays);
  const closed = model([jp(TODAY, H(7), H(8)), jp(TODAY, H(8), H(11))]);
  assert.equal(closed.stats.totalMin, before.stats.totalMin + 180);
});
