// form.js — Giao diện thêm / sửa / xóa ca học (L4) và quy trình ghi an toàn vào Google Sheet.
// Luật nằm ở rules.js (thuần, có test); phần ghi thuần ở write-core.js; gọi Google ở sheets-write.js.
// Ở đây chỉ: vẽ danh sách ca + form, đọc dữ liệu form, chạy các bước ghi theo thứ tự và báo kết quả.
// Không lưu gì vào localStorage / IndexedDB: dữ liệu form chỉ nằm trong bộ nhớ trang.
import { WEEK_STATUS, ACTIVITIES, CATEGORIES, WEEKDAY_NAMES, weekday, weekNo, weekStart, weekEnd, fmtDate, todaySerial, durationMin } from './core.js';
import {
  permissions, weekStatusOfDate, validateRow, checkDelete, splitNote, composeNote, isOffsetNote,
  parseDateInput, parseTimeInput, fmtTime, nowFraction, MSG_FINAL, OFFSET_LABEL,
} from './rules.js';
import { serializeRow, snapshotCompare, verifyReadback, isEmptyRow } from './write-core.js';
import {
  signIn, hasValidToken, tokenInfo, readHeaders, readRowAF, findFirstEmptyRow, writeRow, clearRow,
} from './sheets-write.js';
import { esc } from './ui-charts.js';
import { mochiSvg, jump } from './mochi.js';
import { catStyle } from './ui-config.js';
import { fmtHM } from './format.js';

const $ = id => document.getElementById(id);
const ymdInput = s => fmtDate(s); // ô ngày là ô chữ dd/mm/yyyy
const timeInput = f => (typeof f === 'number' ? fmtTime(f % 1) : '');
const err = (code, message, extra) => Object.assign(new Error(message), { code, ...extra });

// ---------------------------------------------------------------------------------------------
// Trạng thái của phần form (chỉ trong bộ nhớ)
// ---------------------------------------------------------------------------------------------
let app = null;          // { getModel(), reload(), onListWeek(w) } do app.js cung cấp
let enabled = false;     // form bật (false: chế độ xem mẫu / chỉ đọc -> danh sách ca không có nút)
let listWeek = null;     // tuần đang xem trong danh sách ca
let editing = null;      // { mode: 'add'|'edit', original, snapshot, rowNumber }
let busy = false;        // đang gửi -> chặn bấm đúp
let pending = null;      // lần ghi "chưa chắc đã lưu": { kind, rowNumber, sent, snapshot }
let lastDeleted = null;  // ca vừa xóa, để "Hoàn tác" trong 5 phút: { session, rowNumber, values, until } — CHỈ trong bộ nhớ trang
const UNDO_MS = 5 * 60 * 1000;

export function initForm(appApi, { enabled: on, disabledReason }) {
  app = appApi;
  enabled = on;
  $('ca-list').addEventListener('click', e => { // chạm vào ca: nhân vật trong ô trống nhảy (chỉ trang trí)
    if (e.target.closest('.empty-week')) jump(e.target.closest('.empty-week'));
  });
  if (!enabled) {
    $('ca-disabled').hidden = false;
    $('ca-disabled').textContent = disabledReason;
    $('ca-tools').hidden = true;
    $('signin-card').hidden = true;
    return;
  }
  $('ca-signin').addEventListener('click', () => doSignIn());
  $('ca-add').addEventListener('click', () => openForm({ mode: 'add' }));
  $('ca-list').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    const s = app.getModel().sessions.find(x => x.rowNumber === Number(b.dataset.row));
    if (!s) return;
    if (b.dataset.act === 'edit') openForm({ mode: 'edit', original: s });
    if (b.dataset.act === 'finish') openForm({ mode: 'edit', original: s, finish: true });
    if (b.dataset.act === 'delete') openDelete(s);
  });
  const f = $('ca-form');
  f.addEventListener('input', refreshForm);
  f.addEventListener('change', refreshForm);
  f.addEventListener('submit', e => { e.preventDefault(); save(); });
  $('f-cancel').addEventListener('click', () => closeForm());
  $('del-cancel').addEventListener('click', () => $('del-dialog').close());
  $('del-ok').addEventListener('click', () => doDelete());
  $('ca-msg').addEventListener('click', e => {
    const b = e.target.closest('button[data-do]');
    if (b) actions[b.dataset.do]?.();
  });
  $('ca-result').addEventListener('click', e => {
    const b = e.target.closest('button[data-do]');
    if (b) actions[b.dataset.do]?.();
  });
  $('del-msg').addEventListener('click', e => {
    const b = e.target.closest('button[data-do]');
    if (b) actions[b.dataset.do]?.();
  });
  setInterval(renderSignin, 30_000);
}

// Gọi mỗi lần app.js tải xong dữ liệu
export function onModel() {
  if (!app) return;
  const m = app.getModel();
  const cur = weekNo(m.stats.today);
  if (listWeek === null || listWeek > cur) listWeek = cur;
  if (enabled) renderSignin();
  renderList();
}

