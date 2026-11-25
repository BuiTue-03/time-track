// Test phần thuần của việc ghi: range A:F, serializeRow, đọc lại, snapshotCompare, findFirstEmptyRow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { serialFromYMD as D } from '../src/core.js';
import { buildWriteRange, assertWriteRange, serializeRow, verifyReadback, snapshotCompare, findFirstEmptyRow, isEmptyRow } from '../src/write-core.js';
import { LAST_FORMULA_ROW, ALLOW_WRITE_TO_REAL_SHEET, SPREADSHEET_ID, REAL_SPREADSHEET_ID } from '../src/config.js';

const H = (h, m = 0) => (h * 60 + m) / 1440;
const throwsRange = fn => assert.throws(fn, e => e.code === 'RANGE');

test('khóa an toàn: chưa bật ghi Sheet thật, đang trỏ bản thử', () => {
  assert.equal(ALLOW_WRITE_TO_REAL_SHEET, false);
  assert.notEqual(SPREADSHEET_ID, REAL_SPREADSHEET_ID);
  assert.equal(LAST_FORMULA_ROW, 1002);
});

// ---------- B3 ----------
test('buildWriteRange: chỉ A{n}:F{n}, n trong 2..1002', () => {
  assert.equal(buildWriteRange(2), "'Ca học'!A2:F2");
  assert.equal(buildWriteRange(1002), "'Ca học'!A1002:F1002");
  for (const bad of [1, 0, -5, 1003, 2.5, NaN, '10', null, undefined]) throwsRange(() => buildWriteRange(bad));
});
test('assertWriteRange: từ chối mọi range chạm cột G trở đi hoặc sai dạng', () => {
  assert.ok(assertWriteRange("'Ca học'!A165:F165"));
  for (const bad of [
    "'Ca học'!A165:G165", "'Ca học'!A165:K165", "'Ca học'!G165:K165", "'Ca học'!F165:G165",
    "'Ca học'!A:F", "'Ca học'!A165:F166", "'Ca học'!A1:F1", "'Ca học'!A1003:F1003",
    "'Chủ đề'!A2:F2", "'Tổng hợp tuần'!A2:F2", 'A165:F165', "'Ca học'!R165C1:R165C6",
    "'Ca học'!a165:f165", "'Ca học'!A165:F165,G165", "'Ca học'!A165:F165 ", '', null,
  ]) throwsRange(() => assertWriteRange(bad));
});

// ---------- B4 ----------
test('serializeRow: ngày = serial nguyên, giờ = phần ngày làm tròn phút, trống = ""', () => {
  const r = serializeRow({ date: D(2026, 11, 25), start: H(8, 40), end: H(11, 15), topic: 'JP - Từ vựng', activity: 'Lý thuyết', noteText: 'ok', isOffset: false });
  assert.deepEqual(r, [D(2026, 11, 25), 520 / 1440, 675 / 1440, 'JP - Từ vựng', 'Lý thuyết', 'ok']);
  assert.equal(r.length, 6);
  const open = serializeRow({ date: D(2026, 11, 25), start: 0, end: null, topic: 'JP - Từ vựng', activity: 'Nhờ AI', noteText: '', isOffset: false });
  assert.equal(open[1], 0);   // 00:00 là số 0, không phải ""
  assert.equal(open[2], '');  // ca đang mở
  const bu = serializeRow({ date: D(2026, 11, 24), start: H(23), end: H(0, 30), topic: 'JP - Từ vựng', activity: 'Ôn tập', noteText: 'quên', isOffset: true });
  assert.equal(bu[5], '[OFFSET] quên');
  assert.throws(() => serializeRow({ date: 46351.5 }));
  // giờ lẻ giây bị làm tròn về phút
  assert.equal(serializeRow({ date: 1, start: H(8, 40) + 20 / 86400, end: null })[1], 520 / 1440);
});
test('verifyReadback: thô khớp + hiển thị khớp -> ok; hiển thị mm/dd -> chỉ cảnh báo; thô lệch -> lỗi', () => {
  const sent = [D(2026, 11, 25), H(8, 40), H(11, 15), 'JP', 'Ôn tập', ''];
  const a = verifyReadback(sent, [...sent], ['25/11/2026', '8:40', '11:15', 'JP', 'Ôn tập']);
  assert.ok(a.ok); assert.equal(a.warnings.length, 0);
  const b = verifyReadback(sent, [...sent], ['11/25/2026', '08:40', '11:15']);
  assert.ok(b.ok); assert.ok(b.warnings[0].includes('Cột A'));
  const c = verifyReadback(sent, [sent[0], H(8, 41), sent[2], 'JP', 'Ôn tập'], []);
  assert.ok(!c.ok); assert.ok(c.errors[0].startsWith('Cột B'));
});

