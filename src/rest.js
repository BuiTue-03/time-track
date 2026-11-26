// rest.js — Ngày nghỉ, hạn mức cộng dồn, gợi ý quy đổi, đọc tab "Cài đặt" và "Tích lũy" (L6).
// Hàm thuần: không gọi mạng, không đụng giao diện. Chỉ đọc kết quả có sẵn của core.js (sessions); không sửa cách tính cũ.
// Quyết định Oriana (Phần A L6, 26/11/2026):
//   - Ngày nghỉ đã dùng = ngày có ≥1 dòng topic thuộc REST_TOPICS ("Bận đi làm…", "Nghỉ ngơi"); 1 ngày nhiều dòng = 1 ngày.
//   - Hạn mức Q ngày mỗi tháng dương lịch, từ tháng chứa rest_accrual_start (01/11/2026). Tháng hiện tại có đủ Q ngay ngày 1.
//   - Số dư = Σ (Q − đã dùng của tháng) − tổng số ngày đã quy đổi (cột B tab Tích lũy). Có thể âm.
//   - Gợi ý quy đổi cho THÁNG VỪA KẾT THÚC, từ 06:00 ngày 1 tháng mới; quy đổi một phần được; Oriana tự xác nhận.
//   - Ngày bỏ lỡ (không có dòng) KHÔNG tự trừ ngày nghỉ.
import { CONFIG, REST_TOPICS, rawCell, serialFromYMD, ymdFromSerial, monthKey, daysInMonth, todaySerial, WEEK_STATUS } from './core.js';
import { weekStatusOfDate, permissions, nowFraction, minutesOf } from './rules.js';

// ---------------------------------------------------------------------------------------------
// 1. Tab "Cài đặt": đọc theo TÊN KHÓA ở cột A, giá trị ở cột C. Thiếu/sai -> giá trị dự phòng + cảnh báo.
// ---------------------------------------------------------------------------------------------
export const DEFAULT_SETTINGS = {
  goalMinPerDay: 240, goalDaysPerWeek: 6, goalWeekMin: 1440,
  restQuotaPerMonth: 4, restAccrualStart: serialFromYMD(2026, 11, 1), moneyPerRestDay: 100000,
};
const KEYS = {
  goal_min_per_day: 'goalMinPerDay', goal_days_per_week: 'goalDaysPerWeek', rest_quota_per_month: 'restQuotaPerMonth',
  rest_accrual_start: 'restAccrualStart', money_per_rest_day: 'moneyPerRestDay',
};
// Công thức cột C của tab Tích lũy đọc cố định 'Cài đặt'!$C$6 -> money_per_rest_day phải nằm ở hàng 6.
export const MONEY_ROW = 6;
const valid = {
  goalMinPerDay: v => Number.isInteger(v) && v > 0 && v <= 1440,
  goalDaysPerWeek: v => Number.isInteger(v) && v >= 1 && v <= 7,
  restQuotaPerMonth: v => Number.isInteger(v) && v >= 0 && v <= 31,
  restAccrualStart: v => Number.isInteger(v) && v >= CONFIG.startDate,
  moneyPerRestDay: v => typeof v === 'number' && Number.isFinite(v) && v >= 0,
};
// rows: mảng 2 chiều (dòng 0 = tiêu đề) như core.parseTopics; source: 'values' | 'gviz' | 'grid'.
export function parseSettings(rows, source) {
  const settings = { ...DEFAULT_SETTINGS }, warnings = [];
  if (!Array.isArray(rows) || rows.length < 2) return { settings, warnings, fromSheet: false };
  const seen = {};
  rows.slice(1).forEach((r, i) => {
    const key = rawCell(r?.[0], source);
    const name = typeof key === 'string' ? KEYS[key.trim()] : null;
    if (name) seen[name] = { value: rawCell(r?.[2], source), rowNumber: i + 2 };
  });
  for (const [key, name] of Object.entries(KEYS)) {
    const s = seen[name];
    let v = s?.value;
    if (name === 'restAccrualStart' && typeof v === 'number') v = Math.floor(v);
    if (s && valid[name](v)) settings[name] = v;
    else warnings.push(`Cài đặt "${key}" ${s ? `không hợp lệ (${JSON.stringify(v)})` : 'không đọc được'}: đang dùng giá trị mặc định.`);
  }
  if (seen.moneyPerRestDay && seen.moneyPerRestDay.rowNumber !== MONEY_ROW)
    warnings.push(`money_per_rest_day đang ở hàng ${seen.moneyPerRestDay.rowNumber}, không phải C${MONEY_ROW}: cột "Số tiền" của tab Tích lũy đọc ô C${MONEY_ROW} nên có thể tính sai tiền.`);
  settings.goalWeekMin = settings.goalMinPerDay * settings.goalDaysPerWeek;
  return { settings, warnings, fromSheet: true };
}