// L4.5: chọn tuần bằng nút ‹ › hoặc chạm ô heatmap ở tab Lịch (thay ô chọn tuần cũ)
export const getListWeek = () => listWeek;
export function setListWeek(w) {
  if (!app) return;
  const cur = weekNo(app.getModel().stats.today);
  listWeek = Math.max(1, Math.min(cur, w));
  renderList();
}

// L4.5: lối tắt từ trang Hôm nay. Chỉ MỞ form như khi bấm nút trong danh sách ca; luồng lưu không đổi.
export const formEnabled = () => !!app && !$('ca-tools').hidden;
export function openAddCurrentWeek() {
  if (!formEnabled() || busy) return false;
  listWeek = weekNo(app.getModel().stats.today); // thêm ca mặc định vào tuần đang diễn ra
  onModel();
  openForm({ mode: 'add' });
  return true;
}
export function openFinish(rowNumber) {
  if (!formEnabled() || busy) return false;
  const s = app.getModel().sessions.find(x => x.rowNumber === rowNumber);
  if (!s || !s.open || weekStatusOfDate(s.date, currentToday()) !== WEEK_STATUS.CURRENT) return false; // giống điều kiện nút "Kết thúc ca" trong danh sách
  listWeek = weekNo(s.date);
  onModel();
  openForm({ mode: 'edit', original: s, finish: true });
  return true;
}

// ---------------------------------------------------------------------------------------------
// Đăng nhập
// ---------------------------------------------------------------------------------------------
function renderSignin() {
  const t = tokenInfo();
  const ok = hasValidToken();
  $('ca-signin-state').textContent = ok
    ? `Đã đăng nhập Google · còn khoảng ${Math.max(1, Math.round(t.secondsLeft / 60))} phút`
    : 'Chưa đăng nhập Google: cần đăng nhập để lưu (xem và tải số liệu thì không cần).';
  $('ca-signin').textContent = ok ? 'Đăng nhập lại' : 'Đăng nhập Google';
  // L4.5: dòng Google ở Cài đặt dùng cùng trạng thái
  if ($('set-signin-state')) { $('set-signin-state').textContent = $('ca-signin-state').textContent; $('set-signin').textContent = $('ca-signin').textContent; }
}
async function doSignIn() {
  try {
    await signIn();
    renderSignin();
    if (!$('ca-result').hidden && $('ca-result').classList.contains('error')) showMsg($('ca-result'), null); // xóa báo lỗi đăng nhập cũ
    return true;
  } catch (e) {
    showMsg(currentMsgBox(), 'error', signinError(e));
    return false;
  }
}
function signinError(e) {
  if (e.code === 'POPUP_popup_closed') return 'Cửa sổ đăng nhập Google đã bị đóng trước khi xong. Chưa ghi gì; dữ liệu form vẫn giữ. Bấm "Đăng nhập Google" để thử lại.';
  if (e.code === 'POPUP_popup_failed_to_open') return 'Trình duyệt chặn cửa sổ đăng nhập Google. Hãy cho phép cửa sổ bật lên (popup) cho trang này rồi bấm lại.';
  if (e.code === 'AUTH_access_denied') return 'Bạn đã từ chối cấp quyền cho app. Chưa ghi gì.';
  if (e.code === 'AUTH_SCOPE') return 'Bạn chưa tick quyền chỉnh sửa Google Sheets khi đăng nhập. Bấm đăng nhập lại và tick ô đó.';
  return `Đăng nhập Google chưa được: ${e.message}`;
}

