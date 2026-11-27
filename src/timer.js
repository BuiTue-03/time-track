// timer.js — L7: phép tính của nút Bắt đầu / Kết thúc / Đổi ca. Toàn hàm thuần: không gọi mạng, không đụng giao diện,
// không tự gọi Date.now() — "bây giờ" luôn được truyền vào (mốc ms), nên test đặt được đồng hồ giả.
// Quyết định Oriana 27/11/2026 (Phần A, duyệt hết a–l):
//   b. Giờ ghi làm tròn tới PHÚT bằng cách cắt giây (10:15:40 -> 10:15), cả bắt đầu lẫn kết thúc (khớp cột G của Sheet).
//      Kết thúc cùng phút với bắt đầu (dưới 1 phút) -> 'zero': giao diện hỏi "Hủy ca" hoặc "Tiếp tục học".
//   c. Lưu tạm giờ bấm trong máy (khóa tt-timer-pending), xóa khi ghi xong; thử lại dùng đúng giờ bấm, đọc lại trước.
//   f. So giờ máy với tiêu đề Date của Google; lệch > 2 phút -> cảnh báo (vẫn ghi theo giờ máy).
//   h. 3 chủ đề gần nhất lên đầu, bỏ nhóm "Không học".  l. Ca mở từ 2 ngày trước -> chặn Bắt đầu, sửa trong Sheet.
//   Ca từ 24 giờ trở lên: không ghi được (Sheet tính giờ kết thúc = giờ bắt đầu thành 0 phút) -> sửa trong Sheet.
// Không sửa luật cũ: ghi vẫn qua rules.validateRow + write-core.serializeRow; ca mở vẫn không tính phút (core.js).
import { WEEK_STATUS, ACTIVITIES, REST_TOPICS, weekNo, weekStatus } from './core.js';
import { closeAction } from './stats-extra.js';
import { splitNote, isOffsetNote } from './rules.js';

const MIN_MS = 60_000;
const VN_OFFSET_MS = 7 * 60 * MIN_MS; // Việt Nam UTC+7 cố định (không có giờ mùa hè)
const SERIAL_1970 = 25569;            // serial Google Sheets của 01/01/1970
const DAY_MIN = 1440;

// ---------------------------------------------------------------------------------------------
// 1. Đồng hồ giờ Việt Nam từ một mốc ms (Date.now() của máy). Chỉ dùng số học trên mốc tuyệt đối, không dùng
//    giờ địa phương của điện thoại -> đổi múi giờ điện thoại không ảnh hưởng.
//    minute = số phút (giờ VN) kể từ 01/01/1970 00:00; date = serial ngày; minOfDay = phút trong ngày (giây bị cắt).
// ---------------------------------------------------------------------------------------------
export function clockFromMs(ms) {
  const minute = Math.floor((ms + VN_OFFSET_MS) / MIN_MS);
  const day = Math.floor(minute / DAY_MIN);
  const minOfDay = minute - day * DAY_MIN;
  return { ms, minute, date: day + SERIAL_1970, minOfDay, frac: minOfDay / DAY_MIN };
}
const startMinOfDay = s => Math.round((s.start % 1) * DAY_MIN);
// Phút tuyệt đối (giờ VN) của giờ bắt đầu một ca trong Sheet
const startMinute = s => (s.date - SERIAL_1970) * DAY_MIN + startMinOfDay(s);
export const sessionStartMs = s => startMinute(s) * MIN_MS - VN_OFFSET_MS;