// ---------------------------------------------------------------------------------------------
// 2. Tab "Tích lũy": A ngày quy đổi, B số ngày, C số tiền (công thức, app KHÔNG đọc làm nguồn), D ghi chú.
//   Nhãn tháng ở đầu D: "[T11/2026 · a7c2]" (app tự ghi). Dòng gõ tay không có nhãn -> tháng liền trước ngày ở cột A.
// ---------------------------------------------------------------------------------------------
export const ACCRUAL_TAG_RE = /^\[T(\d{1,2})\/(\d{4})(?: · ([a-z0-9]+))?\]/;
export const accrualTag = (y, m, code) => `[T${m}/${y} · ${code}]`;
export const composeAccrualNote = (tag, text) => ((text ?? '').trim() ? `${tag} ${text.trim()}` : tag);
export const randomCode = (rnd = Math.random) => Array.from({ length: 4 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(rnd() * 36)]).join('');
const prevMonth = ({ y, m }) => (m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 });

export function parseAccrual(rows, source) {
  const entries = [], issues = [];
  (rows ?? []).slice(1).forEach((r, i) => {
    const rowNumber = i + 2;
    const [a, b, , d] = [0, 1, 2, 3].map(c => rawCell(r?.[c], source));
    if (a === null && b === null && d === null) return; // dòng trống (cột C có công thức trả "" vẫn coi là trống)
    if (typeof a !== 'number') { issues.push({ rowNumber, msg: 'Tích lũy: thiếu ngày quy đổi (cột A).' }); return; }
    if (!Number.isInteger(b) || b <= 0) { issues.push({ rowNumber, msg: `Tích lũy: số ngày quy đổi phải là số nguyên dương (đọc được ${JSON.stringify(b)}).` }); return; }
    const note = typeof d === 'string' ? d : '';
    const t = ACCRUAL_TAG_RE.exec(note.trimStart());
    const date = Math.floor(a);
    const month = t ? { y: Number(t[2]), m: Number(t[1]) } : prevMonth(ymdFromSerial(date));
    entries.push({ rowNumber, date, days: b, note, month, tag: t?.[3] ?? null });
  });
  return { entries, issues };
}

// ---------------------------------------------------------------------------------------------
// 3. Ngày nghỉ và số dư
// ---------------------------------------------------------------------------------------------
// Tập ngày nghỉ (đã sắp xếp), từ start_date tới hôm nay
export function restDates(sessions, today, cfg = CONFIG) {
  const set = new Set();
  for (const s of sessions) if (s.rest && typeof s.date === 'number' && s.date >= cfg.startDate && s.date <= today) set.add(s.date);
  return [...set].sort((a, b) => a - b);
}
const ymKey = ({ y, m }) => monthKey(y, m);

// Kết quả: { months:[{key,y,m,first,last,quota,used,dates,unused,converted}], usedTotal, converted, balance, preAccrual }
export function restSummary(sessions, entries, today, settings = DEFAULT_SETTINGS, cfg = CONFIG) {
  const dates = restDates(sessions, today, cfg);
  const Q = settings.restQuotaPerMonth, start = settings.restAccrualStart;
  const convByMonth = {};
  for (const e of entries ?? []) {
    const k = ymKey(e.month ?? prevMonth(ymdFromSerial(e.date))); // không có tháng -> tháng liền trước ngày quy đổi
    convByMonth[k] = (convByMonth[k] ?? 0) + e.days;
  }
  const months = [];
  const a = ymdFromSerial(start), b = ymdFromSerial(today);
  for (let y = a.y, m = a.m; today >= start && (y < b.y || (y === b.y && m <= b.m)); m === 12 ? (y++, m = 1) : m++) {
    const first = serialFromYMD(y, m, 1), last = first + daysInMonth(y, m) - 1;
    const md = dates.filter(d => d >= Math.max(first, start) && d <= last);
    const key = monthKey(y, m);
    months.push({ key, y, m, first, last, quota: Q, used: md.length, dates: md, unused: Math.max(0, Q - md.length), converted: convByMonth[key] ?? 0 });
  }
  const usedTotal = months.reduce((x, mo) => x + mo.used, 0);
  const converted = (entries ?? []).reduce((x, e) => x + e.days, 0);
  return {
    months, usedTotal, converted,
    balance: months.reduce((x, mo) => x + mo.quota - mo.used, 0) - converted,
    preAccrual: dates.filter(d => d < start), // ngày nghỉ trước 01/11/2026: không trừ hạn mức
  };
}