// ---------------------------------------------------------------------------------------------
// Danh sách ca của 1 tuần, kèm nút Sửa / Xóa / Kết thúc ca và lý do khi bị khóa
// ---------------------------------------------------------------------------------------------
function renderList() {
  const m = app.getModel();
  const today = m.stats.today;
  const w = m.stats.weeks.find(x => x.week === listWeek);
  const status = w.status;
  const pAdd = permissions(status);
  // Dải trạng thái tuần
  const rule = {
    [WEEK_STATUS.CURRENT]: 'Thêm, sửa, xóa được mọi trường (ngày phải nằm trong tuần này, không sau hôm nay).',
    [WEEK_STATUS.PROVISIONAL]: `Chỉ thêm được ca ghi bù (tự gắn nhãn ${OFFSET_LABEL}). Ca thường: chỉ sửa chủ đề, hoạt động, ghi chú. Ca ghi bù: sửa, xóa mọi trường.`,
    [WEEK_STATUS.FINAL]: MSG_FINAL,
  }[status] ?? '';
  $('ca-strip').className = `state-strip s-${statusKey(status)}`;
  $('ca-strip').innerHTML = `<span class="kao">${STATUS_KAO[statusKey(status)]}</span><span><b>${esc(status)}</b>${esc(rule)}</span>`;
  // Nút thêm: tuần không cho thêm thì ẩn nút, ghi lý do
  const canAdd = pAdd.canAdd || pAdd.canAddBu;
  $('ca-add').disabled = !canAdd;
  $('ca-add-wrap').hidden = !canAdd;
  $('ca-add').textContent = pAdd.canAdd ? '＋ Thêm ca' : '＋ Thêm ca ghi bù';
  $('ca-add-why').textContent = canAdd ? '' : pAdd.reasons.canAddBu;
  $('ca-add-why').hidden = canAdd || status === WEEK_STATUS.FINAL; // tuần chốt hẳn: dải trạng thái đã ghi lý do

  const list = m.sessions.filter(s => s.date >= w.start && s.date <= w.end).sort((a, b) => a.date - b.date || (a.start ?? 0) - (b.start ?? 0) || a.rowNumber - b.rowNumber);
  if (app.onListWeek) app.onListWeek(listWeek);
  if (!list.length) { $('ca-list').innerHTML = `<div class="empty-week">${mochiSvg()}<p>Tuần này chưa có ca nào.</p></div>`; return; }
  // Gom theo ngày; mỗi ca: giờ, thời lượng, nhóm/chủ đề, hoạt động, nhãn ghi bù / đang mở, ghi chú.
  // Theo ý Oriana (26/11/2026): ẩn số dòng Sheet trong danh sách (vẫn ghi ở hộp xóa và thông báo kết quả).
  // Nút chỉ hiện khi luật tuần cho phép (permissions() của rules.js, không đổi); dải trạng thái ghi luật.
  let h = '', lastDay = null;
  for (const s of list) {
    if (s.date !== lastDay) {
      lastDay = s.date;
      const dayMin = list.filter(x => x.date === s.date && x.duration !== null).reduce((a, x) => a + x.duration, 0);
      h += `<div class="day-h">${WEEKDAY_NAMES[weekday(s.date)]} ${fmtDate(s.date).slice(0, 5)}<span>${fmtHM(dayMin)}</span></div>`;
    }
    const off = isOffsetNote(s.note);
    const p = permissions(status, { isOffset: off });
    const note = splitNote(s.note).text;
    const time = s.start === null ? 'không có giờ' : `${fmtTime(s.start)}–${s.end === null ? '…' : fmtTime(s.end)}`;
    const canFinish = s.open && status === WEEK_STATUS.CURRENT;
    const cs = catStyle(s.category);
    const btns = !enabled ? '' : [
      canFinish ? `<button type="button" class="btn3d small" data-act="finish" data-row="${s.rowNumber}">Kết thúc ca</button>` : '',
      p.canEdit ? `<button type="button" class="btn3d small ghost" data-act="edit" data-row="${s.rowNumber}">Sửa</button>` : '',
      p.canDelete ? `<button type="button" class="btn3d small ghost" data-act="delete" data-row="${s.rowNumber}">Xóa</button>` : '',
    ].join('');
    h += `<div class="sess"><div>
        <div class="t">${time}${s.duration !== null ? ` <span>${fmtHM(s.duration)}</span>` : ''}</div>
        <div class="meta"><span class="chip ${cs.cls}">${cs.kao ? `${cs.kao} ` : ''}${esc(s.topic ?? '')}</span>${s.activity ? `<span>${esc(s.activity)}</span>` : ''}${off ? '<span class="mini off">ghi bù</span>' : ''}${s.open ? '<span class="mini open">đang mở</span>' : ''}</div>
        ${note ? `<p class="snote">${esc(note)}</p>` : ''}</div>
      <div class="btns">${btns}</div></div>`;
  }
  $('ca-list').innerHTML = h;
}
const STATUS_KAO = { cur: '(＾▽＾)', prov: '(•ω•)', final: '(˘ω˘)' };
const statusKey = s => ({ [WEEK_STATUS.CURRENT]: 'cur', [WEEK_STATUS.PROVISIONAL]: 'prov', [WEEK_STATUS.FINAL]: 'final' }[s] ?? 'final');

// ---------------------------------------------------------------------------------------------
// Form thêm / sửa
// ---------------------------------------------------------------------------------------------
function fillTopics(selected) {
  const m = app.getModel();
  const groups = {};
  for (const [t, c] of m.topics) (groups[c] ??= []).push(t);
  const order = [...CATEGORIES, ...Object.keys(groups).filter(c => !CATEGORIES.includes(c))];
  let h = '<option value="">— chọn chủ đề —</option>';
  for (const c of order) if (groups[c]) h += `<optgroup label="${esc(c)}">${groups[c].map(t => `<option ${t === selected ? 'selected' : ''}>${esc(t)}</option>`).join('')}</optgroup>`;
  if (selected && !m.topics.has(selected)) h += `<option selected>${esc(selected)}</option>`; // chủ đề cũ không còn trong bảng
  $('f-topic').innerHTML = h;
  $('f-activity').innerHTML = '<option value="">— chọn hoạt động —</option>' + ACTIVITIES.map(a => `<option>${a}</option>`).join('');
}

