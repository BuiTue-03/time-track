// rest-ui.js — Các luồng GHI của L6: "Đánh dấu ngày nghỉ" (1 dòng vào tab Ca học) và "Quy đổi" (1 dòng vào tab Tích lũy).
// Luật: rest.js (canMarkRest), rules.js (validateRow, không sửa). Ghi: sheets-write.js, qua chốt chặn của write-core.js.
// Quy tắc an toàn (Lệnh L6): hộp xác nhận nói rõ việc sắp làm -> ĐỌC LẠI Sheet ngay trước khi ghi -> khóa nút khi gửi ->
// quá 8 giây: "chưa chắc đã lưu", phải đọc lại mới cho thử lại (không ghi trùng) -> đặt định dạng ngày cột A -> đọc lại đối chiếu.
import { WEEK_STATUS, WEEKDAY_NAMES, weekday, weekNo, weekEnd, fmtDate, todaySerial } from './core.js';
import { isoDate } from './picker.js';
import { validateRow, weekStatusOfDate, parseDateInput, nowFraction } from './rules.js';
import { canMarkRest, REST_TOPICS, parseAccrual, restSummary, conversionSuggestion, accrualTag, composeAccrualNote, randomCode, vnClock, fmtVnd } from './rest.js';
import { serializeRow, snapshotCompare, verifyReadback, isEmptyRow, findFirstEmptyRow, serializeAccrual, findFirstEmptyAccrualRow, verifyAccrualReadback } from './write-core.js';
import { signIn, hasValidToken, readHeaders, readRange, readRowAF, writeRow, formatRow, readAccrualRows, readAccrualRow, writeAccrualRow, formatAccrualRow } from './sheets-write.js';
import { LAST_FORMULA_ROW } from './config.js';
import { esc } from './ui-charts.js';
import { mochiSvg, jump } from './mochi.js';
import { fmtBal } from './l6-view.js';

const $ = id => document.getElementById(id);
const err = (code, message) => Object.assign(new Error(message), { code });
const UNCERTAIN = ['TIMEOUT', 'NETWORK', 'OFFLINE'];
const AUTH = ['NO_TOKEN', 'TOKEN_EXPIRED', 'HTTP_401'];
const MSG_ICON = { error: '(・_・;)', warn: '(・・?)', info: '(・ω・)' };

let app = null; // { getModel(), reload(), onSignin(), showResult(kind, text) }
export function initRestUi(appApi) {
  app = appApi;
  $('mark-date').addEventListener('input', refreshMark);
  document.querySelectorAll('input[name="mark-kind"]').forEach(x => x.addEventListener('change', refreshMark));
  $('mark-cancel').addEventListener('click', () => { if (!busy) $('mark-dlg').close(); });
  $('mark-dlg').addEventListener('cancel', e => { if (busy) e.preventDefault(); }); // phím Esc khi đang gửi: không đóng
  $('mark-save').addEventListener('click', saveMark);
  $('mark-msg').addEventListener('click', e => { const b = e.target.closest('button[data-do]'); if (b) actions[b.dataset.do]?.(); });
  // Quy đổi
  $('st-minus').addEventListener('click', () => { if (!busy) { convN = Math.max(1, convN - 1); refreshConv(); } });
  $('st-plus').addEventListener('click', () => { if (!busy && conv) { convN = Math.min(conv.days, convN + 1); refreshConv(); } });
  $('conv-note').addEventListener('input', refreshConv);
  $('conv-cancel').addEventListener('click', () => { if (!busy) $('conv-dlg').close(); });
  $('conv-dlg').addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  $('conv-save').addEventListener('click', saveConv);
  $('conv-msg').addEventListener('click', e => { const b = e.target.closest('button[data-do]'); if (b) actions[b.dataset.do]?.(); });
}

