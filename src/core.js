// core.js — Lõi tính toán của app (không phụ thuộc thư viện, chạy được cả trên trình duyệt lẫn Node).
// Mọi ngày/giờ được giữ ở dạng "serial" của Google Sheets:
//   - ngày: số nguyên, số ngày kể từ 30/12/1899 (ví dụ 46316 = 21/10/2026)
//   - giờ: phần thập phân của 1 ngày (ví dụ 0.375 = 09:00)
// Nhờ vậy không bao giờ phải đoán "dd/mm" hay "mm/dd" từ chuỗi hiển thị.

// Mốc 0 của serial ngày trong Google Sheets: 30/12/1899
const EPOCH_MS = Date.UTC(1899, 11, 30);

export const CONFIG = {
  startDate: serialFromYMD(2026, 10, 21),   // tuần 1 bắt đầu 21/10/2026 (thứ Tư)
  baselineEnd: serialFromYMD(2026, 11, 3),  // hết Baseline 03/11/2026
};
export const ACTIVITIES = ['Lý thuyết', 'Thực hành', 'Ôn tập', 'Kiểm tra nhớ', 'Nhờ AI'];
export const BUSY_TOPIC = 'Bận đi làm, không học, có ôn tập ngắn';
export const UNCATEGORIZED = 'Chưa phân loại';