function openForm({ mode, original = null, finish = false }) {
  if (busy) return;
  const m = app.getModel();
  const today = currentToday();
  pending = null;
  editing = { mode, original, rowNumber: original?.rowNumber ?? null, snapshot: original ? [...original.raw] : null };
  fillTopics(original?.topic ?? '');
  $('f-title').textContent = mode === 'add' ? 'Thêm ca học' : `Sửa ca · dòng ${original.rowNumber}`;
  const wk = m.stats.weeks.find(w => w.week === listWeek);
  if (mode === 'add') {
    // Mặc định: tuần đang xem. Tuần Đang diễn ra -> hôm nay; Tạm chốt -> ngày cuối của tuần đó.
    const d = wk.status === WEEK_STATUS.CURRENT ? today : wk.end;
    $('f-date').value = ymdInput(d);
    $('f-start').value = ''; $('f-end').value = '';
    $('f-activity').value = ''; $('f-note').value = '';
    $('f-offset').checked = wk.status === WEEK_STATUS.PROVISIONAL;
  } else {
    const { isOffset, text } = splitNote(original.note);
    $('f-date').value = ymdInput(original.date);
    $('f-start').value = timeInput(original.start);
    $('f-end').value = finish ? fmtTime(nowFraction()) : timeInput(original.end);
    $('f-activity').value = original.activity ?? '';
    $('f-note').value = text;
    $('f-offset').checked = isOffset;
  }
  // Gợi ý khoảng ngày hợp lệ: trong tuần của ca (sửa) / tuần đang xem (thêm), không sau hôm nay
  const w = mode === 'add' ? wk.week : weekNo(original.date);
  $('f-date-hint').textContent = `dd/mm/yyyy, từ ${fmtDate(weekStart(w))} đến ${fmtDate(Math.min(weekEnd(w), today))}`;
  showMsg($('ca-msg'), null);
  setBusy(false);
  refreshForm();
  $('f-dialog').showModal();
  if (finish) $('f-end').focus();
}
function closeForm() {
  if (busy) return; // đang gửi thì không đóng, tránh mất kết quả
  $('f-dialog').close();
  editing = null; pending = null;
}
const currentToday = () => todaySerial(); // luôn là hôm nay thật (giờ VN); form bị tắt khi giả lập ngày

// Đọc form -> input của validateRow
function readForm() {
  return {
    date: parseDateInput($('f-date').value),
    start: timeField('f-start'),
    end: timeField('f-end'),
    topic: $('f-topic').value,
    activity: $('f-activity').value,
    noteText: $('f-note').value,
    isOffset: $('f-offset').checked,
  };
}
// Ô giờ: trống -> null; gõ sai -> NaN (để báo lỗi "không hợp lệ" thay vì coi như trống)
function timeField(id) {
  const v = $(id).value.trim();
  if (!v) return null;
  return parseTimeInput(v) ?? NaN;
}
function context() {
  const m = app.getModel();
  return {
    mode: editing.mode, original: editing.original, today: currentToday(), nowFrac: nowFraction(),
    topics: m.topics, sessions: m.sessions, headers: m.headers,
  };
}

// Cập nhật dải trạng thái tuần, khóa trường, xem trước ghi chú, lỗi/cảnh báo mỗi khi gõ
function refreshForm() {
  if (!editing) return;
  const input = readForm();
  const today = currentToday();
  const date = input.date ?? editing.original?.date ?? today;
  const status = weekStatusOfDate(editing.mode === 'edit' ? editing.original.date : date, today);
  const isOff = editing.mode === 'edit' ? isOffsetNote(editing.original.note) : input.isOffset;
  const p = permissions(status, { isOffset: isOff });
  // Dải trạng thái tuần ngay trên form
  $('f-strip').className = `strip s-${statusKey(status)}`;
  $('f-strip').innerHTML = `<b>Tuần ${weekNo(date)} · ${status}</b> ` + esc(
    status === WEEK_STATUS.FINAL ? MSG_FINAL
      : status === WEEK_STATUS.PROVISIONAL
        ? (editing.mode === 'add' ? `Tuần tạm chốt: ca thêm vào là ca ghi bù, tự gắn nhãn ${OFFSET_LABEL}.` : (isOff ? 'Ca ghi bù: sửa được mọi trường, ngày phải trong tuần này.' : p.reasons.canEditTime))
        : 'Tuần đang diễn ra: sửa được mọi trường.');
  // Khóa ngày/giờ khi không được sửa giờ (ca thường ở tuần Tạm chốt), kèm lý do
  const lockTime = editing.mode === 'edit' && !p.canEditTime;
  for (const id of ['f-date', 'f-start', 'f-end']) $(id).disabled = lockTime;
  $('f-time-why').hidden = !lockTime;
  $('f-time-why').textContent = lockTime ? p.reasons.canEditTime : '';
  // Ô tick ghi bù: thêm ở tuần Tạm chốt -> bắt buộc; khi sửa -> không đổi được (Q6a)
  const addProv = editing.mode === 'add' && weekStatusOfDate(date, today) === WEEK_STATUS.PROVISIONAL;
  if (addProv) $('f-offset').checked = true;
  $('f-offset').disabled = editing.mode === 'edit' || addProv;
  $('f-offset-why').textContent = editing.mode === 'edit'
    ? 'Khi sửa ca không đổi được nhãn ghi bù. Muốn ghi bù, hãy thêm ca mới.'
    : addProv ? 'Tuần tạm chốt chỉ nhận ca ghi bù.' : 'Không bắt buộc ở tuần đang diễn ra.';
  // Xem trước đúng nội dung cột F sẽ lưu
  const note = composeNote($('f-offset').checked, input.noteText);
  $('f-note-preview').innerHTML = `Ô "Ghi chú" (cột F) sẽ lưu: <code>${note ? esc(note) : '(trống)'}</code>`;
  // Thời lượng
  const dur = durationMin(input.start, input.end);
  $('f-dur').textContent = dur === null ? (input.start !== null && input.end === null ? 'Chưa có giờ kết thúc: lưu thành ca đang mở (không tính phút).' : '') : `Thời lượng: ${dur} phút`;
  // Lỗi / cảnh báo
  const v = validateRow(readFormForValidate(input), context());
  $('f-errors').innerHTML = v.errors.map(e => `<li>${esc(e)}</li>`).join('');
  $('f-warnings').innerHTML = v.warnings.map(e => `<li>${esc(e)}</li>`).join('');
  $('f-save').disabled = busy || v.errors.length > 0;
  return v;
}
// Trường bị khóa (disabled) vẫn lấy giá trị gốc
function readFormForValidate(input) {
  if (editing.mode === 'edit' && $('f-date').disabled) {
    const o = editing.original;
    return { ...input, date: o.date, start: o.start, end: o.end };
  }
  return input;
}

