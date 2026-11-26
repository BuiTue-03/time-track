import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFormatRequests } from '../src/write-core.js';

test('định dạng: đúng 1 dòng, chỉ cột A–C, chỉ numberFormat', () => {
  const r = buildFormatRequests(770055516, 168);
  assert.equal(r.length, 3);
  r.forEach((q, i) => {
    assert.deepEqual(q.repeatCell.range, { sheetId: 770055516, startRowIndex: 167, endRowIndex: 168, startColumnIndex: i, endColumnIndex: i + 1 });
    assert.equal(q.repeatCell.fields, 'userEnteredFormat.numberFormat');
  });
  assert.equal(r[0].repeatCell.cell.userEnteredFormat.numberFormat.pattern, 'dd/MM/yyyy');
  assert.equal(r[1].repeatCell.cell.userEnteredFormat.numberFormat.pattern, 'hh:mm');
  assert.equal(r[2].repeatCell.cell.userEnteredFormat.numberFormat.type, 'TIME');
});
test('định dạng: chặn dòng ngoài 2..1002 và sheetId sai', () => {
  for (const n of [1, 1003, 0, 2.5, '5']) assert.throws(() => buildFormatRequests(1, n), { code: 'RANGE' });
  for (const id of [-1, null, 1.5, '1']) assert.throws(() => buildFormatRequests(id, 10), { code: 'RANGE' });
});