// --- Chuyển đổi ngày <-> serial (dùng UTC để không lệch múi giờ) ---
export function serialFromYMD(y, m, d) { return Math.round((Date.UTC(y, m - 1, d) - EPOCH_MS) / 86400000); }
export function ymdFromSerial(s) {
  const dt = new Date(EPOCH_MS + Math.floor(s) * 86400000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
export function fmtDate(s) {
  const { y, m, d } = ymdFromSerial(s);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

// --- Chuẩn hóa 1 ô về giá trị thô, tùy theo nguồn đọc ---
// Mỗi nguồn trả ô theo kiểu khác nhau; hàm này đưa hết về: số (serial) | chuỗi | null.
//   'grid' : Sheets API spreadsheets.get (effectiveValue) -> {numberValue} / {stringValue}
//   'values': Sheets API values.get với UNFORMATTED_VALUE + SERIAL_NUMBER -> số hoặc chuỗi
//   'gviz' : Visualization API -> {v: "Date(2026,9,21)" | số | chuỗi, f: "chuỗi hiển thị"}
export function rawCell(cell, source) {
  if (cell === undefined || cell === null || cell === '') return null;
  if (source === 'grid') {
    const ev = cell.effectiveValue;
    if (!ev) return null;
    if ('numberValue' in ev) return ev.numberValue;
    if ('stringValue' in ev) return ev.stringValue;
    if ('boolValue' in ev) return ev.boolValue;
    return null; // errorValue (#REF!...) coi như trống, sẽ bị báo lỗi ở bước kiểm tra
  }
  if (source === 'gviz') {
    const v = cell.v;
    if (v === null || v === undefined) return null;
    // gviz trả ngày/giờ dạng chuỗi "Date(năm,tháng-0-based,ngày[,giờ,phút,giây])"
    const m = typeof v === 'string' && v.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/);
    if (m) {
      const [, y, mo, d, h, mi, se] = m.map(x => Number(x ?? 0)); // phần giờ vắng mặt -> 0
      const day = Math.round((Date.UTC(y, mo, d) - EPOCH_MS) / 86400000);
      return day + (h * 3600 + mi * 60 + se) / 86400; // giờ thuần có day = 0 (30/12/1899)
    }
    return v;
  }
  return cell; // 'values': đã là giá trị thô
}

// --- Đọc bảng Chủ đề -> Map(topic -> category) ---
export function parseTopics(rows, source) {
  const map = new Map();
  for (const r of rows.slice(1)) {
    const topic = rawCell(r[0], source), cat = rawCell(r[1], source);
    if (typeof topic === 'string' && topic.trim()) map.set(topic.trim(), typeof cat === 'string' ? cat.trim() : UNCATEGORIZED);
  }
  return map;
}

// --- Đọc bảng Ca học (cột A–F) -> danh sách ca + danh sách vấn đề dữ liệu ---
// rowNumber = số dòng thật trong Sheet (dòng 1 là tiêu đề) để Oriana dễ tìm.
export function parseSessions(rows, source, topics) {
  const sessions = [], issues = [];
  rows.slice(1).forEach((r, i) => {
    const rowNumber = i + 2;
    const [date, start, end, topic, activity, note] = [0, 1, 2, 3, 4, 5].map(c => rawCell(r?.[c], source));
    if ([date, start, end, topic, activity, note].every(v => v === null)) return; // dòng trống
    const s = {
      rowNumber, date, start, end,
      topic: typeof topic === 'string' ? topic.trim() : topic,
      activity: typeof activity === 'string' ? activity.trim() : activity,
      note: note ?? '',
    };
    const problem = msg => issues.push({ rowNumber, msg });
    if (typeof date !== 'number') problem(`Ngày không phải giá trị ngày (đọc được: ${JSON.stringify(date)})`);
    else s.date = Math.floor(date);
    const hasStart = start !== null, hasEnd = end !== null;
    if (hasStart && typeof start !== 'number') problem(`Giờ bắt đầu không phải giá trị giờ: ${JSON.stringify(start)}`);
    if (hasEnd && typeof end !== 'number') problem(`Giờ kết thúc không phải giá trị giờ: ${JSON.stringify(end)}`);
    if (hasStart !== hasEnd) problem(hasStart ? 'Có giờ bắt đầu nhưng thiếu giờ kết thúc' : 'Có giờ kết thúc nhưng thiếu giờ bắt đầu');
    s.duration = durationMin(start, end);
    if (s.topic === BUSY_TOPIC) s.busy = true;
    if (!s.topic) problem('Thiếu chủ đề');
    s.category = topics.get(s.topic) ?? UNCATEGORIZED;
    if (s.topic && !topics.has(s.topic)) problem(`Chủ đề không có trong bảng Chủ đề: "${s.topic}"`);
    if (!s.busy && !ACTIVITIES.includes(s.activity)) problem(`Hoạt động không hợp lệ: ${JSON.stringify(s.activity)}`);
    if (s.duration !== null && s.duration <= 0) problem(`Thời lượng ${s.duration} phút (giờ kết thúc = giờ bắt đầu?)`);
    if (s.duration !== null && s.duration > 600) problem(`Thời lượng bất thường: ${s.duration} phút`);
    sessions.push(s);
  });
  return { sessions, issues };
}

// duration_min = ROUND((end − start + 1 ngày nếu end < start) × 1440); thiếu giờ -> null
export function durationMin(start, end) {
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  const st = start % 1, en = end % 1; // chỉ lấy phần giờ, phòng khi ô giờ có dính ngày
  return Math.round((en - st + (en < st ? 1 : 0)) * 1440);
}
export const weekNo = (d, cfg = CONFIG) => Math.floor((d - cfg.startDate) / 7) + 1;
export const phase = (d, cfg = CONFIG) => (d <= cfg.baselineEnd ? 'Baseline' : 'Sau baseline');

// --- Thống kê cho các ca có date <= toDate ---
export function computeStats(sessions, toDate, cfg = CONFIG) {
  const list = sessions.filter(s => typeof s.date === 'number' && s.date <= toDate);
  const add = (obj, k, v) => { obj[k] = (obj[k] ?? 0) + v; };
  const st = {
    rows: list.length, rowsWithTime: 0, busyRowsNoTime: 0, otherRowsNoTime: 0, totalMin: 0,
    byWeek: {}, byActivity: {}, byCategory: {}, byMonth: {}, studyDaysByWeek: {}, dayMin: {},
  };
  const busyDays = new Set(), rowDays = new Set();
  for (const s of list) {
    rowDays.add(s.date);
    if (s.busy) busyDays.add(s.date);
    if (s.duration === null) { s.busy ? st.busyRowsNoTime++ : st.otherRowsNoTime++; continue; }
    st.rowsWithTime++;
    st.totalMin += s.duration;
    add(st.byWeek, weekNo(s.date, cfg), s.duration);
    add(st.byActivity, s.activity ?? '(trống)', s.duration);
    add(st.byCategory, s.category, s.duration);
    const { y, m } = ymdFromSerial(s.date);
    add(st.byMonth, `${String(m).padStart(2, '0')}/${y}`, s.duration);
    add(st.dayMin, s.date, s.duration);
  }
  // "Ngày có học" = có ≥1 dòng và không có dòng "Bận đi làm"
  const studyDays = [...rowDays].filter(d => !busyDays.has(d)).sort((a, b) => a - b);
  st.studyDays = studyDays.length;
  for (const d of studyDays) add(st.studyDaysByWeek, weekNo(d, cfg), 1);
  const mins = studyDays.map(d => st.dayMin[d] ?? 0).sort((a, b) => a - b);
  st.daysAtLeast4h = mins.filter(m => m >= 240).length;
  st.daysAtLeast4hByWeek = {};
  for (const d of studyDays) if ((st.dayMin[d] ?? 0) >= 240) add(st.daysAtLeast4hByWeek, weekNo(d, cfg), 1);
  const n = mins.length;
  st.medianMinPerStudyDay = n ? (n % 2 ? mins[(n - 1) / 2] : (mins[n / 2 - 1] + mins[n / 2]) / 2) : null;
  return st;
}
