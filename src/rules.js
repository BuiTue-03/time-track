// rules.js — Luật thêm / sửa / xóa ca học (L4). Toàn hàm thuần: không gọi mạng, không đụng giao diện.
// Dựa trên Hướng dẫn dự án mục 4–5 và các quyết định Oriana chốt ở L4 Phần A (25/11/2026):
//   - Trạng thái tuần app tự tính theo ngày (Asia/Ho_Chi_Minh), đổi lúc 00:00 thứ Tư. Tính lại lúc bấm Lưu.
//   - Chốt hẳn: chặn hết. Tạm chốt: chỉ thêm ca ghi bù; ca thường chỉ sửa chủ đề/hoạt động/ghi chú.
//   - Nhãn ghi bù = "[OFFSET]" ở đầu cột F (Ghi chú). Khi sửa ca không được thêm/bỏ nhãn.
//   - Chặn ngày/giờ tương lai; ca trùng giờ chỉ cảnh báo; ca qua đêm cho phép, cảnh báo nếu > 10 tiếng.
//   - Ca chưa có giờ kết thúc (ca đang mở) chỉ lưu được ở tuần Đang diễn ra.
//   - L5 (Oriana duyệt Phần A e, 26/11/2026): ĐÓNG ca mở (chỉ điền giờ kết thúc vào dòng có sẵn) được cả ở tuần
//     Tạm chốt; ở Tạm chốt không được sửa trường khác cùng lúc. Chốt hẳn: chặn như cũ.
import {
  CONFIG, WEEK_STATUS, ACTIVITIES, BUSY_TOPIC, weekNo, weekStatus, fmtDate, durationMin,
  serialFromYMD, ymdFromSerial,
} from './core.js';

// ---------------------------------------------------------------------------------------------
// 1. Nhãn ghi bù "[OFFSET]"
// ---------------------------------------------------------------------------------------------
export const OFFSET_LABEL = '[OFFSET]';
// Ô ghi chú có phải ca ghi bù không: bỏ khoảng trắng đầu, bắt đầu đúng "[OFFSET]" (phân biệt hoa thường).
export const isOffsetNote = note => typeof note === 'string' && note.trimStart().startsWith(OFFSET_LABEL);
// Tách ô ghi chú thành { isOffset, text } để form hiển thị nhãn riêng, ghi chú riêng.
export function splitNote(note) {
  const s = typeof note === 'string' ? note : '';
  if (!isOffsetNote(s)) return { isOffset: false, text: s };
  return { isOffset: true, text: s.trimStart().slice(OFFSET_LABEL.length).replace(/^ /, '') };
}
// Ghép lại khi ghi: "[OFFSET] " + ghi chú; không có ghi chú -> "[OFFSET]".
export function composeNote(isOffset, text) {
  const t = (text ?? '').trim() === '' ? '' : text;
  if (!isOffset) return t;
  return t ? `${OFFSET_LABEL} ${t}` : OFFSET_LABEL;
}

// ---------------------------------------------------------------------------------------------
// 2. Trạng thái tuần của một NGÀY (core.weekStatus nhận số tuần; hàm này nhận ngày serial)
// ---------------------------------------------------------------------------------------------
export function weekStatusOfDate(dateSerial, todaySerial, cfg = CONFIG) {
  if (dateSerial < cfg.startDate) return WEEK_STATUS.FINAL; // trước tuần 1: coi như đã chốt
  return weekStatus(weekNo(dateSerial, cfg), todaySerial, cfg);
}

