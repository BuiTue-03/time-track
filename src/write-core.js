// write-core.js — Phần "thuần" của việc ghi Sheet (L4): dựng range, đổi dữ liệu form thành 1 dòng A:F,
// so sánh ảnh chụp dòng, tìm dòng trống. Không gọi mạng -> test được bằng node --test.
// sheets-write.js (phần gọi Google) BẮT BUỘC đi qua các hàm ở đây.
import { LAST_FORMULA_ROW, SHEET_CA_HOC, SHEET_TICH_LUY, ACCRUAL_LAST_ROW } from './config.js';
import { composeNote, fmtTime, minutesOf } from './rules.js';
import { fmtDate } from './core.js';
import { ACCRUAL_TAG_RE } from './rest.js';

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
//   "" / null / undefined / ô thiếu = trống. Số so tới 5e-6 ngày (~0,4 giây: gviz làm tròn giờ tới giây,
//   còn app chỉ làm việc với phút). Chuỗi so nguyên văn.
// ---------------------------------------------------------------------------------------------
const COLS = ['A', 'B', 'C', 'D', 'E', 'F'];
const empty = v => v === '' || v === null || v === undefined;
function sameCell(a, b) {
  if (empty(a) && empty(b)) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 5e-6;
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

// ---------------------------------------------------------------------------------------------
// B7 (L4.5, Oriana duyệt 26/11/2026). Đặt định dạng hiển thị cho A–C của ĐÚNG dòng vừa ghi.
//   Lý do: app ghi RAW (số serial). Nếu ô chưa có định dạng ngày/giờ, Sheet hiện số thô (0,479166…) và gviz
//   bỏ ô đó -> app tưởng ca chưa đóng (sự cố dòng 168, 26/11/2026). Chỉ đổi ĐỊNH DẠNG, không đổi giá trị.
//   Chỉ cột A (dd/MM/yyyy) và B–C (hh:mm), chỉ 1 dòng, cùng giới hạn 2..1002 như ghi giá trị.
// ---------------------------------------------------------------------------------------------
export const ROW_FORMATS = [
  { col: 0, numberFormat: { type: 'DATE', pattern: 'dd/MM/yyyy' } },
  { col: 1, numberFormat: { type: 'TIME', pattern: 'hh:mm' } },
  { col: 2, numberFormat: { type: 'TIME', pattern: 'hh:mm' } },
];
export function buildFormatRequests(sheetId, rowIndex) {
  buildWriteRange(rowIndex); // cùng kiểm tra số dòng (2..1002) như khi ghi giá trị
  if (!Number.isInteger(sheetId) || sheetId < 0) throw err('RANGE', `sheetId không hợp lệ: ${JSON.stringify(sheetId)}`);
  return ROW_FORMATS.map(({ col, numberFormat }) => ({
    repeatCell: {
      range: { sheetId, startRowIndex: rowIndex - 1, endRowIndex: rowIndex, startColumnIndex: col, endColumnIndex: col + 1 },
      cell: { userEnteredFormat: { numberFormat } },
      fields: 'userEnteredFormat.numberFormat', // chỉ định dạng số; giữ nguyên màu, viền, data validation, giá trị
    },
  }));
}

// ---------------------------------------------------------------------------------------------
// L6 (Oriana duyệt Phần A, quyết định o/f, 26/11/2026). Ghi tab "Tích lũy": CHỈ cột A:B (ngày quy đổi, số ngày) và D (ghi chú)
// của 1 dòng trong 2..60. Cột C ("Số tiền") là công thức = B × 'Cài đặt'!C6 có sẵn tới dòng 60 -> KHÔNG BAO GIỜ ghi C.
// App không sửa, không xóa dòng Tích lũy (sửa tay trong Sheet).
// ---------------------------------------------------------------------------------------------
export const ACCRUAL_FIRST_ROW = 2;
const ACC_PREFIX = `'${SHEET_TICH_LUY}'!`;
function checkAccrualRow(n) {
  if (!Number.isInteger(n)) throw err('RANGE', `Số dòng Tích lũy không hợp lệ: ${JSON.stringify(n)}`);
  if (n < ACCRUAL_FIRST_ROW || n > ACCRUAL_LAST_ROW)
    throw err('RANGE', `Dòng ${n} ngoài khoảng ${ACCRUAL_FIRST_ROW}..${ACCRUAL_LAST_ROW} của tab Tích lũy (công thức cột C chỉ tới dòng ${ACCRUAL_LAST_ROW}). Không ghi.`);
}
// HÀM DUY NHẤT dựng range ghi Tích lũy
export function buildAccrualRanges(n) {
  checkAccrualRow(n);
  const r = { ab: `${ACC_PREFIX}A${n}:B${n}`, d: `${ACC_PREFIX}D${n}:D${n}` };
  assertAccrualRange(r.ab); assertAccrualRange(r.d);
  return r;
}
// Chốt chặn: chỉ nhận đúng 'Tích lũy'!A{n}:B{n} hoặc 'Tích lũy'!D{n}:D{n}, n trong 2..60
export function assertAccrualRange(a1) {
  if (typeof a1 !== 'string' || !a1.startsWith(ACC_PREFIX)) throw err('RANGE', `Range ghi phải thuộc tab "${SHEET_TICH_LUY}": ${a1}`);
  const m = /^(?:A(\d+):B(\d+)|D(\d+):D(\d+))$/.exec(a1.slice(ACC_PREFIX.length));
  if (!m) throw err('RANGE', `Range ghi Tích lũy chỉ được là A{n}:B{n} hoặc D{n}:D{n} (không chạm cột C): ${a1}`);
  const [r1, r2] = m[1] ? [Number(m[1]), Number(m[2])] : [Number(m[3]), Number(m[4])];
  if (r1 !== r2) throw err('RANGE', `Range ghi Tích lũy chỉ được 1 dòng: ${a1}`);
  checkAccrualRow(r1);
  return true;
}
// Dữ liệu quy đổi -> giá trị gửi (RAW). Ghi chú bắt buộc có nhãn tháng "[T11/2026 · mã]" (để chống ghi trùng và biết tháng).
export function serializeAccrual({ date, days, note }) {
  if (!Number.isInteger(date)) throw err('DATA', 'Ngày quy đổi phải là số nguyên (serial)');
  if (!Number.isInteger(days) || days <= 0) throw err('DATA', 'Số ngày quy đổi phải là số nguyên dương');
  if (typeof note !== 'string' || !ACCRUAL_TAG_RE.test(note)) throw err('DATA', 'Ghi chú phải bắt đầu bằng nhãn tháng [T{tháng}/{năm} · mã]');
  return { ab: [date, days], d: [note] };
}
// Dòng trống đầu tiên của Tích lũy từ dữ liệu A2:D60 (phần tử 0 = dòng 2). Trống = A, B, D đều trống (cột C bỏ qua).
export function findFirstEmptyAccrualRow(rowsFrom2, last = ACCRUAL_LAST_ROW) {
  const total = last - ACCRUAL_FIRST_ROW + 1;
  let first = -1, emptyLeft = 0;
  for (let i = 0; i < total; i++) {
    const r = rowsFrom2[i];
    if (!r || [r[0], r[1], r[3]].every(empty)) { emptyLeft++; if (first === -1) first = i; }
  }
  if (first === -1) throw err('FULL', `Tab Tích lũy đã hết dòng có công thức (dòng ${ACCRUAL_FIRST_ROW}–${last} đều có dữ liệu). App KHÔNG tự nới giới hạn. Cần kéo công thức cột C xuống thêm trong Sheet trước.`);
  const warning = emptyLeft <= 5 ? `Tab Tích lũy chỉ còn ${emptyLeft} dòng trống có công thức (tới dòng ${last}). Sắp phải kéo công thức cột C xuống thêm.` : null;
  return { row: first + ACCRUAL_FIRST_ROW, emptyLeft, warning };
}
// Đọc lại sau khi ghi: A, B, D lệch -> LỖI; cột C chưa bằng B × tiền/ngày -> CẢNH BÁO (công thức chưa tính / bị sửa);
// cột A không hiện dd/mm/yyyy -> CẢNH BÁO.
export function verifyAccrualReadback(sent, rawRow, formattedA, money) {
  const errors = [], warnings = [];
  const want = [sent.ab[0], sent.ab[1], null, sent.d[0]];
  [0, 1, 3].forEach(i => {
    const a = want[i], b = rawRow?.[i];
    const same = typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 5e-6 : a === b;
    if (!same) errors.push(`Cột ${'ABCD'[i]}: đã gửi ${JSON.stringify(a)}, Sheet lưu ${JSON.stringify(empty(b) ? '' : b)}`);
  });
  const c = rawRow?.[2], cComputed = typeof c === 'number' && Math.abs(c - sent.ab[1] * money) < 0.5;
  if (!cComputed) warnings.push(`Cột C (Số tiền) đọc được ${JSON.stringify(empty(c) ? '' : c)}, chưa bằng ${sent.ab[1]} × ${money}. Hãy mở Sheet xem công thức cột C của dòng này.`);
  const shown = String(formattedA ?? '').trim();
  if (shown !== fmtDate(sent.ab[0])) warnings.push(`Cột A: Sheet hiển thị "${shown}", app mong "${fmtDate(sent.ab[0])}" (giá trị vẫn đúng; có thể do định dạng ô).`);
  return { ok: errors.length === 0, errors, warnings, cComputed };
}
// Định dạng ngày dd/MM/yyyy cho cột A của đúng 1 dòng Tích lũy (bài học dòng 168 ở L4.5)
export function buildAccrualFormatRequests(sheetId, n) {
  checkAccrualRow(n);
  if (!Number.isInteger(sheetId) || sheetId < 0) throw err('RANGE', `sheetId không hợp lệ: ${JSON.stringify(sheetId)}`);
  return [{ repeatCell: {
    range: { sheetId, startRowIndex: n - 1, endRowIndex: n, startColumnIndex: 0, endColumnIndex: 1 },
    cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/MM/yyyy' } } },
    fields: 'userEnteredFormat.numberFormat',
  } }];
}