function showMsg(box, kind, text, buttons = []) {
  if (!kind) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.className = `msg ${kind}`;
  box.innerHTML = (kind === 'ok' ? mochiSvg() : `<span class="ic" aria-hidden="true">${MSG_ICON[kind] ?? ''}</span>`) +
    `<p class="grow1">${esc(text)}</p>` + buttons.map(([k, label]) => `<button type="button" class="btn3d small ghost" data-do="${k}">${esc(label)}</button>`).join(' ');
  if (kind === 'ok') jump(box);
}
async function ensureSignedIn(box) {
  if (hasValidToken()) return true;
  showMsg(box, 'info', 'Cần đăng nhập Google trước khi ghi. Cửa sổ đăng nhập sẽ mở.');
  try { await signIn(); app.onSignin?.(); return true; }
  catch (e) { showMsg(box, 'error', `Chưa đăng nhập được Google (${e.message}). Chưa ghi gì.`); return false; }
}

// =============================================================================================
// 1. Đánh dấu ngày nghỉ: dòng (ngày, chủ đề Nghỉ ngơi | Bận đi làm…, không giờ, không hoạt động).
//    Tuần Tạm chốt -> ghi chú [OFFSET]. Chặn: ngày tương lai, trước 21/10, tuần Chốt hẳn, ngày đã có dòng nghỉ.
// =============================================================================================
let busy = false, markPending = null; // markPending = { rowNumber, sent } khi "chưa chắc đã lưu"
const markKind = () => document.querySelector('input[name="mark-kind"]:checked').value;
const today = () => todaySerial(); // hôm nay thật (giờ VN); luồng ghi bị tắt khi giả lập ngày

export function openMark(date) {
  if (busy) return;
  const m = app.getModel(), t = today();
  markPending = null;
  // Mặc định: ngày được chọn, hoặc ngày chưa có ca gần nhất, hoặc hôm nay
  const d = Number.isInteger(date) ? date : m.missed?.at(-1)?.date ?? t;
  $('mark-date').value = isoDate(d); // ô chọn ngày của trình duyệt (type="date"), giá trị yyyy-mm-dd
  showMsg($('mark-msg'), null);
  setBusy(false);
  refreshMark();
  $('mark-dlg').showModal();
}
// Ngày mặc định khi bấm nút ở tab Lịch: tuần đang diễn ra -> hôm nay; tuần khác -> ngày chưa có ca cuối cùng của tuần, hoặc ngày cuối tuần
export function defaultMarkDate(week) {
  const m = app.getModel(), t = today();
  if (week === weekNo(t)) return t;
  const miss = (m.missed ?? []).filter(x => weekNo(x.date) === week).at(-1);
  return miss ? miss.date : Math.min(weekEnd(week), t);
}

function markInput() {
  const d = parseDateInput($('mark-date').value);
  const c = d === null ? { ok: false, isOffset: false, errors: ['Chưa chọn ngày.'] } : canMarkRest(d, today(), app.getModel().sessions);
  return { date: d, check: c, input: { date: d, start: null, end: null, topic: markKind(), activity: '', noteText: '', isOffset: c.isOffset } };
}
function refreshMark() {
  const m = app.getModel(), { date: d, check: c, input } = markInput();
  const v = d === null ? { errors: [] } : validateRow(input, { mode: 'add', today: today(), nowFrac: nowFraction(), topics: m.topics, sessions: m.sessions, headers: m.headers });
  const errors = [...new Set([...c.errors, ...v.errors])];
  const status = d === null ? null : weekStatusOfDate(d, today());
  $('mark-strip').className = `state-strip s-${status === WEEK_STATUS.PROVISIONAL ? 'prov' : status === WEEK_STATUS.CURRENT ? 'cur' : 'final'}`;
  $('mark-strip').innerHTML = d === null ? '' : `<span class="kao">${status === WEEK_STATUS.PROVISIONAL ? '(•ω•)' : status === WEEK_STATUS.CURRENT ? '(＾▽＾)' : '(˘ω˘)'}</span><span><b>Tuần ${weekNo(d)} · ${esc(status)}</b>${status === WEEK_STATUS.PROVISIONAL ? 'Tuần tạm chốt: dòng ghi vào sẽ có nhãn [OFFSET].' : status === WEEK_STATUS.CURRENT ? 'Tuần đang diễn ra.' : ''}</span>`;
  const ok = errors.length === 0;
  $('mark-confirm').hidden = !ok;
  $('mark-confirm').innerHTML = ok ? `<b>Ghi 1 dòng vào tab Ca học: ${WEEKDAY_NAMES[weekday(d)]} ${fmtDate(d)} · ${esc(input.topic)} · không có giờ${c.isOffset ? ' · ghi chú [OFFSET]' : ''}.</b>
    <span class="muted">Ngày này tính là 1 ngày nghỉ (trừ vào số dư, hiện còn ${fmtBal(m.rest.balance)}). Ngày nghỉ không làm đứt chuỗi. Muốn bỏ đánh dấu thì xóa dòng như xóa ca.</span>` : '';
  $('mark-err').innerHTML = errors.map(e => `<li>${esc(e)}</li>`).join('');
  if (!busy) $('mark-save').disabled = !ok || !!markPending;
  return { ok, input, errors };
}
function setBusy(b) {
  busy = b;
  $('mark-save').disabled = b;
  $('mark-cancel').disabled = b;
  $('mark-save').textContent = b ? 'Đang gửi…' : 'Ghi ngày nghỉ';
  $('conv-save').disabled = b || !!convPending;
  $('conv-cancel').disabled = b;
  $('conv-save').textContent = b ? 'Đang gửi…' : 'Ghi nhận';
  $('st-minus').disabled = b || convN <= 1;
  $('st-plus').disabled = b || !conv || convN >= conv.days;
}

