// ui-config.js — Cấu hình HIỂN THỊ (L4.5). Đổi tên, mục tiêu hiển thị, màu nhóm ở đúng 1 chỗ này.
// Không có gì bí mật ở đây. Không ảnh hưởng cách tính số liệu (core.js / insights.js).

export const UI = {
  name: 'Oriana',        // tên gọi trong lời chào và lời khen
  goalDayMin: 240,       // mục tiêu mỗi ngày: 4 giờ (vòng tiến độ ở trang Hôm nay)
  goalWeekMin: 1440,     // mục tiêu mỗi tuần: 24 giờ (vạch trên thẻ "Nhịp độ cuối tuần")
  goalWeekDays: 6,       // 6 ngày học / tuần (chỉ để hiển thị ở Cài đặt)
};

// Nhóm học -> màu + kaomoji. Thêm nhóm mới: thêm 1 dòng, chọn màu từ kho dự phòng --a3/--a4/--a5 (đã đo tương phản).
// Nhóm chưa có dòng ở đây -> màu xám + tên nhóm.
export const CATEGORY_STYLE = {
  'Ngoại ngữ':     { cls: 'c-nn', color: 'var(--pink-l)', kao: '(＾▽＾)' },
  'Chuyên môn BA': { cls: 'c-ba', color: 'var(--pink-d)', kao: '(•ω•)' },
  'Không học':     { cls: 'c-kh', color: 'var(--grey-cat)', kao: '(˘ω˘)' },
};
export const catStyle = c => CATEGORY_STYLE[c] ?? { cls: 'c-kh', color: 'var(--grey-cat)', kao: '' };

// Câu khích lệ ở trang Hôm nay. Danh sách câu + đổi câu theo ngày là việc của L5 (chưa làm);
// hiện chỉ có 1 câu cố định (đã duyệt ở bản mẫu). Mỗi phần trong `jp` xuống dòng nguyên cụm.
export const QUOTE = {
  jp: ['今日の一歩は、', '明日の自分への', '贈り物。'],
  vi: 'Bước đi hôm nay là món quà cho chính mình ngày mai.',
  src: 'Câu do Claude viết',
};