// ---------------------------------------------------------------------------------------------
// 3. BẢNG QUYỀN DUY NHẤT. Mọi chỗ khác (form, nút, kiểm tra trước khi ghi) đều tra bảng này.
//   canAdd     : thêm ca thường (không nhãn)
//   canAddBu   : thêm ca ghi bù (nhãn [OFFSET])
//   canEdit    : mở form sửa được không (ít nhất 1 trường)
//   canEditTime: sửa được ngày / giờ bắt đầu / giờ kết thúc
//   canDelete  : xóa được
//   canClose   : đóng ca mở = chỉ điền giờ kết thúc cho dòng có sẵn (L5)
// Tuần Tạm chốt phân biệt ca thường (normal) và ca ghi bù (offset).
// ---------------------------------------------------------------------------------------------
const NO = { canAdd: false, canAddBu: false, canEdit: false, canEditTime: false, canDelete: false, canClose: false };
export const MSG_FINAL = 'Tuần này đã chốt hẳn. Muốn sửa, hãy sửa trực tiếp trên Sheet.';
export const PERMISSIONS = {
  [WEEK_STATUS.CURRENT]: {
    normal: { canAdd: true, canAddBu: true, canEdit: true, canEditTime: true, canDelete: true, canClose: true },
    offset: { canAdd: true, canAddBu: true, canEdit: true, canEditTime: true, canDelete: true, canClose: true },
  },
  [WEEK_STATUS.PROVISIONAL]: {
    normal: { canAdd: false, canAddBu: true, canEdit: true, canEditTime: false, canDelete: false, canClose: true },
    offset: { canAdd: false, canAddBu: true, canEdit: true, canEditTime: true, canDelete: true, canClose: true },
  },
  [WEEK_STATUS.FINAL]: { normal: NO, offset: NO },
  [WEEK_STATUS.FUTURE]: { normal: NO, offset: NO },
};
// Lý do bị khóa: một câu dễ hiểu cho từng ô "không".
const REASONS = {
  [WEEK_STATUS.PROVISIONAL]: {
    canAdd: 'Tuần này đang tạm chốt: chỉ thêm được ca ghi bù (form sẽ tự gắn nhãn [OFFSET]).',
    canEditTime: 'Tuần này đang tạm chốt: ca thường chỉ sửa được chủ đề, hoạt động và ghi chú, không sửa ngày giờ.',
    canDelete: 'Tuần này đang tạm chốt: không xóa được ca thường, chỉ xóa được ca ghi bù.',
  },
  [WEEK_STATUS.FINAL]: null, // dùng MSG_FINAL cho mọi ô
  [WEEK_STATUS.FUTURE]: 'Ngày này chưa tới, chưa ghi được.',
};

export function permissions(status, { isOffset = false } = {}) {
  const row = PERMISSIONS[status]?.[isOffset ? 'offset' : 'normal'] ?? NO;
  const reasons = {};
  for (const [k, v] of Object.entries(row)) {
    if (v) continue;
    if (status === WEEK_STATUS.FINAL || !PERMISSIONS[status]) reasons[k] = MSG_FINAL;
    else if (status === WEEK_STATUS.FUTURE) reasons[k] = REASONS[WEEK_STATUS.FUTURE];
    else reasons[k] = REASONS[status]?.[k] ?? 'Không được phép ở tuần này.';
  }
  return { status, ...row, reasons };
}

