// core.js — Lõi tính toán của app: toàn hàm thuần (pure function), không đụng giao diện,
// không phụ thuộc thư viện; chạy được cả trên trình duyệt lẫn Node (để test).
// L3 dùng để hiển thị; L4–L6 dùng lại cho form, khóa tuần, ngày nghỉ.
//
// Mọi ngày/giờ được giữ ở dạng "serial" của Google Sheets:
//   - ngày: số nguyên, số ngày kể từ 30/12/1899 (ví dụ 46316 = 21/10/2026)
//   - giờ: phần thập phân của 1 ngày (ví dụ 0.375 = 09:00)
// Chuyển serial <-> (năm, tháng, ngày) bằng phép tính số nguyên, KHÔNG dùng đối tượng Date,
// nên không thể lệch 1 ngày do múi giờ của trình duyệt.

export const TIME_ZONE = 'Asia/Ho_Chi_Minh';
export const ACTIVITIES = ['Lý thuyết', 'Thực hành', 'Ôn tập', 'Kiểm tra nhớ', 'Nhờ AI'];
export const CATEGORIES = ['Ngoại ngữ', 'Chuyên môn BA', 'Không học'];
export const BUSY_TOPIC = 'Bận đi làm, không học, có ôn tập ngắn';
export const UNCATEGORIZED = 'Chưa phân loại';
export const WEEK_STATUS = { CURRENT: 'Đang diễn ra', PROVISIONAL: 'Tạm chốt', FINAL: 'Chốt hẳn', FUTURE: 'Chưa tới' };
export const WEEKDAY_NAMES = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']; // chỉ số 0 = Chủ nhật

// ---------------------------------------------------------------------------------------------
// 1. Ngày <-> serial bằng số nguyên (thuật toán "days from civil" của Howard Hinnant)
// ---------------------------------------------------------------------------------------------
// Số ngày từ 01/01/1970 tới (y, m, d) theo lịch Gregory.
function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
const SERIAL_1970 = 25569; // serial của 01/01/1970 trong Google Sheets

export function serialFromYMD(y, m, d) { return daysFromCivil(y, m, d) + SERIAL_1970; }
export function ymdFromSerial(s) {
  const z = Math.floor(s) - SERIAL_1970 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}