async function saveMark() {
  if (busy || markPending) return; // chống bấm đúp; "chưa chắc đã lưu" phải kiểm tra trước
  const box = $('mark-msg');
  const r = refreshMark();
  if (!r.ok) return;
  setBusy(true); // khóa ngay, trước mọi bước chờ
  if (!(await ensureSignedIn(box))) { setBusy(false); refreshMark(); return; }
  const sent = serializeRow(r.input);
  let phase = 'read', rowNumber = null;
  try {
    showMsg(box, 'info', 'Đang đọc lại Sheet rồi ghi… (đừng đóng app)');
    // Đọc lại NGAY TRƯỚC KHI GHI: tiêu đề cột + toàn bộ A2:F1002 (dữ liệu mới nhất, kể cả dòng vừa thêm ở máy khác)
    const headers = await readHeaders();
    const rows = await readRange(`A2:F${LAST_FORMULA_ROW}`);
    const v = validateRow(r.input, { mode: 'add', today: today(), nowFrac: nowFraction(), topics: app.getModel().topics, sessions: app.getModel().sessions, headers });
    if (v.errors.length) throw err('RULE', v.errors.join(' '));
    if (rows.some(x => x?.[0] === sent[0] && REST_TOPICS.includes(x?.[3])))
      throw err('DUP', `Sheet đã có dòng nghỉ cho ngày ${fmtDate(sent[0])} (có thể vừa ghi từ máy khác, hoặc lần trước đã lưu). Không ghi thêm.`);
    const pick = findFirstEmptyRow(rows);
    rowNumber = pick.row;
    phase = 'write';
    markPending = { rowNumber, sent };
    await writeRow(rowNumber, sent, { mustBeEmpty: true });
    phase = 'verify';
    await finishMark(rowNumber, sent, pick.warning);
  } catch (e) {
    setBusy(false);
    handleMarkError(e, phase);
    refreshMark();
  }
}

