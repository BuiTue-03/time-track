// picker.test.mjs — Ô chọn giờ/ngày của trình duyệt (type="time" / type="date"), sửa lỗi bàn phím số không có ":" và "/".
// Viết trước khi sửa mã. Ô type="date" nhận và trả "yyyy-mm-dd"; ô type="time" nhận và trả "HH:MM" (24 giờ),
// dù trên màn hình trình duyệt hiển thị theo cài đặt máy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isoDate, readPicker } from '../src/picker.js';
import { parseDateInput, parseTimeInput, fmtTime } from '../src/rules.js';
import { serialFromYMD } from '../src/core.js';

test('isoDate: số serial -> "yyyy-mm-dd" (dạng giá trị của ô type="date")', () => {
  assert.equal(isoDate(serialFromYMD(2026, 11, 27)), '2026-11-27');
  assert.equal(isoDate(serialFromYMD(2026, 1, 5)), '2026-01-05');
});

test('isoDate đi qua parseDateInput trả lại đúng ngày (không cần sửa rules.js)', () => {
  for (const [y, m, d] of [[2026, 10, 21], [2026, 11, 3], [2026, 12, 31], [2027, 2, 28]]) {
    const s = serialFromYMD(y, m, d);
    assert.equal(parseDateInput(isoDate(s)), s);
  }
});

test('fmtTime cho ra "HH:MM" mà ô type="time" nhận, parseTimeInput đọc lại đúng', () => {
  for (const min of [0, 59, 450, 520, 1439]) {
    const v = fmtTime(min / 1440);
    assert.match(v, /^\d{2}:\d{2}$/);
    assert.equal(Math.round(parseTimeInput(v) * 1440), min);
  }
});

test('readPicker: trống -> null; có giá trị -> giá trị đã đọc', () => {
  assert.equal(readPicker({ value: '', validity: { badInput: false } }, parseTimeInput), null);
  assert.equal(readPicker({ value: '07:30', validity: { badInput: false } }, parseTimeInput), 450 / 1440);
  assert.equal(readPicker({ value: '2026-11-27', validity: { badInput: false } }, parseDateInput), serialFromYMD(2026, 11, 27));
});

test('readPicker: điền dở (trình duyệt trả value rỗng + badInput) -> NaN, KHÔNG coi là trống', () => {
  // Nếu coi là trống, ô Kết thúc điền dở sẽ âm thầm lưu thành ca đang mở.
  assert.ok(Number.isNaN(readPicker({ value: '', validity: { badInput: true } }, parseTimeInput)));
});

test('readPicker: giá trị lạ -> NaN; thiếu validity vẫn chạy', () => {
  assert.ok(Number.isNaN(readPicker({ value: 'abc' }, parseTimeInput)));
  assert.equal(readPicker({ value: ' 08:40 ' }, parseTimeInput), 520 / 1440);
});
