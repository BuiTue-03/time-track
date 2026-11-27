// picker.js — Đọc/ghi ô chọn ngày, giờ của trình duyệt (input type="date" / type="time").
// Lý do: bàn phím số trên Android không có ":" và "/", nên ô chữ "hh:mm", "dd/mm/yyyy" không gõ được.
// Ô type="date" luôn dùng giá trị "yyyy-mm-dd", ô type="time" luôn dùng "HH:MM" 24 giờ, bất kể máy hiển thị ra sao;
// parseDateInput / parseTimeInput của rules.js đã đọc được hai dạng này nên không phải sửa rules.js.
import { ymdFromSerial } from './core.js';

const pad = n => String(n).padStart(2, '0');

// Số serial của ngày -> "yyyy-mm-dd" để gán vào ô type="date"
export function isoDate(serial) {
  const { y, m, d } = ymdFromSerial(serial);
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Đọc một ô: trống -> null; điền dở (trình duyệt báo badInput, value rỗng) -> NaN để báo lỗi;
// còn lại -> kết quả của hàm parse (đọc không được -> NaN).
export function readPicker(el, parse) {
  if (el.validity?.badInput) return NaN;
  const v = (el.value ?? '').trim();
  if (!v) return null;
  return parse(v) ?? NaN;
}