// Sau khi ghi: đặt định dạng ngày cho cột A (bài học dòng 168), đọc lại đối chiếu, tải lại số liệu
async function finishMark(rowNumber, sent, lowWarning) {
  let fmtWarning = null;
  try { await formatRow(rowNumber); } catch (e) { fmtWarning = `Chưa đặt được định dạng ngày cho dòng ${rowNumber} (${e.message}); nếu Sheet hiện số lạ ở cột A, hãy chọn lại định dạng ngày trong Sheet.`; }
  const back = await readRowAF(rowNumber);
  const rv = verifyReadback(sent, back.raw, back.formatted);
  if (!rv.ok) throw err('READBACK', `Đã gửi lệnh ghi nhưng dòng ${rowNumber} đọc lại không khớp: ${rv.errors.join('; ')}. Hãy mở Sheet kiểm tra dòng này.`);
  markPending = null;
  await app.reload();
  const seen = app.getModel().sessions.some(s => s.rowNumber === rowNumber && s.rest && s.date === sent[0]);
  const extra = [...rv.warnings, lowWarning, fmtWarning, seen ? null : 'Số liệu trên trang chưa thấy dòng mới (Google có thể trả bản cũ vài giây). Đừng đánh dấu lại; chờ ít giây rồi bấm "Tải lại".'].filter(Boolean);
  setBusy(false);
  $('mark-dlg').close();
  app.showResult(extra.length ? 'warn' : 'ok', `Đã ghi ngày nghỉ ${fmtDate(sent[0])} vào dòng ${rowNumber} và đọc lại thấy đúng. Số liệu đã làm mới.` + (extra.length ? ' ' + extra.join(' ') : ''));
}

function handleMarkError(e, phase) {
  const box = $('mark-msg');
  app.onSignin?.();
  if (phase === 'write' && UNCERTAIN.includes(e.code))
    return showMsg(box, 'warn', `Chưa chắc đã lưu: ${e.message}. App KHÔNG tự gửi lại. Bấm "Kiểm tra trong Sheet" để đọc lại dòng ${markPending.rowNumber} trước khi thử lại (tránh ghi trùng).`, [['check', 'Kiểm tra trong Sheet']]);
  if (phase === 'verify' && e.code !== 'READBACK')
    return showMsg(box, 'warn', `Lệnh ghi đã được Google nhận, nhưng bước đọc lại bị lỗi (${e.message}). Bấm "Kiểm tra trong Sheet".`, [['check', 'Kiểm tra trong Sheet']]);
  if (phase !== 'write') markPending = null;
  if (AUTH.includes(e.code)) {
    markPending = null; // Google từ chối hẳn (401) -> chắc chắn chưa ghi
    return showMsg(box, 'error', `Phiên đăng nhập Google đã hết hạn hoặc bị thu hồi. ${phase === 'write' ? 'Google từ chối lệnh ghi nên chưa ghi gì.' : 'Chưa ghi gì.'} Bấm "Đăng nhập lại", rồi bấm "Ghi ngày nghỉ" lần nữa.`, [['signin', 'Đăng nhập lại']]);
  }
  if (e.code === 'NOT_EMPTY') { markPending = null; return showMsg(box, 'error', `${e.message} (có thể vừa được ghi từ thiết bị khác). Chưa ghi gì. Bấm "Ghi ngày nghỉ" lần nữa để app tìm dòng trống khác.`); }
  if (e.code === 'DUP') return showMsg(box, 'error', e.message, [['reload', 'Tải lại dữ liệu']]);
  if (['FULL', 'GUARD', 'RANGE', 'RULE', 'READBACK', 'DATA'].includes(e.code)) return showMsg(box, 'error', e.message);
  if (UNCERTAIN.includes(e.code)) return showMsg(box, 'error', `Không liên lạc được Google trước khi ghi (${e.message}). Chưa ghi gì. Kiểm tra mạng rồi bấm lại.`);
  return showMsg(box, 'error', `Google báo lỗi: ${e.message}. ${phase === 'write' ? 'Hãy bấm "Kiểm tra trong Sheet".' : 'Chưa ghi gì.'}`, phase === 'write' ? [['check', 'Kiểm tra trong Sheet']] : []);
}

