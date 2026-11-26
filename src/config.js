// config.js — Cấu hình dùng chung. Mọi giá trị ở đây đều CÔNG KHAI được (repo public):
// Spreadsheet ID và OAuth Client ID không phải bí mật. KHÔNG BAO GIỜ đặt client secret, API key hay token vào đây.

// Sheet thật — chỉ dùng để nhận diện và CHẶN ghi nhầm trong giai đoạn thử.
export const REAL_SPREADSHEET_ID = '1WXuns_F3bjQf7A6ZnG8PsryLsf6AAmDw3IQ3U8Bbf4o';

// Bản sao thử nghiệm (L2–L4 Phần C). Giữ lại để thử sau này: muốn thử, đổi SPREADSHEET_ID về TEST_SPREADSHEET_ID.
export const TEST_SPREADSHEET_ID = '1zriocN3E8uU2DZz5WijM5VEfWxGij59ZBwo8PX4C4Yo';

// Sheet mà app ĐỌC và GHI. Từ L4 Phần D (25/11/2026, Oriana gõ "OK GHI THẬT" sau khi đặt tên phiên bản Sheet thật): Sheet thật.
export const SPREADSHEET_ID = REAL_SPREADSHEET_ID;

// Khóa an toàn: khi false, code ghi sẽ từ chối nếu SPREADSHEET_ID trùng Sheet thật.
// Bật true ở L4 Phần D theo câu "OK GHI THẬT" của Oriana (25/11/2026).
export const ALLOW_WRITE_TO_REAL_SHEET = true;

// OAuth Client ID (loại "Web application") lấy ở Google Cloud Console. Công khai được, không có secret.
export const OAUTH_CLIENT_ID = '43851592632-pdk237396uq8v7a9tmrf5v90sfl1p9re.apps.googleusercontent.com';

// Quyền xin Google: đọc/ghi Google Sheets.
export const OAUTH_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// Tên tab và giới hạn dòng: cột G–K (tự tính) có công thức sẵn tới dòng 1002, nên chỉ ghi trong 2..1002.
export const SHEET_CA_HOC = 'Ca học';
export const SHEET_TONG_HOP = 'Tổng hợp tuần';
export const LAST_FORMULA_ROW = 1002;
