// Test luật L4: bảng quyền theo trạng thái tuần, nhãn [OFFSET], validateRow, sửa / xóa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { serialFromYMD as D, WEEK_STATUS as W, BUSY_TOPIC, parseSessions, parseTopics, computeStats } from '../src/core.js';
import {
  OFFSET_LABEL, isOffsetNote, splitNote, composeNote, weekStatusOfDate, permissions, MSG_FINAL,
  validateRow, checkEdit, checkDelete, parseDateInput, parseTimeInput, fmtTime, EXPECTED_HEADERS, nowFraction,
} from '../src/rules.js';

const H = (h, m = 0) => (h * 60 + m) / 1440;
const TODAY = D(2026, 11, 25);           // thứ Tư, tuần 6 (Đang diễn ra)
const TUE_PREV = D(2026, 11, 24);        // thứ Ba, tuần 5 (Tạm chốt)
const FINAL_DAY = D(2026, 11, 17);       // tuần 4 (Chốt hẳn)
const topics = new Map([['JP - Từ vựng', 'Ngoại ngữ'], [BUSY_TOPIC, 'Không học'], ['Nghỉ ngơi', 'Không học']]);
const ctx = (extra = {}) => ({ mode: 'add', today: TODAY, nowFrac: H(23, 59), topics, headers: EXPECTED_HEADERS, sessions: [], ...extra });
const row = (extra = {}) => ({ date: TODAY, start: H(8), end: H(9), topic: 'JP - Từ vựng', activity: 'Ôn tập', noteText: '', isOffset: false, ...extra });
const ok = r => assert.deepEqual(r.errors, [], JSON.stringify(r.errors));

// ---------- Trạng thái tuần ----------
test('weekStatusOfDate: biên thứ Ba -> thứ Tư', () => {
  assert.equal(weekStatusOfDate(TODAY, TODAY), W.CURRENT);
  assert.equal(weekStatusOfDate(TUE_PREV, TODAY), W.PROVISIONAL);       // hôm qua (thứ Ba) đã là tuần trước
  assert.equal(weekStatusOfDate(D(2026, 11, 18), TODAY), W.PROVISIONAL); // thứ Tư đầu tuần 5
  assert.equal(weekStatusOfDate(FINAL_DAY, TODAY), W.FINAL);            // thứ Ba cuối tuần 4
  assert.equal(weekStatusOfDate(D(2026, 12, 2), TODAY), W.FUTURE);      // thứ Tư tuần 7
  // Hôm qua (thứ Ba 24/11) thì chính ngày 24/11 còn Đang diễn ra
  assert.equal(weekStatusOfDate(TUE_PREV, TUE_PREV), W.CURRENT);
  assert.equal(weekStatusOfDate(D(2026, 10, 20), TODAY), W.FINAL);      // trước ngày bắt đầu
});

// ---------- Bảng quyền: 12 ô (3 trạng thái × 4 hành động), ca thường ----------
const CELLS = {
  [W.CURRENT]:     { canAdd: true,  canAddBu: true,  canEdit: true,  canDelete: true },
  [W.PROVISIONAL]: { canAdd: false, canAddBu: true,  canEdit: true,  canDelete: false },
  [W.FINAL]:       { canAdd: false, canAddBu: false, canEdit: false, canDelete: false },
};
for (const [status, want] of Object.entries(CELLS)) for (const [k, v] of Object.entries(want)) {
  test(`bảng quyền: ${status} · ${k} = ${v}`, () => {
    const p = permissions(status);
    assert.equal(p[k], v);
    if (!v) assert.ok(p.reasons[k] && p.reasons[k].length > 10, 'ô bị khóa phải có lý do');
  });
}
test('Chốt hẳn: cả 4 quyền false cho cả ca thường lẫn ca ghi bù, lý do đúng 1 câu đã chốt', () => {
  for (const isOffset of [false, true]) {
    const p = permissions(W.FINAL, { isOffset });
    for (const k of ['canAdd', 'canAddBu', 'canEdit', 'canDelete']) { assert.equal(p[k], false); assert.equal(p.reasons[k], MSG_FINAL); }
  }
  assert.equal(MSG_FINAL, 'Tuần này đã chốt hẳn. Muốn sửa, hãy sửa trực tiếp trên Sheet.');
});
test('Tạm chốt: ca thường sửa được nhưng không sửa giờ; ca ghi bù sửa/xóa được mọi trường', () => {
  const n = permissions(W.PROVISIONAL), o = permissions(W.PROVISIONAL, { isOffset: true });
  assert.equal(n.canEditTime, false); assert.equal(n.canDelete, false);
  assert.equal(o.canEditTime, true); assert.equal(o.canDelete, true);
});
test('tuần tương lai: chặn hết', () => {
  const p = permissions(W.FUTURE);
  assert.ok(['canAdd', 'canAddBu', 'canEdit', 'canDelete'].every(k => p[k] === false));
});