// ---------- B5 ----------
test('snapshotCompare: trống = trống, số so tới ~0,4 giây, chuỗi nguyên văn', () => {
  const s = [D(2026, 11, 25), H(8), H(9), 'JP', 'Ôn tập', ''];
  assert.ok(snapshotCompare(s, [...s]).same);
  assert.ok(snapshotCompare(s, s.slice(0, 5)).same);               // Google bỏ ô trống ở cuối
  assert.ok(snapshotCompare(s, [s[0], s[1] + 1e-12, ...s.slice(2)]).same);
  assert.ok(!snapshotCompare(s, [s[0], s[1] + 1 / 1440, ...s.slice(2)]).same); // lệch 1 phút: khác
  const d = snapshotCompare(s, [s[0], s[1], H(9, 30), 'JP', 'Ôn tập', 'sửa ngoài']);
  assert.equal(d.same, false);
  assert.deepEqual(d.diffs.map(x => x.col), ['C', 'F']);
  assert.ok(!snapshotCompare(s, []).same);                         // dòng bị xóa ở nơi khác
  assert.ok(!snapshotCompare(s, [...s.slice(0, 3), 'JP ', 'Ôn tập']).same); // khác 1 dấu cách cũng tính
});

// ---------- B6 ----------
const filled = n => Array.from({ length: n }, (_, i) => [D(2026, 10, 21) + (i % 30), H(8), H(9), 'JP', 'Ôn tập']);
test('findFirstEmptyRow: dòng sau dữ liệu cuối (Google cắt dòng trống cuối)', () => {
  const r = findFirstEmptyRow(filled(165));          // dữ liệu dòng 2..166
  assert.equal(r.row, 167);
  assert.equal(r.emptyLeft, 1002 - 166);
  assert.equal(r.warning, null);
});
test('findFirstEmptyRow: lấp dòng trống ở giữa; dòng chỉ còn ghi chú F không bị coi là trống', () => {
  const rows = filled(10);
  rows[3] = ['', '', '', '', '', 'ghi chú sót'];      // dòng 5: còn chữ ở F
  rows[6] = [];                                       // dòng 8: trống hẳn
  assert.equal(findFirstEmptyRow(rows).row, 8);
  assert.ok(!isEmptyRow(rows[3]));
  assert.ok(isEmptyRow(undefined));
});
test('findFirstEmptyRow: còn <= 50 dòng thì cảnh báo; hết dòng thì chặn, không nâng giới hạn', () => {
  const r = findFirstEmptyRow(filled(1001 - 50));     // dữ liệu tới dòng 952 -> còn 50 dòng
  assert.equal(r.row, 953); assert.equal(r.emptyLeft, 50); assert.ok(r.warning.includes('50'));
  assert.equal(findFirstEmptyRow(filled(1001 - 51)).warning, null);
  assert.equal(findFirstEmptyRow(filled(1000)).row, 1002);
  assert.throws(() => findFirstEmptyRow(filled(1001)), e => e.code === 'FULL' && e.message.includes('KHÔNG tự nới'));
  // dữ liệu nằm sau dòng 1002 (nếu có) không làm app ghi ra ngoài 1002
  assert.throws(() => findFirstEmptyRow([...filled(1001), []]), e => e.code === 'FULL');
});

// ---------- Cột K "Ngày mới?" = IF(COUNTIF($A$2:A{n};A{n})=1;1;0): mô phỏng khi lấp dòng trống ở giữa ----------
const kColumn = colA => colA.map((a, i) => (typeof a === 'number' ? (colA.slice(0, i + 1).filter(x => x === a).length === 1 ? 1 : 0) : ''));
const daysCounted = colA => { const k = kColumn(colA); const m = {}; colA.forEach((a, i) => { if (k[i] === 1) m[a] = (m[a] ?? 0) + 1; }); return m; };
test('lấp dòng trống giữa danh sách: cột K vẫn đếm đúng 1 lần cho mỗi ngày', () => {
  const d1 = D(2026, 11, 24), d2 = D(2026, 11, 25);
  const rows = [[d1, H(8), H(9)], [], [d2, H(8), H(9)], [d2, H(10), H(11)]]; // dòng 3 trống (đã xóa nội dung)
  const { row } = findFirstEmptyRow(rows);
  assert.equal(row, 3);
  rows[row - 2] = serializeRow({ date: d2, start: H(7), end: H(7, 30), topic: 'JP', activity: 'Ôn tập' }); // ca mới của d2 rơi vào dòng 3, TRƯỚC 2 ca cũ của d2
  const colA = rows.map(r => r[0] ?? '');
  assert.deepEqual(kColumn(colA), [1, 1, 0, 0]);  // dòng 3 thành "ngày mới", 2 dòng sau thành 0
  assert.deepEqual(daysCounted(colA), { [d1]: 1, [d2]: 1 });
  // thêm 1 ngày khác (d1) vào chỗ trống ở giữa vẫn đúng
  const rows2 = [[d2, H(8), H(9)], [], [d2, H(10), H(11)]];
  rows2[1] = [d1];
  assert.deepEqual(daysCounted(rows2.map(r => r[0] ?? '')), { [d1]: 1, [d2]: 1 });
});