// Gợi ý quy đổi cho tháng vừa kết thúc (tháng liền trước tháng của "hôm nay").
//   Hiện từ 06:00 ngày 1 (nowMin = phút trong ngày giờ VN; null = chế độ giả lập, coi như đã qua 06:00).
//   days = min(chưa dùng của tháng đó − đã quy đổi cho tháng đó, số dư tính tới hết tháng đó); ≤ 0 -> null.
//   Hạn mức của tháng mới không bị đụng tới.
export const SUGGEST_FROM_MIN = 6 * 60;
export function conversionSuggestion(summary, today, nowMin, settings = DEFAULT_SETTINGS) {
  const t = ymdFromSerial(today);
  if (t.d === 1 && nowMin !== null && nowMin !== undefined && nowMin < SUGGEST_FROM_MIN) return null;
  const pm = prevMonth(t), key = ymKey(pm);
  const i = summary.months.findIndex(mo => mo.key === key);
  if (i < 0) return null; // tháng trước ngày bắt đầu tích lũy
  const mo = summary.months[i];
  const balanceEndOfMonth = summary.months.slice(0, i + 1).reduce((x, q) => x + q.quota - q.used, 0) - summary.converted;
  const days = Math.min(mo.unused - mo.converted, balanceEndOfMonth);
  if (days <= 0) return null;
  return { monthKey: key, y: mo.y, m: mo.m, unused: mo.unused, convertedForMonth: mo.converted, balanceEndOfMonth, days, amount: days * settings.moneyPerRestDay };
}

// ---------------------------------------------------------------------------------------------
// 4. Nút "Đánh dấu ngày nghỉ": dùng lại bảng quyền của rules.js (KHÔNG sửa rules.js).
//   Đang diễn ra -> dòng thường; Tạm chốt -> dòng [OFFSET]; Chốt hẳn / chưa tới / trước 21/10 / đã có dòng nghỉ -> chặn.
// ---------------------------------------------------------------------------------------------
export function canMarkRest(date, today, sessions, cfg = CONFIG) {
  const errors = [];
  if (!Number.isInteger(date)) return { ok: false, isOffset: false, errors: ['Ngày không hợp lệ.'] };
  if (date < cfg.startDate) return { ok: false, isOffset: false, errors: ['Ngày này trước ngày bắt đầu ghi (21/10/2026).'] };
  if (date > today) return { ok: false, isOffset: false, errors: ['Chưa đánh dấu trước được cho ngày chưa tới.'] };
  const status = weekStatusOfDate(date, today, cfg);
  const p = permissions(status);
  const isOffset = status === WEEK_STATUS.PROVISIONAL;
  if (isOffset ? !p.canAddBu : !p.canAdd) errors.push(isOffset ? p.reasons.canAddBu : p.reasons.canAdd);
  if (sessions.some(s => s.rest && s.date === date)) errors.push('Ngày này đã có dòng nghỉ rồi, không cần đánh dấu lại.');
  return { ok: errors.length === 0, isOffset, errors };
}

// ---------------------------------------------------------------------------------------------
// 5. Đồng hồ giờ Việt Nam (tiêm "now" để test ranh giới tháng và mốc 06:00)
// ---------------------------------------------------------------------------------------------
export function vnClock(now = new Date()) {
  return { today: todaySerial(now), nowMin: minutesOf(nowFraction(now)) };
}
export const fmtVnd = n => `${Math.round(n).toLocaleString('de-DE')} VND`; // dấu chấm ngăn nghìn: 200.000 VND
export { REST_TOPICS };
