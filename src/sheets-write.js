// sheets-write.js — Đăng nhập Google (token model) và đọc/ghi tab "Ca học" bằng Sheets API v4.
// Token chỉ nằm trong biến bộ nhớ `token` bên dưới: tải lại trang là mất, không lưu localStorage, không gửi đi đâu ngoài Google.
import {
  SPREADSHEET_ID, REAL_SPREADSHEET_ID, ALLOW_WRITE_TO_REAL_SHEET,
  OAUTH_CLIENT_ID, OAUTH_SCOPE, SHEET_CA_HOC, LAST_FORMULA_ROW,
} from './config.js';

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

async function api(method, path, body) {
  if (!token) throw err('NO_TOKEN', 'Chưa đăng nhập (hoặc token đã bị xóa)');
  let r;
  try {
    r = await fetch(`${API}/${SPREADSHEET_ID}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // fetch chỉ "throw" khi không tới được máy chủ: mất mạng, DNS, CORS...
    throw err(navigator.onLine ? 'NETWORK' : 'OFFLINE', `Không kết nối được Google (${e.message})`);
  }
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
const rng = a1 => encodeURIComponent(`'${SHEET_CA_HOC}'!${a1}`);

// ---------- 3. Đọc ----------
// UNFORMATTED_VALUE + SERIAL_NUMBER: ngày/giờ trả về dạng số serial, không phụ thuộc cách hiển thị (dd/mm hay mm/dd).
export async function readRange(a1, sheet = SHEET_CA_HOC, render = 'UNFORMATTED_VALUE') {
  const j = await api('GET', `/values/${encodeURIComponent(`'${sheet}'!${a1}`)}?valueRenderOption=${render}&dateTimeRenderOption=SERIAL_NUMBER`);
  return j.values ?? [];
}

// Tìm dòng trống đầu tiên của A:F (cả 6 ô đều trống), trong khoảng 2..1002.
// API cắt bỏ các dòng trống ở CUỐI, nên nếu không thấy lỗ trống ở giữa thì dòng trống = số dòng đã trả + 2.
export async function findFirstEmptyRow() {
  const rows = await readRange(`A2:F${LAST_FORMULA_ROW}`);
  let idx = rows.findIndex(r => !r || r.every(v => v === '' || v === null || v === undefined));
  if (idx === -1) idx = rows.length;
  const rowNumber = idx + 2;
  if (rowNumber > LAST_FORMULA_ROW) throw err('FULL', `Hết dòng có công thức (đã tới ${LAST_FORMULA_ROW})`);
  return rowNumber;
}

// ---------- 4. Ghi / sửa / xóa ----------
// valueInputOption=RAW: Google lưu ĐÚNG giá trị gửi lên, không "đoán" kiểu.
//   - Ngày/giờ gửi dạng số serial (46351 = 25/11/2026; 0.958333 = 23:00) -> lưu là SỐ, định dạng dd/MM/yyyy, hh:mm sẵn có của ô sẽ hiển thị đúng.
//   - Chữ (chủ đề, ghi chú) lưu nguyên văn; ghi chú bắt đầu bằng "=" cũng không thành công thức.
// Không dùng USER_ENTERED vì khi đó Google phân tích chuỗi theo locale của file (vi_VN), dễ lẫn dd/mm và mm/dd.
export async function writeRow(rowNumber, values, { mustBeEmpty = true } = {}) {
  assertWritable();
  if (rowNumber < 2 || rowNumber > LAST_FORMULA_ROW) throw err('RANGE', `Dòng ${rowNumber} ngoài khoảng 2..${LAST_FORMULA_ROW}`);
  if (mustBeEmpty) {
    // Kiểm tra lại ngay trước khi ghi, phòng trường hợp dòng vừa được điền ở nơi khác
    const cur = (await readRange(`A${rowNumber}:F${rowNumber}`))[0] ?? [];
    if (cur.some(v => v !== '' && v != null)) throw err('NOT_EMPTY', `Dòng ${rowNumber} không còn trống, không ghi đè`);
  }
  return api('PUT', `/values/${rng(`A${rowNumber}:F${rowNumber}`)}?valueInputOption=RAW`, { values: [values] });
}

// "Xóa" = xóa NỘI DUNG A:F của dòng (values:clear). Không xóa hàng, nên công thức G–K, định dạng và
// data validation của ô vẫn giữ nguyên.
export async function clearRow(rowNumber) {
  assertWritable();
  if (rowNumber < 2 || rowNumber > LAST_FORMULA_ROW) throw err('RANGE', `Dòng ${rowNumber} ngoài khoảng 2..${LAST_FORMULA_ROW}`);
  return api('POST', `/values/${rng(`A${rowNumber}:F${rowNumber}`)}:clear`, {});
}