function setBusy(b) {
  busy = b;
  $('f-save').disabled = b;
  $('f-cancel').disabled = b;
  $('del-ok').disabled = b;
  $('del-cancel').disabled = b;
  $('f-save').textContent = b ? 'Đang lưu…' : 'Lưu';
  $('del-ok').textContent = b ? 'Đang xóa…' : 'Xóa nội dung dòng';
}

// ---------------------------------------------------------------------------------------------
// Lưu: các bước theo thứ tự, mỗi bước có thể dừng mà không mất dữ liệu form
// ---------------------------------------------------------------------------------------------
async function save() {
  if (busy || !editing) return; // chống bấm đúp
  const box = $('ca-msg');
  // 1. Kiểm tra lại với "hôm nay" và giờ hiện tại ngay lúc bấm (Q2)
  const v = refreshForm();
  if (v.errors.length) return;
  setBusy(true); // khóa NGAY, trước mọi bước chờ (kể cả chờ đăng nhập), để bấm đúp không chạy 2 lần
  if (!hasValidToken()) {
    showMsg(box, 'info', 'Cần đăng nhập Google trước khi lưu. Cửa sổ đăng nhập sẽ mở; dữ liệu form vẫn giữ.');
    if (!(await doSignIn())) { setBusy(false); refreshForm(); return; }
  }
  const input = readFormForValidate(readForm());
  const sent = serializeRow(input);
  let phase = 'read', rowNumber = editing.rowNumber;
  try {
    // 2. Tiêu đề cột vẫn đúng
    const headers = await readHeaders();
    app.getModel().headers = headers;
    const v2 = validateRow(input, context());
    if (v2.errors.length) throw err('RULE', v2.errors.join(' '));
    let lowWarning = null;
    if (editing.mode === 'add') {
      // 3a. Tìm dòng trống (trong 2..1002); writeRow tự kiểm tra lại dòng còn trống ngay trước khi ghi
      const r = await findFirstEmptyRow();
      rowNumber = r.row; lowWarning = r.warning;
    } else {
      // 3b. Sửa: dòng trong Sheet phải giống ảnh chụp lúc mở form
      const cur = await readRowAF(rowNumber);
      const d = snapshotCompare(editing.snapshot, cur.raw);
      if (!d.same) throw err('CHANGED', changedText(rowNumber, d));
    }
    // 4. Ghi
    phase = 'write';
    pending = { kind: editing.mode, rowNumber, sent, snapshot: editing.snapshot };
    await writeRow(rowNumber, sent, { mustBeEmpty: editing.mode === 'add' });
    // 5. Đọc lại và đối chiếu
    phase = 'verify';
    await finishWrite(box, rowNumber, sent, lowWarning);
  } catch (e) {
    setBusy(false);
    handleError(box, e, phase);
    refreshForm();
  }
}

