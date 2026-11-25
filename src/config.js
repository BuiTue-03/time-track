// config.js — Cấu hình dùng chung. Mọi giá trị ở đây đều CÔNG KHAI được (repo public):
// Spreadsheet ID và OAuth Client ID không phải bí mật. KHÔNG BAO GIỜ đặt client secret, API key hay token vào đây.

// Sheet thật — chỉ dùng để nhận diện và CHẶN ghi nhầm trong giai đoạn thử.
export const REAL_SPREADSHEET_ID = '1WXuns_F3bjQf7A6ZnG8PsryLsf6AAmDw3IQ3U8Bbf4o';

// Sheet mà app sẽ GHI vào. Giai đoạn L2: bản thử nghiệm. Cuối L2 đổi dòng này sang REAL_SPREADSHEET_ID.
export const SPREADSHEET_ID = '1zriocN3E8uU2DZz5WijM5VEfWxGij59ZBwo8PX4C4Yo';

// Khóa an toàn: khi còn false, code ghi sẽ từ chối nếu SPREADSHEET_ID trùng Sheet thật.
// Chỉ bật true khi Oriana quyết định chuyển sang Sheet thật.
export const ALLOW_WRITE_TO_REAL_SHEET = false;

// OAuth Client ID (loại "Web application") lấy ở Google Cloud Console. Công khai được, không có secret.
export const OAUTH_CLIENT_ID = '';

// Quyền xin Google: đọc/ghi Google Sheets.
export const OAUTH_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// Tên tab và giới hạn dòng: cột G–K (tự tính) có công thức sẵn tới dòng 1002, nên chỉ ghi trong 2..1002.
export const SHEET_CA_HOC = 'Ca học';
export const SHEET_TONG_HOP = 'Tổng hợp tuần';
export const LAST_FORMULA_ROW = 1002;
