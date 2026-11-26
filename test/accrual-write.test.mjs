// L6: chốt chặn ghi tab "Tích lũy" (viết TRƯỚC phần ghi). App chỉ ghi A:B và D của 1 dòng trong 2..60, KHÔNG BAO GIỜ cột C.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAccrualRanges, assertAccrualRange, serializeAccrual, findFirstEmptyAccrualRow,
  verifyAccrualReadback, buildAccrualFormatRequests, ACCRUAL_FIRST_ROW,
} from '../src/write-core.js';
import { ACCRUAL_LAST_ROW } from '../src/config.js';

const D1 = 46357; // 01/12/2026

test('Tích lũy: range ghi chỉ A{n}:B{n} và D{n}:D{n}, dòng 2..60', () => {
  assert.equal(ACCRUAL_FIRST_ROW, 2);
  assert.equal(ACCRUAL_LAST_ROW, 60);
  assert.deepEqual(buildAccrualRanges(2), { ab: "'Tích lũy'!A2:B2", d: "'Tích lũy'!D2:D2" });
  assert.deepEqual(buildAccrualRanges(60), { ab: "'Tích lũy'!A60:B60", d: "'Tích lũy'!D60:D60" });
  for (const n of [1, 61, 0, -3, 2.5, '5', null, 1002]) assert.throws(() => buildAccrualRanges(n), { code: 'RANGE' });
});

test('Tích lũy: chốt chặn từ chối cột C, nhiều dòng, tab khác, cả cột', () => {
  assert.equal(assertAccrualRange("'Tích lũy'!A5:B5"), true);
  assert.equal(assertAccrualRange("'Tích lũy'!D5:D5"), true);
  for (const bad of [
    "'Tích lũy'!A5:C5", "'Tích lũy'!C5:C5", "'Tích lũy'!A5:D5", "'Tích lũy'!B5:D5", "'Tích lũy'!A5:B6", "'Tích lũy'!D5:D6",
    "'Tích lũy'!A1:B1", "'Tích lũy'!A61:B61", "'Tích lũy'!A:B", "'Ca học'!A5:B5", "'Cài đặt'!D5:D5", "Tích lũy!A5:B5", "'Tích lũy'!R5C1:R5C2", null,
  ]) assert.throws(() => assertAccrualRange(bad), { code: 'RANGE' }, String(bad));
});

test('Tích lũy: serializeAccrual -> A ngày (serial nguyên), B số ngày (nguyên dương), D ghi chú; không có giá trị cột C', () => {
  const r = serializeAccrual({ date: D1, days: 2, note: '[T11/2026 · ab12] bỏ ống heo' });
  assert.deepEqual(r, { ab: [D1, 2], d: ['[T11/2026 · ab12] bỏ ống heo'] });
  for (const bad of [{ date: 1.5, days: 1 }, { date: D1, days: 0 }, { date: D1, days: -1 }, { date: D1, days: 1.5 }, { date: D1, days: '2' }])
    assert.throws(() => serializeAccrual({ note: 'x', ...bad }), { code: 'DATA' });
  assert.throws(() => serializeAccrual({ date: D1, days: 1, note: '' }), { code: 'DATA' }, 'ghi chú phải có nhãn tháng');
});

test('Tích lũy: dòng trống = A, B, D đều trống (cột C công thức bỏ qua); hết dòng 60 -> FULL', () => {
  // mảng A:D từ dòng 2; cột C có thể là "" hoặc số (công thức)
  assert.equal(findFirstEmptyAccrualRow([]).row, 2);
  assert.equal(findFirstEmptyAccrualRow([[D1, 1, 100000, '[T11/2026 · a]'], ['', '', '', ''], [D1, 2]]).row, 3);
  assert.equal(findFirstEmptyAccrualRow([[D1, 1, 100000, 'x'], ['', '', 0, '']]).row, 3, 'cột C = 0 vẫn là dòng trống');
  assert.equal(findFirstEmptyAccrualRow([[D1, 1, 100000, 'x'], ['', '', '', 'chỉ có ghi chú']]).row, 4, 'dòng chỉ có ghi chú D: không ghi đè');
  const full = Array.from({ length: 59 }, () => [D1, 1, 100000, 'x']);
  assert.throws(() => findFirstEmptyAccrualRow(full), { code: 'FULL' });
  const near = Array.from({ length: 58 }, () => [D1, 1, 100000, 'x']);
  const r = findFirstEmptyAccrualRow(near);
  assert.equal(r.row, 60);
  assert.match(r.warning, /1 dòng/);
  assert.equal(findFirstEmptyAccrualRow([]).warning, null);
  // mảng dài hơn 59 (Google trả quá dòng 60) không được chọn dòng 61
  assert.throws(() => findFirstEmptyAccrualRow([...full, ['', '', '', '']]), { code: 'FULL' });
});

test('Tích lũy: đọc lại — A, B, D phải khớp (lỗi); C = B × tiền/ngày (lệch -> cảnh báo); A hiện dd/mm/yyyy', () => {
  const sent = serializeAccrual({ date: D1, days: 2, note: '[T11/2026 · ab12]' });
  const ok = verifyAccrualReadback(sent, [D1, 2, 200000, '[T11/2026 · ab12]'], '01/12/2026', 100000);
  assert.deepEqual(ok, { ok: true, errors: [], warnings: [], cComputed: true });
  const bad = verifyAccrualReadback(sent, [D1, 3, 300000, '[T11/2026 · ab12]'], '01/12/2026', 100000);
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /Cột B/);
  const noC = verifyAccrualReadback(sent, [D1, 2, '', '[T11/2026 · ab12]'], '01/12/2026', 100000);
  assert.equal(noC.ok, true);
  assert.equal(noC.cComputed, false);
  assert.match(noC.warnings[0], /cột C|Số tiền/);
  const fmt = verifyAccrualReadback(sent, [D1, 2, 200000, '[T11/2026 · ab12]'], '46357', 100000);
  assert.match(fmt.warnings[0], /hiển thị/);
});

test('Tích lũy: định dạng chỉ cột A của đúng 1 dòng trong 2..60', () => {
  const r = buildAccrualFormatRequests(11, 7);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].repeatCell.range, { sheetId: 11, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 0, endColumnIndex: 1 });
  assert.equal(r[0].repeatCell.cell.userEnteredFormat.numberFormat.pattern, 'dd/MM/yyyy');
  assert.equal(r[0].repeatCell.fields, 'userEnteredFormat.numberFormat');
  for (const n of [1, 61]) assert.throws(() => buildAccrualFormatRequests(11, n), { code: 'RANGE' });
  assert.throws(() => buildAccrualFormatRequests(-1, 5), { code: 'RANGE' });
});