async function finishWrite(box, rowNumber, sent, lowWarning) {
  const back = await readRowAF(rowNumber);
  const rv = verifyReadback(sent, back.raw, back.formatted);
  if (!rv.ok) throw err('READBACK', `Đã gửi lệnh ghi nhưng dòng ${rowNumber} đọc lại không khớp: ${rv.errors.join('; ')}. Hãy mở Sheet kiểm tra dòng này.`);
  pending = null;
  await app.reload();
  const seen = app.getModel().sessions.find(s => s.rowNumber === rowNumber);
  const extra = [...rv.warnings, lowWarning].filter(Boolean);
  if (!seen) extra.push('Số liệu trên trang chưa thấy dòng mới (Sheet có thể cập nhật chậm vài giây). Bấm "Tải lại" ở đầu trang sau ít giây.');
  setBusy(false);
  $('f-dialog').close();
  editing = null;
  showMsg($('ca-result'), extra.length ? 'warn' : 'ok', `Đã lưu vào dòng ${rowNumber} và đọc lại thấy đúng. Số liệu đã làm mới.` + (extra.length ? ' ' + extra.join(' ') : ''));
}

function changedText(rowNumber, d) {
  const cols = d.diffs.map(x => `cột ${x.col}: lúc mở form là ${JSON.stringify(x.before)}, bây giờ là ${JSON.stringify(x.after)}`).join('; ');
  return `Dòng ${rowNumber} đã bị thay đổi ở nơi khác kể từ lúc app tải dữ liệu (${cols}). Chưa ghi gì.`;
}

// ---------------------------------------------------------------------------------------------
// Lỗi: nói rõ đã ghi hay chưa; không tự thử lại
// ---------------------------------------------------------------------------------------------
function handleError(box, e, phase) {
  renderSignin(); // lỗi 401 / hết hạn làm mất token: cập nhật dòng "Đã đăng nhập"
  const keep = ' Dữ liệu trong form vẫn giữ nguyên.';
  const uncertain = phase === 'write' && ['TIMEOUT', 'NETWORK', 'OFFLINE'].includes(e.code);
  if (uncertain) {
    return showMsg(box, 'warn', `Chưa chắc đã lưu: ${e.message}. App KHÔNG tự gửi lại. Bấm "Kiểm tra trong Sheet" để app đọc lại dòng ${pending.rowNumber} xem ca đã vào chưa.`,
      [['check', 'Kiểm tra trong Sheet']]);
  }
  if (phase === 'verify' && e.code !== 'READBACK') {
    return showMsg(box, 'warn', `Lệnh ghi đã được Google nhận, nhưng bước đọc lại bị lỗi (${e.message}). Bấm "Kiểm tra trong Sheet".`, [['check', 'Kiểm tra trong Sheet']]);
  }
  pending = phase === 'write' ? pending : null;
  switch (e.code) {
    case 'NO_TOKEN': case 'TOKEN_EXPIRED': case 'HTTP_401':
      return showMsg(box, 'error', `Phiên đăng nhập Google đã hết hạn hoặc bị thu hồi. ${phase === 'write' ? 'Lệnh ghi bị Google từ chối nên chưa ghi gì.' : 'Chưa ghi gì.'} Bấm "Đăng nhập lại", rồi bấm Lưu lần nữa.` + keep, [['signin', 'Đăng nhập lại']]);
    case 'CHANGED':
      return showMsg(box, 'error', e.message + ' Bấm "Tải lại dữ liệu" để xem bản mới nhất rồi mở form lại.', [['reload', 'Tải lại dữ liệu']]);
    case 'NOT_EMPTY':
      return showMsg(box, 'error', `${e.message} (có thể vừa được ghi từ thiết bị khác). Chưa ghi gì. Bấm Lưu lần nữa để app tìm dòng trống khác.` + keep);
    case 'FULL': case 'GUARD': case 'RANGE': case 'RULE': case 'READBACK':
      return showMsg(box, 'error', e.message + (e.code === 'READBACK' ? '' : keep));
    case 'OFFLINE': case 'NETWORK': case 'TIMEOUT':
      return showMsg(box, 'error', `Không liên lạc được Google trước khi ghi (${e.message}). Chưa ghi gì. Kiểm tra mạng rồi bấm Lưu lần nữa.` + keep);
    default:
      return showMsg(box, 'error', `Google báo lỗi: ${e.message}. ${phase === 'write' ? 'Hãy bấm "Kiểm tra trong Sheet".' : 'Chưa ghi gì.'}` + keep, phase === 'write' ? [['check', 'Kiểm tra trong Sheet']] : []);
  }
}

