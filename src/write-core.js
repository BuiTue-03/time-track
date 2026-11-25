// write-core.js — Phần "thuần" của việc ghi Sheet (L4): dựng range, đổi dữ liệu form thành 1 dòng A:F,
// so sánh ảnh chụp dòng, tìm dòng trống. Không gọi mạng -> test được bằng node --test.
// sheets-write.js (phần gọi Google) BẮT BUỘC đi qua các hàm ở đây.
import { LAST_FORMULA_ROW, SHEET_CA_HOC } from './config.js';
import { composeNote, fmtTime, minutesOf } from './rules.js';
import { fmtDate } from './core.js';

export const FIRST_DATA_ROW = 2;
export const LOW_ROWS_WARNING = 50; // còn <= 50 dòng trống -> cảnh báo

function err(code, message) { return Object.assign(new Error(message), { code }); }

// ---------------------------------------------------------------------------------------------
// B3. HÀM DUY NHẤT dựng range ghi: luôn là 'Ca học'!A{n}:F{n}, n trong 2..1002.
// ---------------------------------------------------------------------------------------------
export function buildWriteRange(rowIndex) {
  if (!Number.isInteger(rowIndex)) throw err('RANGE', `Số dòng không hợp lệ: ${JSON.stringify(rowIndex)}`);
  if (rowIndex < FIRST_DATA_ROW || rowIndex > LAST_FORMULA_ROW)
    throw err('RANGE', `Dòng ${rowIndex} ngoài khoảng ${FIRST_DATA_ROW}..${LAST_FORMULA_ROW}. Không ghi.`);
  const a1 = `'${SHEET_CA_HOC}'!A${rowIndex}:F${rowIndex}`;
  assertWriteRange(a1); // tự kiểm lại chính mình
  return a1;
}

// Chốt chặn thứ hai: mọi range trước khi gửi lệnh ghi/xóa đều phải qua đây.
// Chỉ nhận đúng dạng 'Ca học'!A{n}:F{n} (1 dòng, cột A tới F). Mọi thứ khác (G trở đi, nhiều dòng,
// cả cột "A:F", tab khác, R1C1...) đều bị từ chối.
export function assertWriteRange(a1) {
  const prefix = `'${SHEET_CA_HOC}'!`;
  if (typeof a1 !== 'string' || !a1.startsWith(prefix)) throw err('RANGE', `Range ghi phải thuộc tab "${SHEET_CA_HOC}": ${a1}`);
  const m = /^A(\d+):F(\d+)$/.exec(a1.slice(prefix.length));
  if (!m) throw err('RANGE', `Range ghi chỉ được là A{n}:F{n} (không chạm cột G trở đi): ${a1}`);
  const [r1, r2] = [Number(m[1]), Number(m[2])];
  if (r1 !== r2) throw err('RANGE', `Range ghi chỉ được 1 dòng: ${a1}`);
  if (r1 < FIRST_DATA_ROW || r1 > LAST_FORMULA_ROW) throw err('RANGE', `Dòng ${r1} ngoài khoảng ${FIRST_DATA_ROW}..${LAST_FORMULA_ROW}: ${a1}`);
  return true;
}

// ---------------------------------------------------------------------------------------------
// B4. Dữ liệu form -> 1 dòng 6 ô A:F, ghi kiểu RAW.
//   A ngày = serial số nguyên; B, C giờ = phần thập phân của ngày, làm tròn tới phút; trống -> "".
//   D chủ đề, E hoạt động (chuỗi; trống -> ""), F ghi chú = composeNote(nhãn [OFFSET], chữ).
// ---------------------------------------------------------------------------------------------
const roundMin = f => minutesOf(f) / 1440;
export function serializeRow(input) {
  const { date, start, end, topic, activity, noteText, isOffset } = input;
  if (!Number.isInteger(date)) throw err('DATA', 'Ngày phải là số nguyên (serial)');
  return [
    date,
    typeof start === 'number' ? roundMin(start) : '',
    typeof end === 'number' ? roundMin(end) : '',
    topic ?? '',
    activity ?? '',
    composeNote(!!isOffset, noteText ?? ''),
  ];
}