// "Kiểm tra trong Sheet": chỉ ĐỌC lại dòng đã định ghi rồi quyết định
async function checkMark() {
  if (!markPending || busy) return;
  const box = $('mark-msg'), { rowNumber, sent } = markPending;
  setBusy(true);
  try {
    const cur = await readRowAF(rowNumber);
    if (snapshotCompare(sent, cur.raw).same) return await finishMark(rowNumber, sent, null); // đã lưu thật
    setBusy(false);
    markPending = null;
    if (isEmptyRow(cur.raw)) { refreshMark(); return showMsg(box, 'info', `Đã kiểm tra: dòng ${rowNumber} vẫn trống, tức là CHƯA lưu. Có thể bấm "Ghi ngày nghỉ" để thử lại.`); }
    refreshMark();
    showMsg(box, 'error', `Đã kiểm tra: dòng ${rowNumber} đang có dữ liệu khác (có thể vừa ghi từ nơi khác). Chưa ghi ngày nghỉ. Bấm "Tải lại dữ liệu" rồi xem lại.`, [['reload', 'Tải lại dữ liệu']]);
  } catch (e) {
    setBusy(false);
    $('mark-save').disabled = true; // vẫn chưa biết đã lưu hay chưa -> chưa cho thử lại
    showMsg(box, 'error', `Chưa đọc lại được Sheet (${e.message}). Bấm "Kiểm tra trong Sheet" lần nữa khi có mạng.`, [['check', 'Kiểm tra trong Sheet'], ...(AUTH.includes(e.code) ? [['signin', 'Đăng nhập lại']] : [])]);
  }
}

// =============================================================================================
// 2. Quy đổi: ghi 1 dòng tab Tích lũy (A = ngày quy đổi, B = số ngày, D = "[T11/2026 · mã] ghi chú"); C do Sheet tự tính.
//    Mã 4 ký tự tạo 1 lần khi mở hộp: lần thử lại sau "chưa chắc đã lưu" dùng lại mã đó -> nhận ra dòng đã ghi, không ghi trùng.
//    App chỉ GHI NHẬN, không chuyển tiền.
// =============================================================================================
let conv = null, convN = 1, convCode = null, convPending = null; // convPending = { rowNumber, sent }
export function openConv() {
  if (busy) return;
  const m = app.getModel();
  conv = m.conv;
  if (!conv) return;
  convN = conv.days; convCode = randomCode(); convPending = null;
  const S = m.l6.settings;
  $('conv-sub').textContent = `Tháng ${conv.m}/${conv.y}: dùng ${S.restQuotaPerMonth - conv.unused}/${S.restQuotaPerMonth} ngày nghỉ, còn ${conv.unused} ngày chưa dùng${conv.convertedForMonth ? `, đã quy đổi ${conv.convertedForMonth}` : ''}. Tối đa ${conv.days} ngày.`;
  $('conv-note').value = '';
  showMsg($('conv-msg'), null);
  setBusy(false);
  refreshConv();
  $('conv-dlg').showModal();
}
const convNote = () => composeAccrualNote(accrualTag(conv.y, conv.m, convCode), $('conv-note').value);
function refreshConv() {
  if (!conv) return;
  const m = app.getModel(), money = m.l6.settings.moneyPerRestDay;
  $('st-val').textContent = convN;
  $('st-minus').disabled = busy || convN <= 1;
  $('st-plus').disabled = busy || convN >= conv.days;
  $('conv-confirm').innerHTML = `<b>Ghi nhận đã quy đổi ${convN} ngày nghỉ, ${fmtVnd(convN * money)}. App chỉ ghi nhận, không chuyển tiền.</b>
    <span class="muted">Ghi 1 dòng vào tab Tích lũy: ngày ${fmtDate(today())}, ${convN} ngày, ghi chú "${esc(convNote())}" (cột Số tiền do Sheet tự tính). Số dư sau khi ghi: ${fmtBal(m.rest.balance - convN)} ngày.${conv.days - convN ? ` ${conv.days - convN} ngày còn lại vẫn giữ, cộng dồn.` : ''}</span>`;
}