// Sau "chưa chắc đã lưu": chỉ ĐỌC lại dòng, rồi cho người dùng chọn
async function checkPending() {
  if (!pending || busy) return;
  const box = currentMsgBox();
  const { kind, rowNumber, sent, snapshot } = pending;
  setBusy(true);
  try {
    const cur = await readRowAF(rowNumber);
    setBusy(false);
    const target = kind === 'delete' ? [] : sent;
    if (snapshotCompare(target, cur.raw).same) {
      pending = null;
      if (kind === 'delete') { $('del-dialog').close(); await app.reload(); return showMsg($('ca-result'), 'ok', `Đã kiểm tra: nội dung dòng ${rowNumber} đã được xóa. Số liệu đã làm mới.`); }
      setBusy(true);
      return await finishWrite(box, rowNumber, sent, null);
    }
    const notSaved = kind === 'add' ? isEmptyRow(cur.raw) : snapshotCompare(snapshot, cur.raw).same;
    if (notSaved) {
      pending = null;
      return showMsg(box, 'info', `Đã kiểm tra: dòng ${rowNumber} CHƯA thay đổi, tức là chưa lưu. ${kind === 'delete' ? 'Bấm "Xóa nội dung dòng" nếu vẫn muốn xóa.' : 'Dữ liệu form vẫn còn; bấm Lưu nếu muốn gửi lại.'}`);
    }
    pending = null;
    showMsg(box, 'error', `Đã kiểm tra: dòng ${rowNumber} có dữ liệu khác với cả bản cũ lẫn bản vừa gửi (có thể bị sửa từ nơi khác). Chưa làm gì thêm. Bấm "Tải lại dữ liệu" và kiểm tra Sheet.`, [['reload', 'Tải lại dữ liệu']]);
  } catch (e) {
    setBusy(false);
    renderSignin();
    showMsg(box, 'error', `Chưa đọc lại được Sheet (${e.message}). Thử bấm "Kiểm tra trong Sheet" lần nữa khi có mạng.`, [['check', 'Kiểm tra trong Sheet'], ...(e.code === 'HTTP_401' || e.code === 'TOKEN_EXPIRED' || e.code === 'NO_TOKEN' ? [['signin', 'Đăng nhập lại']] : [])]);
  }
}

// ---------------------------------------------------------------------------------------------
// Hoàn tác xóa (trong 5 phút, cùng phiên trang): ghi lại đúng giá trị cũ vào đúng dòng cũ,
// chỉ khi dòng đó vẫn trống và luật tuần hiện tại vẫn cho xóa (= cho khôi phục) ca này.
// ---------------------------------------------------------------------------------------------
let undoTimer = null;
function showUndo(rowNumber) {
  showMsg($('ca-result'), 'ok', `Đã xóa nội dung dòng ${rowNumber} (cột A–F; công thức G–K vẫn giữ). Số liệu đã làm mới. Có thể hoàn tác trong 5 phút, nếu chưa tải lại trang.`, [['undo', 'Hoàn tác']]);
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    if (!lastDeleted) return;
    lastDeleted = null;
    const b = $('ca-result').querySelector('button[data-do=undo]');
    if (b) showMsg($('ca-result'), 'info', `Đã hết 5 phút, không hoàn tác được việc xóa dòng ${rowNumber} từ app nữa (vẫn lấy lại được bằng lịch sử phiên bản của Sheet).`);
  }, UNDO_MS);
}
async function undoDelete() {
  const box = $('ca-result');
  if (busy) return;
  if (!lastDeleted || Date.now() > lastDeleted.until) { lastDeleted = null; return showMsg(box, 'error', 'Đã hết thời gian hoàn tác (5 phút).'); }
  const { session, rowNumber, values } = lastDeleted;
  const why = checkDelete(session, currentToday()); // tuần đã chuyển trạng thái thì không khôi phục
  if (why.length) { lastDeleted = null; return showMsg(box, 'error', `Không hoàn tác được: ${why[0]}`); }
  setBusy(true);
  if (!hasValidToken()) {
    showMsg(box, 'info', 'Cần đăng nhập Google để hoàn tác.', [['undo', 'Hoàn tác']]);
    if (!(await doSignIn())) { setBusy(false); return; }
  }
  try {
    pending = null;
    await writeRow(rowNumber, values, { mustBeEmpty: true }); // dòng đã bị dùng cho ca khác -> lỗi NOT_EMPTY, không ghi đè
    const back = await readRowAF(rowNumber);
    const rv = verifyReadback(values, back.raw, back.formatted);
    lastDeleted = null; clearTimeout(undoTimer);
    await app.reload();
    setBusy(false);
    showMsg(box, rv.ok ? 'ok' : 'error', rv.ok ? `Đã hoàn tác: dòng ${rowNumber} có lại ca cũ. Số liệu đã làm mới.` : `Đã gửi lệnh hoàn tác nhưng đọc lại không khớp: ${rv.errors.join('; ')}. Hãy mở Sheet kiểm tra dòng ${rowNumber}.`);
  } catch (e) {
    setBusy(false);
    renderSignin();
    if (e.code === 'NOT_EMPTY') { lastDeleted = null; return showMsg(box, 'error', `Không hoàn tác được: dòng ${rowNumber} đã có dữ liệu khác (có thể vừa thêm ca mới). App không ghi đè. Nếu cần, hãy thêm lại ca cũ bằng form.`); }
    if (['TIMEOUT', 'NETWORK', 'OFFLINE'].includes(e.code)) return showMsg(box, 'warn', `Chưa chắc đã hoàn tác: ${e.message}. App không tự gửi lại. Bấm "Tải lại" ở đầu trang để xem dòng ${rowNumber} đã có lại chưa trước khi thử tiếp.`, [['undo', 'Hoàn tác']]);
    showMsg(box, 'error', `Chưa hoàn tác được: ${e.message}.`, [['undo', 'Hoàn tác'], ...(['HTTP_401', 'TOKEN_EXPIRED', 'NO_TOKEN'].includes(e.code) ? [['signin', 'Đăng nhập lại']] : [])]);
  }
}