// ---------- Nhãn [OFFSET] ----------
test('nhãn [OFFSET]: ghép, tách, nhận diện', () => {
  assert.equal(composeNote(true, 'quên ghi hôm qua'), '[OFFSET] quên ghi hôm qua');
  assert.equal(composeNote(true, ''), '[OFFSET]');
  assert.equal(composeNote(false, 'abc'), 'abc');
  assert.equal(composeNote(false, '   '), '');
  assert.ok(isOffsetNote('  [OFFSET] x'));   // khoảng trắng đầu được bỏ qua
  assert.ok(isOffsetNote('[OFFSET]'));
  assert.ok(!isOffsetNote('[offset] x'));    // phân biệt hoa thường
  assert.ok(!isOffsetNote('ghi chú [OFFSET]')); // phải ở đầu ô
  assert.ok(!isOffsetNote('[bù] x'));        // nhãn cũ không còn dùng
  assert.deepEqual(splitNote('[OFFSET] quên ghi'), { isOffset: true, text: 'quên ghi' });
  assert.deepEqual(splitNote('[OFFSET]'), { isOffset: true, text: '' });
  assert.deepEqual(splitNote('bình thường'), { isOffset: false, text: 'bình thường' });
  assert.equal(OFFSET_LABEL, '[OFFSET]');
});

// ---------- Đổi chữ từ form ----------
test('parseDateInput / parseTimeInput', () => {
  assert.equal(parseDateInput('25/11/2026'), TODAY);
  assert.equal(parseDateInput(' 5/1/2027 '), D(2027, 1, 5));
  assert.equal(parseDateInput('2026-11-25'), TODAY);
  assert.equal(parseDateInput('31/11/2026'), null);
  assert.equal(parseDateInput('11/25/2026'), null); // kiểu Mỹ mm/dd: tháng 25 -> sai
  assert.equal(parseDateInput('25-11-2026'), null);
  assert.equal(parseTimeInput('8:40'), 520 / 1440);
  assert.equal(parseTimeInput('0840'), 520 / 1440);
  assert.equal(parseTimeInput('8:40 PM'), null);
  assert.equal(parseTimeInput('00:00'), 0);
  assert.equal(parseTimeInput('08:40'), 520 / 1440);
  assert.equal(parseTimeInput('24:00'), null);
  assert.equal(fmtTime(H(23, 5)), '23:05');
  assert.equal(nowFraction(new Date('2026-11-25T09:44:00Z')), H(16, 44)); // 16:44 giờ VN
});

