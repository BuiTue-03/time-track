// gviz.js — Đọc Google Sheet công khai (chỉ xem) qua Visualization API ("gviz"), cách L1 đã chọn.
// Không cần API key, không OAuth, không ghi gì. Dùng chung cho app (trình duyệt) và tools/make-fixture.mjs (Node).

export const SPREADSHEET_ID = '1WXuns_F3bjQf7A6ZnG8PsryLsf6AAmDw3IQ3U8Bbf4o'; // Sheet THẬT, chỉ đọc
export const TAB_SESSIONS = 'Ca học';
export const TAB_TOPICS = 'Chủ đề';
export const TAB_SETTINGS = 'Cài đặt';   // L6: chỉ đọc
export const TAB_ACCRUAL = 'Tích lũy';   // L6: đọc; ghi qua sheets-write.js

// headers=1: ép gviz coi đúng 1 dòng đầu là tiêu đề (nếu để gviz tự đoán, nó có thể nuốt thêm dòng dữ liệu).
// headers = số dòng tiêu đề (mặc định 1; đọc 1 ô lẻ thì 0).
export function gvizUrl(sheet, range, id = SPREADSHEET_ID, headers = 1) {
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json&headers=${headers}` +
    `&sheet=${encodeURIComponent(sheet)}&range=${encodeURIComponent(range)}`;
}

// gviz trả về đoạn JS "google.visualization.Query.setResponse({...});" -> cắt lấy phần JSON.
// Kết quả: mảng 2 chiều, dòng 0 = tiêu đề, các dòng sau = ô gviz {v, f} (core.rawCell(..., 'gviz') đọc giá trị thô v).
export function parseGvizText(text) {
  const i = text.indexOf('{'), j = text.lastIndexOf('}');
  if (i < 0 || j < 0) throw new Error('Phản hồi gviz không có JSON (Sheet có còn chia sẻ công khai không?)');
  const resp = JSON.parse(text.slice(i, j + 1));
  if (resp.status !== 'ok') throw new Error('gviz báo lỗi: ' + (resp.errors ?? []).map(e => e.detailed_message || e.message).join('; '));
  return [resp.table.cols.map(c => ({ v: c.label })), ...resp.table.rows.map(r => (r.c ?? []).map(c => c ?? null))];
}