const actions = {
  undo: undoDelete,
  check: checkPending,
  signin: () => doSignIn().then(ok => ok && showMsg(currentMsgBox(), 'info', 'Đã đăng nhập lại. Bấm Lưu (hoặc Xóa) lần nữa.')),
  reload: async () => { pending = null; $('f-dialog').open && $('f-dialog').close(); $('del-dialog').open && $('del-dialog').close(); editing = null; await app.reload(); },
};
const currentMsgBox = () => ($('del-dialog').open ? $('del-msg') : $('f-dialog').open ? $('ca-msg') : $('ca-result'));

function showMsg(box, kind, text, buttons = []) {
  if (!kind) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.className = `msg ${kind}`;
  box.innerHTML = `<p>${esc(text)}</p>` + buttons.map(([k, label]) => `<button type="button" data-do="${k}">${esc(label)}</button>`).join(' ');
}

// ---------------------------------------------------------------------------------------------
// Xóa: hộp xác nhận ghi rõ ca nào; "xóa" = xóa nội dung A:F, không xóa hàng
// ---------------------------------------------------------------------------------------------
function openDelete(s) {
  if (busy) return;
  const e = checkDelete(s, currentToday());
  if (e.length) return showMsg($('ca-result'), 'error', e[0]);
  editing = { mode: 'delete', original: s, rowNumber: s.rowNumber, snapshot: [...s.raw] };
  pending = null;
  const time = s.start === null ? 'không có giờ' : `${fmtTime(s.start)}–${s.end === null ? '…' : fmtTime(s.end)}`;
  $('del-what').innerHTML = `<b>${fmtDate(s.date)} · ${time}</b><br>${esc(s.topic ?? '')}${s.activity ? ` · ${esc(s.activity)}` : ''}<br><span class="muted">dòng ${s.rowNumber}</span>`;
  showMsg($('del-msg'), null);
  setBusy(false);
  $('del-dialog').showModal();
}
async function doDelete() {
  if (busy || editing?.mode !== 'delete') return;
  const box = $('del-msg');
  const s = editing.original;
  const e0 = checkDelete(s, currentToday()); // tính lại lúc bấm
  if (e0.length) return showMsg(box, 'error', e0[0]);
  setBusy(true); // khóa ngay, kể cả trong lúc chờ đăng nhập
  if (!hasValidToken()) {
    showMsg(box, 'info', 'Cần đăng nhập Google trước khi xóa.');
    if (!(await doSignIn())) { setBusy(false); return; }
  }
  let phase = 'read';
  try {
    const cur = await readRowAF(s.rowNumber);
    const d = snapshotCompare(editing.snapshot, cur.raw);
    if (!d.same) throw err('CHANGED', changedText(s.rowNumber, d));
    phase = 'write';
    pending = { kind: 'delete', rowNumber: s.rowNumber, sent: [], snapshot: editing.snapshot };
    await clearRow(s.rowNumber);
    phase = 'verify';
    const back = await readRowAF(s.rowNumber);
    if (!isEmptyRow(back.raw)) throw err('READBACK', `Đã gửi lệnh xóa nhưng dòng ${s.rowNumber} đọc lại vẫn còn dữ liệu. Hãy mở Sheet kiểm tra.`);
    pending = null;
    // Giữ bản sao dòng vừa xóa trong bộ nhớ trang để Hoàn tác (tải lại trang là mất)
    lastDeleted = { session: s, rowNumber: s.rowNumber, values: editing.snapshot.slice(0, 6).map(v => v ?? ''), until: Date.now() + UNDO_MS };
    while (lastDeleted.values.length < 6) lastDeleted.values.push('');
    await app.reload();
    setBusy(false);
    $('del-dialog').close();
    editing = null;
    showUndo(s.rowNumber);
  } catch (e) {
    setBusy(false);
    if (e.code === 'CHANGED') return showMsg(box, 'error', e.message + ' Bấm "Tải lại dữ liệu".', [['reload', 'Tải lại dữ liệu']]);
    if (phase !== 'read' && ['TIMEOUT', 'NETWORK', 'OFFLINE'].includes(e.code) || (phase === 'verify' && e.code !== 'READBACK'))
      return showMsg(box, 'warn', `Chưa chắc đã xóa: ${e.message}. App KHÔNG tự gửi lại. Bấm "Kiểm tra trong Sheet".`, [['check', 'Kiểm tra trong Sheet']]);
    handleError(box, e, phase === 'verify' ? 'done' : phase);
  }
}