// ---------- validateRow: thêm ----------
test('thêm ca thường ở tuần Đang diễn ra: hợp lệ', () => ok(validateRow(row(), ctx())));
test('ca 00:00 -> 00:45 hợp lệ, 0 không bị coi là "trống"', () => ok(validateRow(row({ start: 0, end: H(0, 45) }), ctx())));
test('ca kết thúc đúng 00:00 (qua đêm 23:00 -> 00:00) = 60 phút, có cảnh báo qua đêm', () => {
  const r = validateRow(row({ date: TUE_PREV, start: H(23), end: 0, isOffset: true }), ctx());
  ok(r);
  assert.ok(r.warnings.some(w => w.includes('qua đêm') && w.includes('60 phút')));
});
test('ca qua đêm 23:30 -> 00:30: cho phép, cảnh báo; > 10 tiếng thêm cảnh báo', () => {
  const r = validateRow(row({ date: D(2026, 11, 22), start: H(23, 30), end: H(0, 30), isOffset: true }), ctx());
  ok(r);
  assert.ok(r.warnings.some(w => w.includes('qua đêm')));
  const long = validateRow(row({ start: H(1), end: H(12) }), ctx());
  ok(long);
  assert.ok(long.warnings.some(w => w.includes('hơn 10 tiếng')));
});
test('giờ gõ sai dạng: chặn với câu dễ hiểu', () => {
  assert.ok(validateRow(row({ start: NaN }), ctx()).errors.some(e => e.includes('hh:mm')));
  assert.ok(validateRow(row({ end: NaN }), ctx()).errors.some(e => e.includes('hh:mm')));
});
test('giờ bắt đầu = giờ kết thúc: chặn', () => assert.ok(validateRow(row({ start: H(8), end: H(8) }), ctx()).errors.length));
test('ngày tương lai và giờ tương lai của hôm nay: chặn', () => {
  assert.ok(validateRow(row({ date: TODAY + 1 }), ctx()).errors.some(e => e.includes('tương lai')));
  const c = ctx({ nowFrac: H(16, 44) });
  assert.ok(validateRow(row({ start: H(17), end: null }), c).errors.some(e => e.includes('bắt đầu ở tương lai')));
  assert.ok(validateRow(row({ start: H(16), end: H(17) }), c).errors.some(e => e.includes('kết thúc ở tương lai')));
  ok(validateRow(row({ start: H(16), end: H(16, 44) }), c)); // đúng bằng bây giờ: được
  // ca qua đêm bắt đầu hôm qua, kết thúc sáng nay trước giờ hiện tại: được
  ok(validateRow(row({ date: TUE_PREV, start: H(23), end: H(1), isOffset: true }), c));
});
test('hai ca cùng ngày không trùng: không cảnh báo; trùng giờ: chỉ cảnh báo', () => {
  const sessions = [{ rowNumber: 160, date: TODAY, start: H(8), end: H(9) }];
  const a = validateRow(row({ start: H(9), end: H(10) }), ctx({ sessions }));
  ok(a); assert.equal(a.warnings.length, 0); // 9:00 nối tiếp 9:00 không tính là trùng
  const b = validateRow(row({ start: H(8, 30), end: H(9, 30) }), ctx({ sessions }));
  ok(b); assert.ok(b.warnings.some(w => w.includes('dòng 160')));
  // ca qua đêm hôm trước kéo sang sáng nay cũng bị phát hiện trùng
  const c = validateRow(row({ start: H(0, 10), end: H(0, 40) }), ctx({ sessions: [{ rowNumber: 150, date: TUE_PREV, start: H(23, 30), end: H(1) }] }));
  assert.ok(c.warnings.some(w => w.includes('dòng 150')));
});
test('ca đang mở (chưa có giờ kết thúc): được ở tuần Đang diễn ra, chặn ở tuần Tạm chốt', () => {
  ok(validateRow(row({ end: null }), ctx()));
  assert.ok(validateRow(row({ date: TUE_PREV, end: null, isOffset: true }), ctx()).errors.some(e => e.includes('chưa có giờ kết thúc')));
});
test('chủ đề chưa phân loại: cảnh báo, không chặn', () => {
  const r = validateRow(row({ topic: 'JP - Chủ đề mới' }), ctx());
  ok(r); assert.ok(r.warnings.some(w => w.includes('Chưa phân loại')));
});
test('thiếu chủ đề / hoạt động / giờ bắt đầu: chặn; "Bận đi làm" không cần giờ và hoạt động', () => {
  assert.ok(validateRow(row({ topic: '' }), ctx()).errors.length);
  assert.ok(validateRow(row({ activity: '' }), ctx()).errors.length);
  assert.ok(validateRow(row({ start: null, end: null }), ctx()).errors.length);
  ok(validateRow(row({ topic: BUSY_TOPIC, activity: '', start: null, end: null }), ctx()));
});
test('tiêu đề cột trong Sheet đổi: chặn', () => {
  assert.ok(validateRow(row(), ctx({ headers: ['Ngày', 'Bắt đầu', 'Kết thúc', 'Chủ đề', 'Ghi chú', 'Hoạt động'] })).errors.some(e => e.includes('Tiêu đề')));
});
test('thêm ở tuần Tạm chốt: ca thường bị chặn, ca ghi bù được', () => {
  const r = validateRow(row({ date: TUE_PREV }), ctx());
  assert.ok(r.errors.some(e => e.includes('tạm chốt')));
  ok(validateRow(row({ date: TUE_PREV, isOffset: true }), ctx()));
});
test('thêm ở tuần Chốt hẳn: chặn cả ca thường lẫn ca ghi bù bằng đúng câu đã chốt', () => {
  assert.ok(validateRow(row({ date: FINAL_DAY }), ctx()).errors.includes(MSG_FINAL));
  assert.ok(validateRow(row({ date: FINAL_DAY, isOffset: true }), ctx()).errors.includes(MSG_FINAL));
});
test('ô tick ghi bù ở tuần Đang diễn ra: không bắt buộc, có hay không đều được (Q3)', () => {
  ok(validateRow(row({ isOffset: true }), ctx()));
  ok(validateRow(row({ isOffset: false }), ctx()));
});
test('tự gõ "[OFFSET]" vào ghi chú: chặn, phải dùng ô tick', () => {
  assert.ok(validateRow(row({ noteText: '[OFFSET] x' }), ctx()).errors.some(e => e.includes('ô tick')));
});
test('Q2: mở form tối thứ Ba, bấm Lưu sau 00:00 thứ Tư -> quy tắc tính lại và chặn', () => {
  const draft = row({ date: TUE_PREV, start: H(22), end: H(23) });
  ok(validateRow(draft, ctx({ today: TUE_PREV })));                 // lúc mở form: tuần còn Đang diễn ra
  assert.ok(validateRow(draft, ctx({ today: TODAY })).errors.length); // lúc lưu: tuần đã Tạm chốt
});

