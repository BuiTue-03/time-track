// sheets-write.js — Đăng nhập Google (token model) và đọc/ghi tab "Ca học" bằng Sheets API v4.
// Token chỉ nằm trong biến bộ nhớ `token` bên dưới: tải lại trang là mất, không lưu localStorage, không gửi đi đâu ngoài Google.
import {
  SPREADSHEET_ID, REAL_SPREADSHEET_ID, ALLOW_WRITE_TO_REAL_SHEET,
  OAUTH_CLIENT_ID, OAUTH_SCOPE, SHEET_CA_HOC, LAST_FORMULA_ROW, SHEET_TICH_LUY, ACCRUAL_LAST_ROW,
} from './config.js';
import {
  buildWriteRange, assertWriteRange, findFirstEmptyRow as pickEmptyRow, buildFormatRequests,
  buildAccrualRanges, assertAccrualRange, buildAccrualFormatRequests,
} from './write-core.js';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
let token = null;        // { access_token, expiresAt } — chỉ trong bộ nhớ
let tokenClient = null;  // đối tượng của Google Identity Services

// ---------- 1. Đăng nhập ----------
// Google Identity Services (GIS) mở cửa sổ đăng nhập/đồng ý của Google, rồi trả access token qua callback.
// Bọc lại thành Promise để code phía sau viết tuần tự được (await signIn()).
export function signIn() {
  if (!OAUTH_CLIENT_ID) return Promise.reject(err('CONFIG', 'Chưa điền OAUTH_CLIENT_ID trong src/config.js'));
  if (!window.google?.accounts?.oauth2) return Promise.reject(err('GIS', 'Thư viện đăng nhập Google chưa tải xong (hoặc bị chặn)'));
  return new Promise((resolve, reject) => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: OAUTH_CLIENT_ID,
      scope: OAUTH_SCOPE,
      // Thành công, hoặc Google trả lỗi như access_denied (bấm "Hủy"/không cho quyền)
      callback: resp => {
        if (resp.error) return reject(err('AUTH_' + resp.error, `Google trả lỗi đăng nhập: ${resp.error} ${resp.error_description ?? ''}`));
        if (!google.accounts.oauth2.hasGrantedAllScopes(resp, OAUTH_SCOPE))
          return reject(err('AUTH_SCOPE', 'Bạn chưa tick quyền "xem, sửa… bảng tính Google Sheets"'));
        token = { access_token: resp.access_token, expiresAt: Date.now() + resp.expires_in * 1000 };
        resolve({ expiresInSec: Number(resp.expires_in) });
      },
      // Lỗi phía cửa sổ: đóng cửa sổ (popup_closed), trình duyệt chặn popup (popup_failed_to_open)...
      error_callback: e => reject(err('POPUP_' + e.type, `Cửa sổ đăng nhập: ${e.type} ${e.message ?? ''}`)),
    });
    tokenClient.requestAccessToken();
  });
}
export const tokenInfo = () => token && { expiresAt: token.expiresAt, secondsLeft: Math.round((token.expiresAt - Date.now()) / 1000) };
// Thu hồi token ở phía Google: dùng để thử tình huống "token hết hạn/không còn hiệu lực"
export function revokeToken() {
  return new Promise(res => token ? google.accounts.oauth2.revoke(token.access_token, () => res()) : res());
}
export const forgetToken = () => { token = null; };

// ---------- 2. Gọi Sheets API, phân loại lỗi ----------
// Mọi lỗi được gắn "code" để trang thử in ra cách xử lý tương ứng.
function err(code, message, extra) { return Object.assign(new Error(message), { code, ...extra }); }

export const API_TIMEOUT_MS = 8000; // quá 8 giây không có trả lời -> lỗi TIMEOUT (KHÔNG tự thử lại)
// Token còn dùng được không (chừa 60 giây phòng hết hạn giữa chừng). Token GIS sống khoảng 1 giờ.
export const hasValidToken = () => !!token && Date.now() < token.expiresAt - 60_000;