// Sau khi ghi: đọc lại dòng 2 lần (UNFORMATTED = giá trị thô, FORMATTED = chữ Sheet hiển thị) và đối chiếu.
//   - Lệch giá trị thô -> LỖI (dữ liệu sai).
//   - Lệch chữ hiển thị -> CẢNH BÁO (ví dụ ô định dạng mm/dd thay vì dd/mm): số vẫn đúng nhưng Oriana nhìn Sheet sẽ thấy khác.
export function verifyReadback(sent, rawRow, formattedRow) {
  const errors = [], warnings = [];
  const diff = snapshotCompare(sent, rawRow);
  for (const d of diff.diffs) errors.push(`Cột ${d.col}: đã gửi ${JSON.stringify(d.before)}, Sheet lưu ${JSON.stringify(d.after)}`);
  const expect = [fmtDate(sent[0]), sent[1] === '' ? '' : fmtTime(sent[1]), sent[2] === '' ? '' : fmtTime(sent[2])];
  ['A', 'B', 'C'].forEach((c, i) => {
    const shown = String(formattedRow?.[i] ?? '').trim();
    // Sheet có thể hiện giờ "8:40" thay vì "08:40": so sau khi bỏ số 0 đầu
    const norm = s => s.replace(/^0(\d:)/, '$1');
    if (norm(shown) !== norm(expect[i])) warnings.push(`Cột ${c}: Sheet hiển thị "${shown}", app hiển thị "${expect[i]}" (giá trị thô vẫn đúng; có thể do định dạng ô).`);
  });
  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------------------------
// B5. So sánh A:F của một dòng (ảnh chụp lúc mở form vs. đọc lại ngay trước khi ghi).
//   "" / null / undefined / ô thiếu = trống. Số so tới 1e-7 ngày (~0,01 giây). Chuỗi so nguyên văn.
// ---------------------------------------------------------------------------------------------
const COLS = ['A', 'B', 'C', 'D', 'E', 'F'];
const empty = v => v === '' || v === null || v === undefined;
function sameCell(a, b) {
  if (empty(a) && empty(b)) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-7;
  return a === b;
}
export function snapshotCompare(before, after) {
  const diffs = [];
  for (let i = 0; i < 6; i++) {
    const a = before?.[i], b = after?.[i];
    if (!sameCell(a, b)) diffs.push({ col: COLS[i], before: empty(a) ? '' : a, after: empty(b) ? '' : b });
  }
  return { same: diffs.length === 0, diffs };
}
export const isEmptyRow = row => !row || row.slice(0, 6).every(empty);

// ---------------------------------------------------------------------------------------------
// B6. Tìm dòng trống đầu tiên trong 2..1002 từ dữ liệu A2:F1002 (mảng, phần tử 0 = dòng 2).
//   Dòng trống = cả 6 ô A:F trống (dòng chỉ còn ghi chú ở F KHÔNG trống -> không ghi đè).
//   Google cắt các dòng trống ở cuối, nên mảng có thể ngắn hơn 1001 dòng.
// Trả về { row, emptyLeft, warning } hoặc ném lỗi FULL (không tự nâng giới hạn 1002).
// ---------------------------------------------------------------------------------------------
export function findFirstEmptyRow(rowsFrom2, last = LAST_FORMULA_ROW) {
  const total = last - FIRST_DATA_ROW + 1;
  let first = -1, emptyLeft = 0;
  for (let i = 0; i < total; i++) {
    if (isEmptyRow(rowsFrom2[i])) { emptyLeft++; if (first === -1) first = i; }
  }
  if (first === -1) throw err('FULL', `Đã hết dòng trống (dòng ${FIRST_DATA_ROW}–${last} đều có dữ liệu). Công thức cột G–K chỉ tới dòng ${last}; app KHÔNG tự nới giới hạn. Cần kéo công thức xuống thêm trong Sheet trước.`);
  const warning = emptyLeft <= LOW_ROWS_WARNING
    ? `Chỉ còn ${emptyLeft} dòng trống có công thức (tới dòng ${last}). Sắp phải kéo công thức xuống thêm trong Sheet.`
    : null;
  return { row: first + FIRST_DATA_ROW, emptyLeft, warning };
}