// ---------- Sửa ----------
const orig = (extra = {}) => ({ rowNumber: 120, date: TUE_PREV, start: H(8), end: H(9), topic: 'JP - Từ vựng', activity: 'Ôn tập', note: '', ...extra });
const asInput = (o, extra = {}) => ({ ...o, noteText: splitNote(o.note).text, isOffset: isOffsetNote(o.note), ...extra });
test('sửa ca thường ở Tạm chốt: đổi chủ đề/hoạt động/ghi chú được, đổi giờ hay ngày bị chặn', () => {
  const o = orig();
  assert.deepEqual(checkEdit(asInput(o, { activity: 'Lý thuyết', noteText: 'thêm' }), o, TODAY), []);
  assert.ok(checkEdit(asInput(o, { end: H(9, 30) }), o, TODAY).length);
  assert.ok(checkEdit(asInput(o, { date: TUE_PREV - 1 }), o, TODAY).length);
});
test('Q6a: sửa ca không được thêm hay bỏ nhãn ghi bù', () => {
  const o = orig();
  assert.ok(checkEdit(asInput(o, { isOffset: true }), o, TODAY)[0].includes('thêm ca mới'));
  const b = orig({ note: '[OFFSET] x' });
  assert.ok(checkEdit(asInput(b, { isOffset: false }), b, TODAY)[0].includes('bỏ'));
});
test('Q6b: ca ghi bù ở Tạm chốt đổi ngày được trong tuần đó, không sang tuần khác', () => {
  const b = orig({ note: '[OFFSET]' });
  assert.deepEqual(checkEdit(asInput(b, { date: D(2026, 11, 20), start: H(7) }), b, TODAY), []);
  assert.ok(checkEdit(asInput(b, { date: TODAY }), b, TODAY).some(e => e.includes('tuần khác')));
  assert.ok(checkEdit(asInput(b, { date: FINAL_DAY }), b, TODAY).some(e => e.includes('tuần khác')));
});
test('sửa ở tuần Đang diễn ra: đổi giờ được, đổi ngày trong tuần được, sang tuần khác bị chặn', () => {
  const o = orig({ date: TODAY });
  assert.deepEqual(checkEdit(asInput(o, { start: H(7), end: H(10) }), o, TODAY), []);
  assert.ok(checkEdit(asInput(o, { date: TUE_PREV }), o, TODAY).some(e => e.includes('tuần khác')));
});
test('Q6c + L5 (Phần A e): "Kết thúc ca" ở Đang diễn ra được; ca mở cũ ở Tạm chốt đóng được nhưng chỉ điền giờ kết thúc', () => {
  const open = orig({ date: TODAY, end: null });
  ok(validateRow(asInput(open, { end: H(10) }), ctx({ mode: 'edit', original: open })));
  const oldOpen = orig({ end: null });
  ok(validateRow(asInput(oldOpen, { activity: 'Lý thuyết' }), ctx({ mode: 'edit', original: oldOpen })));
  ok(validateRow(asInput(oldOpen, { end: H(10) }), ctx({ mode: 'edit', original: oldOpen })));            // L5: đóng được
  assert.ok(validateRow(asInput(oldOpen, { end: H(10), activity: 'Lý thuyết' }), ctx({ mode: 'edit', original: oldOpen })).errors.length); // đóng + sửa: chặn
});
test('sửa ở Chốt hẳn: chặn kể cả chỉ đổi ghi chú', () => {
  const o = orig({ date: FINAL_DAY });
  assert.deepEqual(checkEdit(asInput(o, { noteText: 'x' }), o, TODAY), [MSG_FINAL]);
});