async function api(method, path, body) {
  if (!token) throw err('NO_TOKEN', 'Chưa đăng nhập Google (hoặc đã đăng xuất)');
  if (!hasValidToken()) { token = null; throw err('TOKEN_EXPIRED', 'Phiên đăng nhập Google đã hết hạn'); }
  let r, timer;
  try {
    // Hết giờ chờ: KHÔNG hủy yêu cầu (hủy phía trình duyệt cũng không chắc chặn được việc Google đã ghi),
    // chỉ báo TIMEOUT để giao diện hỏi lại Sheet xem đã ghi hay chưa.
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(err('TIMEOUT', `Quá ${API_TIMEOUT_MS / 1000} giây chưa có trả lời từ Google`)), API_TIMEOUT_MS); });
    r = await Promise.race([fetch(`${API}/${SPREADSHEET_ID}${path}`, {
      method, cache: 'no-store',
      headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }), timeout]);
  } catch (e) {
    if (e.code === 'TIMEOUT') throw e;
    // fetch chỉ "throw" khi không tới được máy chủ: mất mạng, DNS, CORS...
    throw err(navigator.onLine ? 'NETWORK' : 'OFFLINE', `Không kết nối được Google (${e.message})`);
  } finally { clearTimeout(timer); }
  const j = await r.json().catch(() => ({}));
  if (r.ok) return j;
  const msg = j.error?.message ?? r.statusText;
  if (r.status === 401) { token = null; throw err('HTTP_401', `Token hết hạn/không hợp lệ: ${msg}`, { status: 401 }); }
  throw err('HTTP_' + r.status, msg, { status: r.status });
}

// Chặn ghi vào Sheet thật khi khóa an toàn còn bật
function assertWritable() {
  if (SPREADSHEET_ID === REAL_SPREADSHEET_ID && !ALLOW_WRITE_TO_REAL_SHEET)
    throw err('GUARD', 'Đang trỏ vào Sheet THẬT mà ALLOW_WRITE_TO_REAL_SHEET = false. Đã chặn ghi.');
}

// ---------- 3. Đọc ----------
// UNFORMATTED_VALUE + SERIAL_NUMBER: ngày/giờ trả về dạng số serial, không phụ thuộc cách hiển thị (dd/mm hay mm/dd).
export async function readRange(a1, sheet = SHEET_CA_HOC, render = 'UNFORMATTED_VALUE') {
  const j = await api('GET', `/values/${encodeURIComponent(`'${sheet}'!${a1}`)}?valueRenderOption=${render}&dateTimeRenderOption=SERIAL_NUMBER`);
  return j.values ?? [];
}

// Tìm dòng trống đầu tiên của A:F (cả 6 ô đều trống), trong khoảng 2..1002. Logic nằm ở write-core.js
// (test được); ở đây chỉ đọc dữ liệu. Trả về { row, emptyLeft, warning }; hết dòng -> lỗi FULL.
export async function findFirstEmptyRow() {
  return pickEmptyRow(await readRange(`A2:F${LAST_FORMULA_ROW}`));
}

// Đọc 1 dòng A:F hai kiểu: raw = giá trị thô (số serial, chuỗi), formatted = chữ Sheet hiển thị.
export async function readRowAF(rowNumber) {
  const a1 = buildWriteRange(rowNumber).split('!')[1]; // cùng hàm kiểm tra số dòng
  const [raw, formatted] = await Promise.all([readRange(a1), readRange(a1, SHEET_CA_HOC, 'FORMATTED_VALUE')]);
  return { raw: raw[0] ?? [], formatted: formatted[0] ?? [] };
}
// Tiêu đề A1:F1 (để chắc Sheet chưa bị đổi cấu trúc trước khi ghi)
export async function readHeaders() { return (await readRange('A1:F1'))[0] ?? []; }

// ---------- 4. Ghi / sửa / xóa ----------
// valueInputOption=RAW: Google lưu ĐÚNG giá trị gửi lên, không "đoán" kiểu.
//   - Ngày/giờ gửi dạng số serial (46351 = 25/11/2026; 0.958333 = 23:00) -> lưu là SỐ, định dạng dd/MM/yyyy, hh:mm sẵn có của ô sẽ hiển thị đúng.
//   - Chữ (chủ đề, ghi chú) lưu nguyên văn; ghi chú bắt đầu bằng "=" cũng không thành công thức.
// Không dùng USER_ENTERED vì khi đó Google phân tích chuỗi theo locale của file (vi_VN), dễ lẫn dd/mm và mm/dd.
export async function writeRow(rowNumber, values, { mustBeEmpty = true } = {}) {
  assertWritable();
  const a1 = buildWriteRange(rowNumber); // hàm DUY NHẤT dựng range ghi: chỉ A:F, dòng 2..1002
  if (mustBeEmpty) {
    // Kiểm tra lại ngay trước khi ghi, phòng trường hợp dòng vừa được điền ở nơi khác
    const cur = (await readRange(`A${rowNumber}:F${rowNumber}`))[0] ?? [];
    if (cur.some(v => v !== '' && v != null)) throw err('NOT_EMPTY', `Dòng ${rowNumber} không còn trống, không ghi đè`);
  }
  if (!Array.isArray(values) || values.length !== 6) throw err('DATA', 'Một dòng phải có đúng 6 ô A–F');
  assertWriteRange(a1);
  return api('PUT', `/values/${encodeURIComponent(a1)}?valueInputOption=RAW`, { values: [values] });
}