// ---------------------------------------------------------------------------------------------
// 4. Đổi chữ từ form -> serial
// ---------------------------------------------------------------------------------------------
// Ô ngày nhập chữ "dd/mm/yyyy" (ví dụ 25/11/2026; chấp nhận cả 5/1/2026 và dạng máy "2026-11-25").
// Dùng ô chữ thay vì ô lịch của trình duyệt vì ô lịch hiển thị theo ngôn ngữ máy (có máy hiện mm/dd/yyyy, 12 giờ AM/PM).
// Trả về serial (số nguyên) hoặc null nếu sai.
export function parseDateInput(s) {
  const t = (s ?? '').trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return serialFromParts(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return serialFromParts(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}
function serialFromParts(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const s = serialFromYMD(y, m, d);
  const back = ymdFromSerial(s);
  return back.y === y && back.m === m && back.d === d ? s : null;
}
// Ô giờ nhập chữ 24 giờ "hh:mm" (08:40, 8:40; chấp nhận cả "8.40" và "0840").
// Trả về phần của ngày (08:40 = 520/1440) hoặc null.
export function parseTimeInput(s) {
  const t = (s ?? '').trim();
  const m = /^(\d{1,2})[:.h](\d{2})$/.exec(t) ?? /^(\d{2})(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return (h * 60 + mi) / 1440;
}
export const minutesOf = frac => Math.round(frac * 1440);
export const fmtTime = frac => {
  const t = minutesOf(frac);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
// "Bây giờ" theo giờ VN dưới dạng phần của ngày (để chặn giờ tương lai của hôm nay)
export function nowFraction(now = new Date(), timeZone = 'Asia/Ho_Chi_Minh') {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const g = t => Number(p.find(x => x.type === t).value);
  return (g('hour') * 60 + g('minute')) / 1440;
}

// ---------------------------------------------------------------------------------------------
// 5. Tiêu đề cột: form chỉ chạy khi A1:F1 đúng như Sheet hiện tại (phòng Sheet bị đổi cấu trúc)
// ---------------------------------------------------------------------------------------------
export const EXPECTED_HEADERS = ['Ngày', 'Bắt đầu', 'Kết thúc', 'Chủ đề', 'Hoạt động', 'Ghi chú (tùy chọn)'];
export function checkHeaders(headers) {
  const h = (headers ?? []).slice(0, 6).map(x => (typeof x === 'string' ? x.trim() : x));
  const bad = EXPECTED_HEADERS.filter((e, i) => h[i] !== e);
  return bad.length ? `Tiêu đề cột A1:F1 trong Sheet khác với app mong đợi (${EXPECTED_HEADERS.join(' | ')}). Đã dừng để không ghi sai cột.` : null;
}

// ---------------------------------------------------------------------------------------------
// 6. validateRow(input, context) -> { errors: [...], warnings: [...] }
//   errors   = lỗi CHẶN (không cho lưu); warnings = cảnh báo (vẫn cho lưu)
//   input  : { date, start, end, topic, activity, noteText, isOffset }  (date serial; start/end phần ngày hoặc null)
//   context: { mode: 'add'|'edit', today, nowFrac, topics: Map(topic->category), headers,
//              sessions: [...ca hiện có, dạng core.parseSessions], original (khi sửa: ca gốc), cfg }
// ---------------------------------------------------------------------------------------------
export const LONG_SESSION_MIN = 600; // > 10 tiếng -> cảnh báo

export function validateRow(input, ctx) {
  const errors = [], warnings = [];
  const cfg = ctx.cfg ?? CONFIG;
  const { date, start, end, topic, activity, noteText = '', isOffset = false } = input;
  const mode = ctx.mode ?? 'add';

  const hdr = checkHeaders(ctx.headers);
  if (hdr) errors.push(hdr);

  // --- Ngày
  if (!Number.isInteger(date)) { errors.push('Chưa chọn ngày (hoặc ngày không hợp lệ).'); return { errors, warnings }; }
  if (date < cfg.startDate) errors.push(`Ngày phải từ ${fmtDate(cfg.startDate)} trở đi.`);
  if (date > ctx.today) errors.push('Không ghi được ngày trong tương lai.');

  // --- Chủ đề, hoạt động
  const busy = topic === BUSY_TOPIC;
  const category = ctx.topics?.get(topic);
  const notStudy = busy || category === 'Không học';
  if (!topic) errors.push('Chưa chọn chủ đề.');
  else if (!ctx.topics?.has(topic)) warnings.push(`Chủ đề "${topic}" chưa có trong tab Chủ đề: ca sẽ tính vào "Chưa phân loại".`);
  if (!notStudy && !ACTIVITIES.includes(activity)) errors.push('Chưa chọn hoạt động.');
  if (activity && !ACTIVITIES.includes(activity)) errors.push(`Hoạt động "${activity}" không có trong danh sách.`);

  // --- Giờ
  if (Number.isNaN(start)) errors.push('Giờ bắt đầu chưa đúng dạng hh:mm (24 giờ, ví dụ 08:40).');
  if (Number.isNaN(end)) errors.push('Giờ kết thúc chưa đúng dạng hh:mm (24 giờ, ví dụ 21:15).');
  if (Number.isNaN(start) || Number.isNaN(end)) return { errors, warnings };
  const hasStart = typeof start === 'number', hasEnd = typeof end === 'number';
  if (!hasStart && hasEnd) errors.push('Có giờ kết thúc thì phải có giờ bắt đầu.');
  if (!hasStart && !hasEnd && !notStudy) errors.push('Chưa nhập giờ bắt đầu.');
  if (hasStart && (start < 0 || start >= 1)) errors.push('Giờ bắt đầu không hợp lệ.');
  if (hasEnd && (end < 0 || end >= 1)) errors.push('Giờ kết thúc không hợp lệ.');
  const dur = durationMin(start, end);
  if (dur === 0) errors.push('Giờ kết thúc trùng giờ bắt đầu (0 phút).');
  if (dur !== null && dur > LONG_SESSION_MIN) warnings.push(`Ca dài ${dur} phút (hơn 10 tiếng). Kiểm tra lại giờ có nhập nhầm không.`);
  if (hasStart && hasEnd && end < start) warnings.push(`Ca qua đêm: kết thúc ${fmtTime(end)} hôm sau, cả ${dur} phút tính vào ngày ${fmtDate(date)}.`);

  // Giờ tương lai: so mốc tuyệt đối (ngày + phần ngày), ca qua đêm thì giờ kết thúc sang ngày hôm sau
  if (hasStart && typeof ctx.nowFrac === 'number') {
    const nowAbs = ctx.today + ctx.nowFrac + 1e-9;
    const startAbs = date + start;
    const endAbs = hasEnd ? date + end + (end < start ? 1 : 0) : null;
    if (startAbs > nowAbs) errors.push('Giờ bắt đầu ở tương lai. Chỉ ghi giờ thật đã diễn ra.');
    else if (endAbs !== null && endAbs > nowAbs) errors.push('Giờ kết thúc ở tương lai. Nếu ca chưa xong, để trống giờ kết thúc.');
  }

  // --- Quyền theo tuần (tính bằng "today" lúc gọi: UI gọi lại ngay khi bấm Lưu)
  const status = weekStatusOfDate(date, ctx.today, cfg);
  if (mode === 'add') {
    const p = permissions(status);
    if (isOffset && !p.canAddBu) errors.push(p.reasons.canAddBu);
    if (!isOffset && !p.canAdd) errors.push(p.reasons.canAdd);
  } else {
    errors.push(...checkEdit(input, ctx.original, ctx.today, cfg));
  }
  // Ca đang mở (chưa có giờ kết thúc) chỉ ở tuần Đang diễn ra
  if (hasStart && !hasEnd && status !== WEEK_STATUS.CURRENT && !(mode === 'edit' && sameTimes(input, ctx.original)))
    errors.push('Ca chưa có giờ kết thúc chỉ lưu được ở tuần đang diễn ra.');
  // Người dùng tự gõ "[OFFSET]" vào ô ghi chú thay vì dùng ô tick
  if (isOffsetNote(noteText)) errors.push('Không gõ "[OFFSET]" vào ghi chú. Dùng ô tick "ca ghi bù".');

  // --- Trùng giờ với ca khác (chỉ cảnh báo)
  if (hasStart) {
    for (const o of overlaps(input, ctx.sessions ?? [], ctx.original?.rowNumber))
      warnings.push(`Trùng giờ với ca dòng ${o.rowNumber} (${fmtDate(o.date)} ${fmtTime(o.start)}–${o.end === null ? '…' : fmtTime(o.end)}).`);
  }
  return { errors: [...new Set(errors)], warnings };
}

const sameTimes = (a, b) => !!b && a.date === b.date && eqT(a.start, b.start) && eqT(a.end, b.end);
const eqT = (x, y) => (x ?? null) === null ? (y ?? null) === null : (y ?? null) !== null && minutesOf(x) === minutesOf(y);

// Kiểm tra một lần sửa so với ca gốc. Trả về danh sách lỗi chặn.
export function checkEdit(input, original, today, cfg = CONFIG) {
  const errors = [];
  if (!original) return ['Không tìm thấy ca gốc để sửa.'];
  const wasOffset = isOffsetNote(original.note);
  const status = weekStatusOfDate(original.date, today, cfg);
  const p = permissions(status, { isOffset: wasOffset });
  if (!p.canEdit) return [p.reasons.canEdit];
  if (!!input.isOffset !== wasOffset)
    errors.push(wasOffset ? 'Không bỏ được nhãn ca ghi bù khi sửa.' : 'Không thêm được nhãn ca ghi bù khi sửa. Muốn ghi bù, hãy thêm ca mới.');
  if (!sameTimes(input, original)) {
    if (!p.canEditTime && p.canClose && isClosing(input, original)) {
      // Đóng ca ở tuần Tạm chốt: chỉ được điền giờ kết thúc, mọi trường khác giữ nguyên
      if (!onlyEndFilled(input, original)) errors.push(MSG_CLOSE_ONLY);
    } else if (!p.canEditTime) errors.push(p.reasons.canEditTime);
    else if (weekNo(input.date, cfg) !== weekNo(original.date, cfg))
      errors.push('Không đổi được ngày của ca sang tuần khác.');
  }
  return errors;
}

// Đóng ca = dòng gốc chưa có giờ kết thúc, bản sửa có giờ kết thúc
export const MSG_CLOSE_ONLY = 'Tuần này đang tạm chốt: khi đóng ca chỉ điền giờ kết thúc, không sửa ngày, giờ bắt đầu, chủ đề, hoạt động hay ghi chú cùng lúc.';
const isClosing = (input, original) => (original.end ?? null) === null && typeof input.end === 'number';
const onlyEndFilled = (input, original) =>
  input.date === original.date && eqT(input.start, original.start) && (input.topic ?? '') === (original.topic ?? '') &&
  (input.activity ?? '') === (original.activity ?? '') && (input.noteText ?? '') === splitNote(original.note).text &&
  !!input.isOffset === isOffsetNote(original.note);

// Ca nào trùng giờ với input (khoảng [bắt đầu, kết thúc) tuyệt đối; ca mở coi như kéo tới hết ngày)
export function overlaps(input, sessions, skipRow) {
  const span = s => {
    if (typeof s.start !== 'number') return null;
    const a = s.date + (s.start % 1);
    const b = typeof s.end === 'number' ? s.date + (s.end % 1) + ((s.end % 1) < (s.start % 1) ? 1 : 0) : s.date + 1;
    return [a, b];
  };
  const me = span(input);
  if (!me) return [];
  return sessions.filter(s => s.rowNumber !== skipRow && Math.abs(s.date - input.date) <= 1)
    .filter(s => { const o = span(s); return o && o[0] < me[1] - 1e-9 && me[0] < o[1] - 1e-9; });
}

// Kiểm tra trước khi xóa
export function checkDelete(original, today, cfg = CONFIG) {
  const p = permissions(weekStatusOfDate(original.date, today, cfg), { isOffset: isOffsetNote(original.note) });
  return p.canDelete ? [] : [p.reasons.canDelete];
}