// Cài đặt (mục 3 Hướng dẫn dự án)
export const CONFIG = {
  startDate: serialFromYMD(2026, 10, 21),   // tuần 1 bắt đầu 21/10/2026 (thứ Tư)
  baselineEnd: serialFromYMD(2026, 11, 3),  // hết Baseline 03/11/2026
};
export const weekday = s => (((Math.floor(s) + 6) % 7) + 7) % 7; // 0 = Chủ nhật … 6 = Thứ Bảy (serial 0 = thứ Bảy)
export const daysInMonth = (y, m) => serialFromYMD(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - serialFromYMD(y, m, 1);
export function fmtDate(s) {
  const { y, m, d } = ymdFromSerial(s);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

// "Hôm nay" theo giờ Việt Nam, bất kể máy đang để múi giờ nào và Sheet để múi giờ nào.
// Đối tượng Date chỉ dùng để lấy THỜI ĐIỂM hiện tại; Intl tách ra năm/tháng/ngày ở Asia/Ho_Chi_Minh.
export function todaySerial(now = new Date(), timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
  const get = t => Number(parts.find(p => p.type === t).value);
  return serialFromYMD(get('year'), get('month'), get('day'));
}

// ---------------------------------------------------------------------------------------------
// 2. Chuẩn hóa 1 ô về giá trị thô, tùy theo nguồn đọc -> số (serial) | chuỗi | null
//   'grid'  : Sheets API spreadsheets.get (effectiveValue)
//   'values': mảng giá trị thô (values.get UNFORMATTED_VALUE + SERIAL_NUMBER, hoặc fixture)
//   'gviz'  : Visualization API -> {v: "Date(2026,9,21)" | số | chuỗi, f: "chuỗi hiển thị"} (app dùng nguồn này)
// ---------------------------------------------------------------------------------------------
export function rawCell(cell, source) {
  if (cell === undefined || cell === null || cell === '') return null;
  if (source === 'grid') {
    const ev = cell.effectiveValue;
    if (!ev) return null;
    if ('numberValue' in ev) return ev.numberValue;
    if ('stringValue' in ev) return ev.stringValue === '' ? null : ev.stringValue;
    if ('boolValue' in ev) return ev.boolValue;
    return null; // errorValue (#REF!...) coi như trống, sẽ bị báo ở bước kiểm tra
  }
  if (source === 'gviz') {
    const v = cell.v;
    if (v === null || v === undefined || v === '') return null;
    // gviz trả ngày/giờ dạng chuỗi "Date(năm,tháng-tính-từ-0,ngày[,giờ,phút,giây])"
    const m = typeof v === 'string' && v.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/);
    if (m) {
      const [, y, mo, d, h, mi, se] = m.map(x => Number(x ?? 0)); // phần giờ vắng mặt -> 0
      return serialFromYMD(y, mo + 1, d) + (h * 3600 + mi * 60 + se) / 86400; // giờ thuần có ngày = 30/12/1899 (serial 0)
    }
    return v;
  }
  return cell;
}

// ---------------------------------------------------------------------------------------------
// 3. Đọc bảng
// ---------------------------------------------------------------------------------------------
// Bảng Chủ đề -> Map(topic -> category). Dòng đầu là tiêu đề.
export function parseTopics(rows, source) {
  const map = new Map();
  for (const r of rows.slice(1)) {
    const topic = rawCell(r?.[0], source), cat = rawCell(r?.[1], source);
    if (typeof topic === 'string' && topic.trim()) map.set(topic.trim(), typeof cat === 'string' && cat.trim() ? cat.trim() : UNCATEGORIZED);
  }
  return map;
}

// Bảng Ca học: CHỈ đọc cột A–E (date, start, end, topic, activity) + F (note) nếu có.
// Cột G–K "(tự tính)" không bao giờ được đọc. rowNumber = số dòng thật trong Sheet (dòng 1 = tiêu đề).
// Trả về { sessions, issues }: issues là danh sách vấn đề dữ liệu để hiển thị cho Oriana sửa trong Sheet.
export function parseSessions(rows, source, topics, cfg = CONFIG) {
  const sessions = [], issues = [];
  rows.slice(1).forEach((r, i) => {
    const rowNumber = r?.rowNumber ?? i + 2; // fixture có thể mang sẵn số dòng gốc
    const cells = Array.isArray(r) ? r : r.cells;
    const [date, start, end, topic, activity, note] = [0, 1, 2, 3, 4, 5].map(c => rawCell(cells?.[c], source));
    if ([date, start, end, topic, activity].every(v => v === null)) return; // dòng trống / đã xóa nội dung A–E: bỏ qua
    const s = {
      rowNumber, date, start, end,
      topic: typeof topic === 'string' ? topic.trim() : topic,
      activity: typeof activity === 'string' ? activity.trim() : activity,
      note: typeof note === 'string' ? note : '',
      busy: false, open: false,
    };
    const problem = msg => issues.push({ rowNumber, msg });
    if (typeof date !== 'number') { problem(`Ngày không phải giá trị ngày (đọc được: ${JSON.stringify(date)})`); return; }
    s.date = Math.floor(date);
    if (s.date < cfg.startDate) problem(`Ngày ${fmtDate(s.date)} trước ngày bắt đầu ${fmtDate(cfg.startDate)} (không thuộc tuần nào)`);
    const hasStart = start !== null, hasEnd = end !== null;
    if (hasStart && typeof start !== 'number') problem(`Giờ bắt đầu không phải giá trị giờ: ${JSON.stringify(start)}`);
    if (hasEnd && typeof end !== 'number') problem(`Giờ kết thúc không phải giá trị giờ: ${JSON.stringify(end)}`);
    if (!hasStart && hasEnd) problem('Có giờ kết thúc nhưng thiếu giờ bắt đầu');
    s.open = hasStart && !hasEnd; // ca đang mở: chưa có giờ kết thúc -> không tính phút
    s.duration = durationMin(start, end);
    s.busy = s.topic === BUSY_TOPIC;
    if (!s.topic) problem('Thiếu chủ đề');
    s.category = topics.get(s.topic) ?? UNCATEGORIZED;
    if (s.topic && !topics.has(s.topic)) problem(`Chủ đề chưa có trong bảng Chủ đề: "${s.topic}" (tính vào "${UNCATEGORIZED}")`);
    if (!s.busy && !ACTIVITIES.includes(s.activity)) problem(`Hoạt động không hợp lệ: ${JSON.stringify(s.activity)}`);
    if (s.duration !== null && s.duration <= 0) problem(`Thời lượng ${s.duration} phút (giờ kết thúc = giờ bắt đầu?)`);
    if (s.duration !== null && s.duration > 600) problem(`Thời lượng bất thường: ${s.duration} phút`);
    sessions.push(s);
  });
  return { sessions, issues };
}

// duration_min = ROUND((end − start + 1 ngày nếu end < start) × 1440); thiếu giờ -> null.
// Ca qua nửa đêm (ví dụ 23:30 -> 00:30) = 60 phút, tính trọn vào NGÀY BẮT ĐẦU (cột date).
export function durationMin(start, end) {
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  const st = start % 1, en = end % 1; // chỉ lấy phần giờ, phòng khi ô giờ có dính ngày
  return Math.round((en - st + (en < st ? 1 : 0)) * 1440);
}

// ---------------------------------------------------------------------------------------------
// 4. Tuần, phase, tháng
// ---------------------------------------------------------------------------------------------
export const weekNo = (d, cfg = CONFIG) => Math.floor((d - cfg.startDate) / 7) + 1;
export const weekStart = (w, cfg = CONFIG) => cfg.startDate + (w - 1) * 7; // thứ Tư
export const weekEnd = (w, cfg = CONFIG) => weekStart(w, cfg) + 6;          // thứ Ba
export const phase = (d, cfg = CONFIG) => (d <= cfg.baselineEnd ? 'Baseline' : 'Sau baseline');

// Trạng thái tuần so với hôm nay (mục 5): tuần chứa hôm nay = Đang diễn ra; liền trước = Tạm chốt; xa hơn = Chốt hẳn.
export function weekStatus(w, today, cfg = CONFIG) {
  const cur = weekNo(today, cfg);
  if (w === cur) return WEEK_STATUS.CURRENT;
  if (w === cur - 1) return WEEK_STATUS.PROVISIONAL;
  if (w < cur - 1) return WEEK_STATUS.FINAL;
  return WEEK_STATUS.FUTURE;
}

export const monthKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

// ---------------------------------------------------------------------------------------------
// 5. Thống kê. today = "hôm nay" (serial, giờ VN); chỉ tính các ca có date <= toDate (mặc định = today).
// Định nghĩa:
//   - "ca" (count) = dòng có đủ giờ bắt đầu + kết thúc. Dòng "Bận đi làm" không giờ và ca đang mở không phải ca.
//   - "ngày có học" (mục 6) = ngày có ≥1 dòng Ca học và KHÔNG có dòng topic "Bận đi làm".
//     Lưu ý: ca đang mở cũng là 1 dòng -> ngày đó vẫn là ngày có học (xem "Quyết định chưa chốt").
// ---------------------------------------------------------------------------------------------
export function computeStats(sessions, today, { toDate = today, cfg = CONFIG } = {}) {
  const list = sessions.filter(s => typeof s.date === 'number' && s.date >= cfg.startDate && s.date <= toDate);
  const g = { week: {}, activity: {}, category: {}, topic: {}, phase: {}, month: {} };
  const bump = (obj, k, min) => { const o = (obj[k] ??= { min: 0, count: 0 }); o.min += min; o.count += 1; };
  const days = {}; // date -> { date, min, count, rows, busy, open }
  const st = { today, toDate, rows: list.length, rowsWithTime: 0, busyRowsNoTime: 0, otherRowsNoTime: 0, totalMin: 0, openSessions: [] };

  for (const s of list) {
    const day = (days[s.date] ??= { date: s.date, min: 0, count: 0, rows: 0, busy: false, open: 0 });
    day.rows++;
    if (s.busy) day.busy = true;
    if (s.open) { day.open++; st.openSessions.push(s); }
    if (s.duration === null) { s.busy ? st.busyRowsNoTime++ : st.otherRowsNoTime++; continue; }
    st.rowsWithTime++;
    st.totalMin += s.duration;
    day.min += s.duration; day.count++;
    const { y, m } = ymdFromSerial(s.date);
    bump(g.week, weekNo(s.date, cfg), s.duration);
    bump(g.activity, s.activity ?? '(trống)', s.duration);
    bump(g.category, s.category, s.duration);
    bump(g.topic, s.topic, s.duration);
    bump(g.phase, phase(s.date, cfg), s.duration);
    bump(g.month, monthKey(y, m), s.duration);
  }
  for (const d of Object.values(days)) d.studyDay = !d.busy; // có dòng (vì nằm trong days) và không có "Bận đi làm"
  st.groups = g;
  st.days = days;

  // Danh sách tuần từ tuần 1 tới tuần chứa toDate, tuần không có dữ liệu vẫn có (0 phút).
  const lastWeek = weekNo(toDate, cfg);
  st.weeks = [];
  for (let w = 1; w <= lastWeek; w++) {
    const start = weekStart(w, cfg), end = weekEnd(w, cfg);
    const inWeek = Object.values(days).filter(d => d.date >= start && d.date <= end);
    const study = inWeek.filter(d => d.studyDay);
    st.weeks.push({
      week: w, start, end, status: weekStatus(w, today, cfg),
      daysElapsed: Math.max(0, Math.min(end, toDate) - start + 1), // số ngày lịch đã qua của tuần (tính cả hôm nay)
      min: g.week[w]?.min ?? 0, count: g.week[w]?.count ?? 0,
      studyDays: study.length, daysAtLeast4h: study.filter(d => d.min >= 240).length,
    });
  }

  // Danh sách tháng dương lịch từ tháng chứa start_date tới tháng chứa toDate.
  st.months = [];
  const a = ymdFromSerial(cfg.startDate), b = ymdFromSerial(toDate);
  for (let y = a.y, m = a.m; y < b.y || (y === b.y && m <= b.m); m === 12 ? (y++, m = 1) : m++) {
    const first = serialFromYMD(y, m, 1), last = first + daysInMonth(y, m) - 1;
    const k = monthKey(y, m);
    st.months.push({
      key: k, y, m, first, last,
      dataFrom: Math.max(first, cfg.startDate), dataTo: Math.min(last, toDate),
      missingStart: first < cfg.startDate,  // true -> "chưa đủ tháng" (ví dụ 10/2026 chỉ có từ 21/10)
      inProgress: toDate < last,            // tháng đang diễn ra
      min: g.month[k]?.min ?? 0, count: g.month[k]?.count ?? 0,
    });
  }

  // Các chỉ số theo ngày có học
  const studyDays = Object.values(days).filter(d => d.studyDay).sort((x, y) => x.date - y.date);
  st.studyDays = studyDays.length;
  const mins = studyDays.map(d => d.min).sort((x, y) => x - y);
  st.daysAtLeast4h = mins.filter(m => m >= 240).length;
  st.medianMinPerStudyDay = median(mins);
  return st;
}

export function median(sorted) {
  const n = sorted.length;
  if (!n) return null;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

// Tiện ích: đọc trọn 2 bảng rồi tính, dùng chung cho app và test.
export function buildModel({ caRows, cdRows, source, today, toDate, cfg = CONFIG }) {
  const topics = parseTopics(cdRows, source);
  const { sessions, issues } = parseSessions(caRows, source, topics, cfg);
  return { topics, sessions, issues, stats: computeStats(sessions, today, { toDate: toDate ?? today, cfg }) };
}