// ---------- Xóa ----------
test('xóa: Đang diễn ra được; Tạm chốt chỉ ca ghi bù; Chốt hẳn chặn', () => {
  assert.deepEqual(checkDelete(orig({ date: TODAY }), TODAY), []);
  assert.ok(checkDelete(orig(), TODAY).length);
  assert.deepEqual(checkDelete(orig({ note: '[OFFSET] x' }), TODAY), []);
  assert.deepEqual(checkDelete(orig({ date: FINAL_DAY, note: '[OFFSET]' }), TODAY), [MSG_FINAL]);
});

// ---------- Ca ghi bù sau khi lưu được core đọc lại đúng ----------
test('ca [OFFSET] ghi vào tuần Tạm chốt làm đổi tổng tuần 5 (nhãn "tạm chốt" vẫn đúng)', () => {
  const t = parseTopics([['Chủ đề', 'Nhóm'], ['JP - Từ vựng', 'Ngoại ngữ']], 'values');
  const base = [['h'], [D(2026, 11, 20), H(8), H(9), 'JP - Từ vựng', 'Ôn tập', '']];
  const before = computeStats(parseSessions(base, 'values', t).sessions, TODAY);
  const after = computeStats(parseSessions([...base, [TUE_PREV, H(20), H(21, 30), 'JP - Từ vựng', 'Ôn tập', composeNote(true, 'quên')]], 'values', t).sessions, TODAY);
  const w5 = s => s.weeks.find(w => w.week === 5);
  assert.equal(w5(before).min, 60);
  assert.equal(w5(after).min, 150);
  assert.equal(w5(after).status, W.PROVISIONAL);
});