// ---------------------------------------------------------------------------------------------
// 2. Thời gian đã trôi của ca mở = bây giờ − giờ bắt đầu trong Sheet (không đếm từng giây, nên máy ngủ hay app tắt
//    rồi mở lại vẫn đúng). behind = đồng hồ máy đang trước giờ bắt đầu (bị chỉnh lùi); overDay = từ 24 giờ trở lên.
// ---------------------------------------------------------------------------------------------
export function elapsed(s, nowMs) {
  const d = nowMs - sessionStartMs(s);
  const ms = Math.max(0, d);
  return { ms, min: Math.floor(ms / MIN_MS), behind: d < 0, overDay: ms >= DAY_MIN * MIN_MS };
}
// "2:01:05" (có giờ) hoặc "1:05" (dưới 1 giờ)
export function fmtElapsed(ms) {
  const t = Math.floor(Math.max(0, ms) / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

// ---------------------------------------------------------------------------------------------
// 3. Bắt đầu
// ---------------------------------------------------------------------------------------------
// Một ca mở tại một thời điểm: có ca mở (bất kể ngày nào) -> chặn. Trả ca cũ nhất để xử lý trước.
//   action 'close' = đóng được trong app (luồng L5); 'sheet' = ca từ 2 ngày trước / tuần Chốt hẳn -> Mở Sheet.
export function startBlock(stats) {
  const list = [...(stats?.openSessions ?? [])].sort((a, b) => a.date - b.date || (a.start % 1) - (b.start % 1));
  if (!list.length) return null;
  const s = list[0];
  return { reason: 'open', session: s, action: closeAction(s, stats.today), count: list.length };
}
// Dòng mới cho nút Bắt đầu: ngày hôm nay (giờ VN), giờ bấm (cắt giây), chưa có giờ kết thúc. Dạng input của validateRow.
export function buildStartInput({ clock, topic, activity }) {
  return { date: clock.date, start: clock.minOfDay / DAY_MIN, end: null, topic, activity, noteText: '', isOffset: false };
}

// ---------------------------------------------------------------------------------------------
// 4. Kết thúc: giờ kết thúc = giờ lúc BẤM (clock), kể cả khi ghi sau (thử lại, đăng nhập lại).
//   today = ngày lúc ghi (mặc định = ngày bấm); dùng để xét quyền tuần lúc ghi (có thể đã sang tuần mới).
//   kind: 'close' ghi được | 'zero' dưới 1 phút | 'behind' đồng hồ máy trước giờ bắt đầu |
//         'sheet' (reason 'over24h' | 'old') phải sửa trong Sheet | 'not-open' ca không còn mở.
//   noteAllowed: chỉ tuần Đang diễn ra mới nhập ghi chú lúc Kết thúc (Tạm chốt: chỉ điền giờ kết thúc, luật L5).
// ---------------------------------------------------------------------------------------------
export function planEnd(s, clock, { note, today = clock.date } = {}) {
  if (!s || !s.open || typeof s.start !== 'number') return { kind: 'not-open' };
  const durMin = clock.minute - startMinute(s);
  if (durMin < 0) return { kind: 'behind', durMin };
  if (durMin === 0) return { kind: 'zero', durMin };
  if (durMin >= DAY_MIN) return { kind: 'sheet', reason: 'over24h', durMin };
  if (closeAction(s, today) !== 'close') return { kind: 'sheet', reason: 'old', durMin };
  const noteAllowed = weekStatus(weekNo(s.date), today) === WEEK_STATUS.CURRENT;
  const orig = splitNote(s.note).text;
  const noteText = noteAllowed && note !== undefined && note !== null ? note : orig;
  const input = {
    date: s.date, start: s.start, end: clock.minOfDay / DAY_MIN, topic: s.topic, activity: s.activity,
    noteText, isOffset: isOffsetNote(s.note),
  };
  return { kind: 'close', input, durMin, nextDay: clock.minOfDay < startMinOfDay(s), noteAllowed };
}

// ---------------------------------------------------------------------------------------------
// 5. Đổi ca: đóng ca hiện tại và mở ca mới tại CÙNG một giờ bấm. Ca mới phải khác chủ đề hoặc khác hoạt động
//    (Hướng dẫn mục 4). Bước đóng không ghi được (dưới 1 phút, quá 24 giờ...) -> không đổi, trả lý do.
// ---------------------------------------------------------------------------------------------
export function planSwitch(s, clock, { topic, activity }) {
  if (s && topic === s.topic && activity === s.activity) return { ok: false, reason: 'same' };
  const end = planEnd(s, clock);
  if (end.kind !== 'close') return { ok: false, reason: end.kind, end };
  return { ok: true, end, start: buildStartInput({ clock, topic, activity }) };
}

// ---------------------------------------------------------------------------------------------
// 6. Lưu tạm giờ bấm (Phần A câu c). Một mục duy nhất trong localStorage; giao diện xóa khi ghi xong.
//    Chỉ chứa: loại thao tác, giờ bấm, chủ đề/hoạt động (Bắt đầu, Đổi ca), dòng + nhận dạng ca (Kết thúc, Đổi ca), ghi chú.
// ---------------------------------------------------------------------------------------------
export const PENDING_KEY = 'tt-timer-pending';
const KINDS = ['start', 'end', 'switch'];
export function makePending({ kind, clock, topic, activity, session, note }) {
  const p = { v: 1, kind, ms: clock.ms, date: clock.date, minOfDay: clock.minOfDay };
  if (kind !== 'end') Object.assign(p, { topic, activity });
  if (kind !== 'start') Object.assign(p, { rowNumber: session.rowNumber, sDate: session.date, sStartMin: startMinOfDay(session), sTopic: session.topic ?? '' });
  if (kind === 'end' && typeof note === 'string') p.note = note;
  return p;
}
const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
// Đọc lại chuỗi đã lưu; hỏng / thiếu / không khớp -> null (giao diện bỏ qua, không treo app)
export function parsePending(str) {
  let p;
  try { p = JSON.parse(str); } catch { return null; }
  if (!p || typeof p !== 'object' || p.v !== 1 || !KINDS.includes(p.kind) || typeof p.ms !== 'number') return null;
  if (!isInt(p.date, 1, 1e6) || !isInt(p.minOfDay, 0, DAY_MIN - 1)) return null;
  const c = clockFromMs(p.ms);
  if (c.date !== p.date || c.minOfDay !== p.minOfDay) return null;
  if (p.kind !== 'end' && (typeof p.topic !== 'string' || !p.topic || typeof p.activity !== 'string')) return null;
  if (p.kind !== 'start' && (!isInt(p.rowNumber, 2, 1e6) || !isInt(p.sDate, 1, 1e6) || !isInt(p.sStartMin, 0, DAY_MIN - 1) || typeof p.sTopic !== 'string')) return null;
  if (p.note !== undefined && typeof p.note !== 'string') return null;
  return p;
}
// Sau khi ĐỌC LẠI Sheet: mục lưu tạm đã vào Sheet chưa?
//   'done' = đã có trong Sheet (KHÔNG ghi lại) | 'todo' = chưa có, ghi bằng đúng giờ bấm (step cho Đổi ca: 'end' | 'start') |
//   'conflict' = Sheet đã khác (dòng bị sửa/xóa, hoặc máy khác đã mở ca khác) -> không ghi, báo Oriana.
export function pendingStatus(p, sessions) {
  const clock = clockFromMs(p.ms);
  const startState = () => {
    const hit = sessions.find(x => x.date === p.date && typeof x.start === 'number' && startMinOfDay(x) === p.minOfDay && x.topic === p.topic);
    if (hit) return { state: 'done', rowNumber: hit.rowNumber, clock };
    const other = sessions.find(x => x.open);
    if (other) return { state: 'conflict', reason: 'other-open', session: other, clock };
    return { state: 'todo', clock };
  };
  const endState = () => {
    const row = sessions.find(x => x.rowNumber === p.rowNumber);
    const same = row && row.date === p.sDate && typeof row.start === 'number' && startMinOfDay(row) === p.sStartMin && (row.topic ?? '') === p.sTopic;
    if (!same) return { state: 'conflict', reason: 'changed', clock };
    if (row.open) return { state: 'todo', session: row, clock };
    if (Math.round((row.end % 1) * DAY_MIN) === p.minOfDay) return { state: 'done', rowNumber: row.rowNumber, clock };
    return { state: 'conflict', reason: 'changed', session: row, clock };
  };
  if (p.kind === 'start') return startState();
  if (p.kind === 'end') return endState();
  const e = endState();
  if (e.state === 'conflict') return e;
  if (e.state === 'todo') return { ...e, step: 'end' };
  const s = startState();
  return s.state === 'todo' ? { ...s, step: 'start' } : s;
}

// ---------------------------------------------------------------------------------------------
// 7. So giờ máy với giờ Google (Phần A câu f). dateHeader = tiêu đề "date" của phản hồi sheets.googleapis.com
//    (chỉ chính xác tới giây). Giờ Google ước lượng = Date + 0,5 giây, so với giữa lúc gửi và lúc nhận.
//    Khứ hồi > 10 giây -> không kết luận. skewMs > 0: máy chạy NHANH hơn Google.
// ---------------------------------------------------------------------------------------------
export const SKEW_WARN_MS = 2 * MIN_MS;
export function clockSkew({ dateHeader, sentMs, recvMs }) {
  if (!dateHeader) return null;
  const server = Date.parse(dateHeader);
  const rtt = recvMs - sentMs;
  if (!Number.isFinite(server) || !(rtt >= 0) || rtt > 10_000) return null;
  const skewMs = (sentMs + recvMs) / 2 - (server + 500);
  return { skewMs, warn: Math.abs(skewMs) > SKEW_WARN_MS };
}

// ---------------------------------------------------------------------------------------------
// 8. Chủ đề nhanh và lựa chọn mặc định (tính từ dữ liệu, không lưu riêng)
// ---------------------------------------------------------------------------------------------
const studyRows = (sessions, topics) => sessions
  .filter(s => typeof s.start === 'number' && typeof s.topic === 'string' && s.topic && !REST_TOPICS.includes(s.topic) && topics?.get(s.topic) !== 'Không học')
  .sort((a, b) => b.date - a.date || (b.start % 1) - (a.start % 1));
export function recentTopics(sessions, topics, n = 3) {
  const out = [];
  for (const s of studyRows(sessions, topics)) if (!out.includes(s.topic)) { out.push(s.topic); if (out.length === n) break; }
  return out;
}
export function defaultChoice(sessions, topics) {
  const s = studyRows(sessions, topics).find(x => ACTIVITIES.includes(x.activity));
  return s ? { topic: s.topic, activity: s.activity } : null;
}