async function saveConv() {
  if (busy || convPending || !conv) return;
  const box = $('conv-msg');
  setBusy(true);
  if (!(await ensureSignedIn(box))) { setBusy(false); refreshConv(); return; }
  const m = app.getModel(), S = m.l6.settings, money = S.moneyPerRestDay;
  let phase = 'read', rowNumber = null, sent = null;
  try {
    showMsg(box, 'info', 'Đang đọc lại tab Tích lũy rồi ghi… (đừng đóng app)');
    sent = serializeAccrual({ date: today(), days: convN, note: convNote() });
    // Đọc lại NGAY TRƯỚC KHI GHI và tính lại mức tối đa với dữ liệu mới nhất (chặn quy đổi trùng từ máy khác / lần trước)
    const rows = await readAccrualRows();
    const fresh = parseAccrual([['Ngày quy đổi', 'Số ngày', 'Số tiền', 'Ghi chú'], ...rows], 'values');
    if (fresh.entries.some(e => e.tag === convCode)) throw err('DUP', 'Tab Tích lũy đã có dòng với cùng mã quy đổi này (lần gửi trước đã lưu). Không ghi thêm.');
    const clock = vnClock();
    const sug = conversionSuggestion(restSummary(m.sessions, fresh.entries, clock.today, S), clock.today, clock.nowMin, S);
    if (!sug || sug.monthKey !== conv.monthKey || convN > sug.days)
      throw err('STALE', sug && sug.monthKey === conv.monthKey
        ? `Số liệu mới nhất trong Sheet chỉ cho quy đổi tối đa ${sug.days} ngày cho tháng ${conv.m}/${conv.y} (có thể vừa quy đổi ở máy khác). Chưa ghi gì.`
        : `Theo số liệu mới nhất trong Sheet, tháng ${conv.m}/${conv.y} không còn ngày để quy đổi (có thể đã quy đổi ở máy khác). Chưa ghi gì.`);
    const pick = findFirstEmptyAccrualRow(rows);
    rowNumber = pick.row;
    phase = 'write';
    convPending = { rowNumber, sent };
    await writeAccrualRow(rowNumber, sent);
    phase = 'verify';
    await finishConv(rowNumber, sent, money, pick.warning);
  } catch (e) {
    setBusy(false);
    handleConvError(e, phase);
    refreshConv();
    $('conv-save').disabled = !!convPending; // "chưa chắc đã lưu": chỉ mở lại sau khi kiểm tra
  }
}
async function finishConv(rowNumber, sent, money, lowWarning) {
  let fmtWarning = null;
  try { await formatAccrualRow(rowNumber); } catch (e) { fmtWarning = `Chưa đặt được định dạng ngày cho cột A dòng ${rowNumber} của tab Tích lũy (${e.message}).`; }
  const back = await readAccrualRow(rowNumber);
  const rv = verifyAccrualReadback(sent, back.raw, back.formattedA, money);
  if (!rv.ok) throw err('READBACK', `Đã gửi lệnh ghi nhưng dòng ${rowNumber} của tab Tích lũy đọc lại không khớp: ${rv.errors.join('; ')}. Hãy mở Sheet kiểm tra dòng này.`);
  convPending = null;
  await app.reload();
  const extra = [...rv.warnings, lowWarning, fmtWarning].filter(Boolean);
  setBusy(false);
  $('conv-dlg').close();
  conv = null;
  app.showResult(extra.length ? 'warn' : 'ok', `Đã ghi nhận quy đổi ${sent.ab[1]} ngày nghỉ (${fmtVnd(sent.ab[1] * money)}) vào dòng ${rowNumber} của tab Tích lũy${rv.cComputed ? ', cột Số tiền đã tự tính' : ''}. App chỉ ghi nhận, không chuyển tiền.` + (extra.length ? ' ' + extra.join(' ') : ''));
}
function handleConvError(e, phase) {
  const box = $('conv-msg');
  app.onSignin?.();
  if (phase === 'write' && UNCERTAIN.includes(e.code))
    return showMsg(box, 'warn', `Chưa chắc đã lưu: ${e.message}. App KHÔNG tự gửi lại. Bấm "Kiểm tra trong Sheet" để đọc lại dòng ${convPending.rowNumber} của tab Tích lũy trước khi thử lại (tránh ghi trùng).`, [['checkConv', 'Kiểm tra trong Sheet']]);
  if (phase === 'verify' && e.code !== 'READBACK')
    return showMsg(box, 'warn', `Lệnh ghi đã được Google nhận, nhưng bước đọc lại bị lỗi (${e.message}). Bấm "Kiểm tra trong Sheet".`, [['checkConv', 'Kiểm tra trong Sheet']]);
  if (phase !== 'write' || AUTH.includes(e.code) || e.code === 'NOT_EMPTY') convPending = null;
  if (AUTH.includes(e.code))
    return showMsg(box, 'error', `Phiên đăng nhập Google đã hết hạn hoặc bị thu hồi. ${phase === 'write' ? 'Google từ chối lệnh ghi nên chưa ghi gì.' : 'Chưa ghi gì.'} Bấm "Đăng nhập lại", rồi bấm "Ghi nhận" lần nữa.`, [['signin', 'Đăng nhập lại']]);
  if (e.code === 'NOT_EMPTY') return showMsg(box, 'error', `${e.message} (có thể vừa được ghi tay hoặc từ thiết bị khác). Chưa ghi gì. Bấm "Ghi nhận" lần nữa để app đọc lại và tìm dòng trống khác.`);
  if (e.code === 'DUP' || e.code === 'STALE') return showMsg(box, 'error', e.message, [['reload', 'Tải lại dữ liệu']]);
  if (['FULL', 'GUARD', 'RANGE', 'DATA', 'READBACK'].includes(e.code)) return showMsg(box, 'error', e.message);
  if (UNCERTAIN.includes(e.code)) return showMsg(box, 'error', `Không liên lạc được Google trước khi ghi (${e.message}). Chưa ghi gì. Kiểm tra mạng rồi bấm lại.`);
  return showMsg(box, 'error', `Google báo lỗi: ${e.message}. ${phase === 'write' ? 'Hãy bấm "Kiểm tra trong Sheet".' : 'Chưa ghi gì.'}`, phase === 'write' ? [['checkConv', 'Kiểm tra trong Sheet']] : []);
}
async function checkConv() {
  if (!convPending || busy) return;
  const box = $('conv-msg'), { rowNumber, sent } = convPending, money = app.getModel().l6.settings.moneyPerRestDay;
  setBusy(true);
  try {
    const back = await readAccrualRow(rowNumber);
    const r = back.raw;
    if (r[0] === sent.ab[0] && r[1] === sent.ab[1] && r[3] === sent.d[0]) return await finishConv(rowNumber, sent, money, null); // đã lưu thật
    convPending = null;
    setBusy(false);
    if ([r[0], r[1], r[3]].every(v => v === '' || v == null)) { refreshConv(); return showMsg(box, 'info', `Đã kiểm tra: dòng ${rowNumber} của tab Tích lũy vẫn trống, tức là CHƯA lưu. Có thể bấm "Ghi nhận" để thử lại.`); }
    showMsg(box, 'error', `Đã kiểm tra: dòng ${rowNumber} của tab Tích lũy có dữ liệu khác (có thể vừa ghi tay). Chưa ghi quy đổi. Bấm "Tải lại dữ liệu" rồi xem lại.`, [['reload', 'Tải lại dữ liệu']]);
  } catch (e) {
    setBusy(false);
    $('conv-save').disabled = true; // vẫn chưa biết đã lưu hay chưa
    showMsg(box, 'error', `Chưa đọc lại được Sheet (${e.message}). Bấm "Kiểm tra trong Sheet" lần nữa khi có mạng.`, [['checkConv', 'Kiểm tra trong Sheet'], ...(AUTH.includes(e.code) ? [['signin', 'Đăng nhập lại']] : [])]);
  }
}

const actions = {
  check: () => checkMark(),
  checkConv: () => checkConv(),
  signin: async () => { try { await signIn(); app.onSignin?.(); showMsg(currentBox(), 'info', 'Đã đăng nhập lại. Bấm lại nút ghi.'); } catch (e) { showMsg(currentBox(), 'error', `Chưa đăng nhập được (${e.message}).`); } },
  reload: async () => { markPending = null; convPending = null; if ($('mark-dlg').open) $('mark-dlg').close(); if ($('conv-dlg').open) $('conv-dlg').close(); await app.reload(); },
};
const currentBox = () => ($('conv-dlg').open ? $('conv-msg') : $('mark-msg'));