// "Xóa" = xóa NỘI DUNG A:F của dòng (values:clear). Không xóa hàng, nên công thức G–K, định dạng và
// data validation của ô vẫn giữ nguyên.
export async function clearRow(rowNumber) {
  assertWritable();
  const a1 = buildWriteRange(rowNumber);
  assertWriteRange(a1);
  return api('POST', `/values/${encodeURIComponent(a1)}:clear`, {});
}

// L4.5: đặt định dạng ngày/giờ cho A–C của 1 dòng (xem write-core B7). sheetId của tab "Ca học" đọc từ Google
// (không ghi cứng: bản sao và Sheet thật có sheetId khác nhau), nhớ trong bộ nhớ trang.
// L6: dùng chung cho tab "Tích lũy" (nhớ sheetId theo tên tab).
const sheetIdCache = {};
async function sheetIdOf(title) {
  if (sheetIdCache[title] !== undefined) return sheetIdCache[title];
  const j = await api('GET', `?fields=${encodeURIComponent('sheets.properties(sheetId,title)')}`);
  const s = (j.sheets ?? []).find(x => x.properties?.title === title);
  if (!s) throw err('RANGE', `Không thấy tab "${title}" trong Sheet`);
  return (sheetIdCache[title] = s.properties.sheetId);
}
const caHocSheetId = () => sheetIdOf(SHEET_CA_HOC);
export async function formatRow(rowNumber) {
  assertWritable();
  const requests = buildFormatRequests(await caHocSheetId(), rowNumber);
  return api('POST', ':batchUpdate', { requests });
}

// ---------- 5. L6: tab "Tích lũy" (chỉ thêm dòng; không sửa, không xóa) ----------
// Đọc A2:D60 (giá trị thô; cột C là công thức, chỉ để đối chiếu)
export async function readAccrualRows() {
  return readRange(`A2:D${ACCRUAL_LAST_ROW}`, SHEET_TICH_LUY);
}
// Đọc lại 1 dòng: A:D thô + chữ hiển thị của cột A
export async function readAccrualRow(n) {
  buildAccrualRanges(n); // cùng kiểm tra số dòng 2..60
  const [raw, fa] = await Promise.all([readRange(`A${n}:D${n}`, SHEET_TICH_LUY), readRange(`A${n}:A${n}`, SHEET_TICH_LUY, 'FORMATTED_VALUE')]);
  return { raw: raw[0] ?? [], formattedA: fa[0]?.[0] ?? '' };
}
// Ghi A:B + D của 1 dòng trong MỘT lệnh values:batchUpdate (RAW). Cột C không bao giờ nằm trong lệnh.
// Ngay trước khi ghi: đọc lại dòng, A/B/D phải còn trống (dòng vừa được dùng ở nơi khác -> NOT_EMPTY).
export async function writeAccrualRow(n, sent) {
  assertWritable();
  const r = buildAccrualRanges(n);
  const cur = (await readRange(`A${n}:D${n}`, SHEET_TICH_LUY))[0] ?? [];
  if ([cur[0], cur[1], cur[3]].some(v => v !== '' && v != null)) throw err('NOT_EMPTY', `Dòng ${n} của tab Tích lũy không còn trống, không ghi đè`);
  const data = [{ range: r.ab, values: [sent.ab] }, { range: r.d, values: [sent.d] }];
  data.forEach(x => assertAccrualRange(x.range));
  return api('POST', '/values:batchUpdate', { valueInputOption: 'RAW', data });
}
export async function formatAccrualRow(n) {
  assertWritable();
  return api('POST', ':batchUpdate', { requests: buildAccrualFormatRequests(await sheetIdOf(SHEET_TICH_LUY), n) });
}
