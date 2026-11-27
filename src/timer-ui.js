// timer-ui.js — L7: thẻ bấm giờ ở trang Hôm nay (Bắt đầu / đang học / Kết thúc / Đổi ca), hộp thoại, thẻ Cài đặt.
// Phép tính ở timer.js (thuần, có test, Oriana duyệt 27/11/2026). Luật ca ở rules.js, dựng dòng ở write-core.js,
// gọi Google ở sheets-write.js — ba file này KHÔNG đổi. Ở đây chỉ nối các bước theo đúng quy trình ghi L2–L6:
//   chốt giờ bấm (lưu tạm) -> đăng nhập nếu cần -> ĐỌC LẠI Sheet (tiêu đề + A2:F1002) -> biết lần bấm đã vào chưa
//   -> kiểm luật (validateRow) -> ghi 1 dòng (khóa nút khi gửi) -> đặt định dạng ngày/giờ -> đọc lại đối chiếu -> tải lại.
// Lỗi giữa chừng (mất mạng, quá 8 giây, token hết hạn): GIỮ lần bấm, báo "Chưa lưu được; giờ thật là hh:mm", nút Thử lại
// luôn đọc lại Sheet trước nên không ghi trùng.
// localStorage (Oriana duyệt Phần A c, g, j): tt-timer-pending (lần bấm chưa lưu, xóa khi ghi xong), tt-wakelock, tt-vibrate.
// Không lưu số liệu Sheet; token vẫn chỉ nằm trong bộ nhớ của sheets-write.js.
import { WEEKDAY_NAMES, ACTIVITIES, weekday, todaySerial, parseSessions } from './core.js';
import { validateRow, checkHeaders, nowFraction, splitNote } from './rules.js';
import { serializeRow, verifyReadback, snapshotCompare, findFirstEmptyRow } from './write-core.js';
import { signIn, hasValidToken, readHeaders, readRange, readRowAF, writeRow, formatRow } from './sheets-write.js';
import { LAST_FORMULA_ROW } from './config.js';
import {
  clockFromMs, sessionStartMs, elapsed, fmtElapsed, startBlock, buildStartInput, planEnd, planSwitch,
  makePending, parsePending, pendingStatus, clockSkew, recentTopics, defaultChoice, PENDING_KEY,
} from './timer.js';
import { mochiStudySvg, replayStudy, mochiSvg, jump } from './mochi.js';
import { fmtHM, fmtDayShort, fmtTime } from './format.js';
import { catStyle } from './ui-config.js';
import { esc } from './ui-charts.js';

const $ = id => document.getElementById(id);
const err = (code, message) => Object.assign(new Error(message), { code });
const AUTH = ['NO_TOKEN', 'TOKEN_EXPIRED', 'HTTP_401'];
const NET = ['TIMEOUT', 'NETWORK', 'OFFLINE'];
const ICON = { error: '(・_・;)', warn: '(・・?)', info: '(・ω・)' };
const STALE_FROM_MIN = 6 * 60; // giống L5: ca của ngày trước chỉ coi là "quên đóng" từ 06:00
// Giờ của Google để so với giờ máy (Phần A f): trang nhỏ (~0,7 KB), trả 200, cho đọc tiêu đề Date (đã đo 27/11/2026)
const SKEW_URL = 'https://www.googleapis.com/discovery/v1/apis?name=sheets&preferred=true';

// ---------- localStorage: luôn bọc try/catch (chế độ riêng tư có thể chặn) ----------
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* bỏ qua */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* bỏ qua */ } },
};
export const getPending = () => parsePending(ls.get(PENDING_KEY));
const savePending = p => ls.set(PENDING_KEY, JSON.stringify(p));
const clearPending = () => ls.del(PENDING_KEY);
const pref = k => ls.get(k) === '1'; // mặc định TẮT

// ---------- Trạng thái trong bộ nhớ trang ----------
let app = null;   // { getModel, reload, canWrite, realClock, onFinish(row), onDelete(row), onSignin, sheetUrl }
let busy = false;
let msg = null;   // { kind, html, buttons: [[do, label, primary?]] }
let pick = { topic: null, activity: null };
let endAt = null, swAt = null, dropAsk = false;
let skew = null;  // kết quả so giờ gần nhất (chỉ trong bộ nhớ)
let wake = null;  // Screen Wake Lock đang giữ

const chip = (cat, text) => { const c = catStyle(cat); return `<span class="chip ${c.cls}">${c.kao ? `${c.kao} ` : ''}${esc(text ?? '')}</span>`; };
const hm = c => fmtTime(c.frac);
const dayName = d => `${WEEKDAY_NAMES[weekday(d)]} ${fmtDayShort(d)}`;
const pendClock = p => clockFromMs(p.ms);
const pendLabel = p => ({ start: 'Bắt đầu', end: 'Kết thúc', switch: 'Đổi ca' })[p.kind];

export function initTimer(appApi) {
  app = appApi;
  const box = $('timer-box');
  box.addEventListener('click', onClick);
  box.addEventListener('change', e => {
    const n = e.target.name;
    if (n === 'st-t') { $('st-other-w').hidden = e.target.value !== '__other'; if (e.target.value !== '__other') pick.topic = e.target.value; }
    if (n === 'st-a') pick.activity = e.target.value;
    if (e.target.id === 'st-other') pick.topic = e.target.value;
  });
  $('state-pend').addEventListener('click', onClick);
  // Hộp thoại
  document.querySelectorAll('[data-tclose]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  $('t-end-save').addEventListener('click', saveEnd);
  $('t-sw-save').addEventListener('click', saveSwitch);
  $('t-sw').addEventListener('change', e => { if (e.target.name === 'sw-t') $('sw-other-w').hidden = e.target.value !== '__other'; });
  $('t-zero-del').addEventListener('click', () => {
    const s = startBlock(app.getModel()?.stats)?.session;
    $('t-zero').close();
    if (s) app.onDelete(s.rowNumber);
  });
  // Cài đặt (mặc định tắt)
  for (const [id, key] of [['sw-wake', 'tt-wakelock'], ['sw-vib', 'tt-vibrate']]) {
    $(id).setAttribute('aria-checked', String(pref(key)));
    $(id).addEventListener('click', () => { const on = !pref(key); ls.set(key, on ? '1' : '0'); $(id).setAttribute('aria-checked', String(on)); syncWake(); });
  }
  // Đồng hồ: mỗi giây tính lại từ giờ bắt đầu (không cộng dồn) -> đúng cả khi máy ngủ / app bị tạm dừng
  setInterval(tick, 1000);
  // Mỗi 30 giây vẽ lại (trạng thái đăng nhập có thể vừa hết hạn)
  setInterval(() => { if (!busy && !anyDialogOpen()) renderTimer(); }, 30_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { renderTimer(); syncWake(); } });
  renderSettings();
  // So giờ máy với Google 1 lần khi mở app (sau khi form sẵn sàng), để cảnh báo hiện TRƯỚC khi bấm
  setTimeout(() => { if (app.canWrite()) checkSkew().then(() => { if (skew?.warn && !busy && !anyDialogOpen()) renderTimer(); }); }, 0);
}
const anyDialogOpen = () => ['t-end', 't-sw', 't-zero'].some(id => $(id).open);

// =============================================================================================
// Vẽ
// =============================================================================================
function topicPicker(name, sel, m) {
  const recent = recentTopics(m.sessions, m.topics);
  const all = [...m.topics.keys()].filter(t => m.topics.get(t) !== 'Không học');
  const lastUse = t => { const s = m.sessions.filter(x => x.topic === t && typeof x.start === 'number').sort((a, b) => a.date - b.date).at(-1); return s ? fmtDayShort(s.date) : ''; };
  const other = !!sel && !recent.includes(sel);
  const groups = [...new Set(all.map(t => m.topics.get(t)))];
  return `<p class="lab" id="${name}-lt">Chủ đề <span class="muted" style="font-weight:400">· ${recent.length ? `${recent.length} chủ đề gần nhất` : 'chọn trong danh sách'}</span></p>
    <div class="pick" role="radiogroup" aria-labelledby="${name}-lt">${recent.map(t => `<label><input type="radio" name="${name}-t" value="${esc(t)}" ${t === sel ? 'checked' : ''}>${esc(t)}<span class="rc">${lastUse(t)}</span></label>`).join('')}
    <label><input type="radio" name="${name}-t" value="__other" ${other || !recent.length ? 'checked' : ''}>Chủ đề khác</label></div>
    <div class="fld" ${other || !recent.length ? '' : 'hidden'} id="${name}-other-w"><select id="${name}-other" aria-label="Chọn chủ đề khác">${groups.map(g => `<optgroup label="${esc(g)}">${all.filter(t => m.topics.get(t) === g).map(t => `<option ${t === sel ? 'selected' : ''}>${esc(t)}</option>`).join('')}</optgroup>`).join('')}</select></div>`;
}
const actPicker = (name, sel) => `<p class="lab" id="${name}-la">Hoạt động</p><div class="acts5" role="radiogroup" aria-labelledby="${name}-la">${ACTIVITIES.map(a => `<label><input type="radio" name="${name}-a" value="${a}" ${a === sel ? 'checked' : ''}>${a}</label>`).join('')}</div>`;
function readPick(name) {
  const t = document.querySelector(`input[name="${name}-t"]:checked`)?.value;
  const topic = t === '__other' || !t ? $(`${name}-other`)?.value : t;
  const activity = document.querySelector(`input[name="${name}-a"]:checked`)?.value ?? null;
  return { topic: topic || null, activity };
}
function msgHtml() {
  if (!msg) return '';
  const ic = msg.kind === 'ok' ? mochiSvg() : `<span class="ic" aria-hidden="true">${ICON[msg.kind] ?? ''}</span>`;
  const btns = (msg.buttons ?? []).map(([k, label, primary]) => `<button type="button" class="btn3d small${primary ? '' : ' ghost'}" data-tdo="${k}">${esc(label)}</button>`).join('');
  return `<div class="msg ${msg.kind}" role="status">${ic}<p class="grow1">${msg.html}</p>${btns ? `<span class="acts">${btns}</span>` : ''}</div>`;
}
// Ô "Đăng nhập Google trước" — Oriana góp ý ở bản mẫu: nút đăng nhập nổi bật, đặt đầu tiên
const signinFirst = what => `<div class="signin-first"><p><b>Đăng nhập Google trước</b> để ${what} lưu được ngay vào Sheet. Xem số liệu thì không cần.</p>
  <button class="btn3d" type="button" data-tdo="signin"${busy ? ' disabled' : ''}>Đăng nhập Google</button></div>`;

// Mở app lúc mất mạng thì thư viện đăng nhập Google (đã khai báo trong index.html) không tải được, và không tự tải lại.
// Lần bấm vẫn được giữ, nên khi có mạng lại: gắn lại ĐÚNG thẻ script đó (cùng địa chỉ, không thêm thư viện mới).
const GSI_URL = 'https://accounts.google.com/gsi/client';
let gsiTry = null;
function ensureGis() {
  if (window.google?.accounts?.oauth2 || gsiTry || navigator.onLine === false) return;
  gsiTry = document.createElement('script');
  gsiTry.src = GSI_URL; gsiTry.async = true;
  gsiTry.onerror = () => { gsiTry.remove(); gsiTry = null; };
  gsiTry.onload = () => { if (!busy && !anyDialogOpen()) renderTimer(); };
  document.head.append(gsiTry);
}

export function renderTimer() {
  const m = app?.getModel();
  if (!m) return;
  if (app.canWrite()) ensureGis();
  renderSettings();
  const can = app.canWrite();
  const needSignin = can && !hasValidToken();
  const p = can ? getPending() : null;
  const nowMs = Date.now(), c = clockFromMs(nowMs), t = m.stats.today;
  const blk = startBlock(m.stats), s = blk?.session;
  const dis = busy ? ' disabled' : '';
  let html = '';

  if (p?.kind === 'start') {
    // Bắt đầu đã bấm nhưng chưa vào Sheet: đồng hồ chạy từ GIỜ BẤM (đã cắt giây, khớp với giờ sẽ ghi)
    const pc = pendClock(p);
    html = `<section class="card run" aria-label="Ca vừa bấm, chưa lưu"><button class="mo" type="button" data-tdo="mochi" aria-label="Chạm để nhân vật chuyển động">${mochiStudySvg()}</button>
      <h2><span class="dot"></span>Đang học · chưa lưu</h2>
      <p class="clock pend" id="tclock" data-from="${pc.minute * 60000 - 7 * 3600000}">${fmtElapsed(nowMs - (pc.minute * 60000 - 7 * 3600000))}</p>
      <p class="from">từ ${hm(pc)}${pc.date === t ? '' : ` (${dayName(pc.date)})`} · chưa vào Sheet</p>
      <div class="meta">${chip(m.topics.get(p.topic), p.topic)}<span>${esc(p.activity)}</span></div>
      ${busy ? savingBox() : msgHtml() || pendingBox(p)}</section>`;
  } else if (!s) {
    // Chưa có ca mở: chọn chủ đề + hoạt động, nút Bắt đầu
    if (!pick.topic || !pick.activity) { const d = defaultChoice(m.sessions, m.topics); pick = { topic: pick.topic ?? d?.topic ?? null, activity: pick.activity ?? d?.activity ?? null }; }
    html = `<section class="card start-card" aria-label="Bắt đầu học">${needSignin ? signinFirst('nút Bắt đầu') : ''}<h2>Bắt đầu học</h2><p class="muted" style="margin:0">Mặc định theo ca gần nhất</p>
      ${topicPicker('st', pick.topic, m)}${actPicker('st', pick.activity)}
      ${msgHtml()}
      ${can ? `<div class="go"><button class="btn3d" type="button" data-tdo="start"${dis}>${busy ? 'Đang lưu…' : '▶ Bắt đầu'}</button></div>
      <p class="hint2">Giờ bắt đầu là lúc bấm (làm tròn xuống phút). Học xong bấm Kết thúc; đổi chủ đề, đổi hoạt động hay nghỉ hơn 10 phút thì Đổi ca hoặc Kết thúc.</p>`
      : '<p class="hint2">Đang ở chế độ chỉ đọc: tắt nút bấm giờ để không ghi nhầm.</p>'}</section>`;
  } else {
    const e = elapsed(s, nowMs), isToday = s.date === t;
    const stale = s.date < t && c.minOfDay >= STALE_FROM_MIN;            // ca ngày trước, đã qua 06:00 -> nhiều khả năng quên đóng
    const pe = planEnd(s, c);
    const toSheet = blk.action === 'sheet' || pe.kind === 'sheet';
    const fromTxt = isToday ? `từ ${fmtTime(s.start)}` : `từ ${fmtTime(s.start)} ${s.date === t - 1 ? 'hôm qua ' : ''}(${dayName(s.date)})`;
    const pendEnd = p && p.kind !== 'start' && p.rowNumber === s.rowNumber ? p : null;
    let clock;
    if (!app.realClock()) clock = '';
    else if (pendEnd) clock = `<p class="clock pend">${fmtElapsed((pendClock(pendEnd).minute - clockFromMs(sessionStartMs(s)).minute) * 60000)}</p>`;
    else if (e.overDay) clock = '<p class="clock over">hơn 24 giờ</p>';
    else clock = `<p class="clock" id="tclock" data-from="${sessionStartMs(s)}">${fmtElapsed(e.ms)}</p>`;
    let body = '', btns = '';
    if (toSheet) {
      body = `<div class="blocked"><p><b>${pe.reason === 'over24h' ? 'Ca này đã chạy từ 24 giờ trở lên.' : 'Ca này từ 2 ngày trước trở lên.'}</b> App không ghi được giờ kết thúc (${pe.reason === 'over24h' ? 'Sheet sẽ tính thành 0 phút' : 'luật đóng ca L5'}). Hãy điền giờ kết thúc thật ở dòng ${s.rowNumber} trong Sheet, rồi bấm Tải lại. Trong lúc đó chưa Bắt đầu ca mới được, vì mỗi lúc chỉ có một ca mở.</p>
        <span class="acts" style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn3d small" href="${esc(app.sheetUrl)}" target="_blank" rel="noopener">Mở Sheet (dòng ${s.rowNumber})</a><button class="btn3d small ghost" type="button" data-tdo="reload">Tải lại</button></span></div>`;
    } else if (stale && !pendEnd) {
      // Phần C (Oriana duyệt): ca của hôm qua sau 06:00 KHÔNG lấy giờ bấm; dẫn tới luồng đóng ca L5 để nhập giờ thật
      body = `<div class="blocked"><p><b>Ca của hôm qua chưa đóng.</b> Nếu đã học xong từ tối qua, hãy nhập giờ kết thúc thật (app không lấy giờ bây giờ). Đóng ca này xong mới Bắt đầu ca mới được.</p>
        ${can ? `<button class="btn3d small" type="button" data-tdo="closeL5">Đóng ca (nhập giờ thật)</button>` : ''}</div>`;
    } else if (pendEnd) {
      body = busy ? savingBox() : msgHtml() || pendingBox(pendEnd);
    } else if (can) {
      body = (needSignin ? signinFirst('nút Kết thúc') : '') + msgHtml();
      btns = `<div class="btn-row"><button class="btn3d" type="button" data-tdo="end"${dis}>${busy ? 'Đang lưu…' : '■ Kết thúc'}</button><button class="btn3d ghost" type="button" data-tdo="switch"${dis}>⇄ Đổi ca</button></div>`;
    }
    const skewMsg = skew?.warn && !toSheet ? `<div class="msg warn"><span class="ic" aria-hidden="true">(・・?)</span><p class="grow1">Giờ điện thoại đang ${skew.skewMs > 0 ? 'nhanh' : 'chậm'} hơn giờ Google khoảng ${Math.max(1, Math.round(Math.abs(skew.skewMs) / 60000))} phút. App vẫn ghi theo giờ điện thoại; hãy bật "Giờ tự động" trong cài đặt máy.</p></div>` : '';
    const behind = e.behind && !toSheet ? '<div class="msg warn"><span class="ic" aria-hidden="true">(・・?)</span><p class="grow1">Đồng hồ điện thoại đang trước giờ bắt đầu ghi trong Sheet. Kiểm tra giờ của máy rồi bấm Tải lại.</p></div>' : '';
    html = `<section class="card run" aria-label="Ca đang mở"><button class="mo" type="button" data-tdo="mochi" aria-label="Chạm để nhân vật chuyển động">${mochiStudySvg()}</button>
      <h2><span class="dot"></span>${pendEnd ? `Đã bấm ${pendLabel(pendEnd)} · chưa lưu` : 'Đang học'}</h2>
      ${clock}<p class="from">${fromTxt}</p>
      <div class="meta">${chip(s.category, s.topic)}<span>${esc(s.activity ?? '')}</span></div>
      <p class="muted note0">Chưa cộng vào tổng giờ, vòng tiến độ và huy hiệu. Bấm Kết thúc thì mới tính.</p>
      ${skewMsg}${behind}${body}${btns}</section>`;
  }
  $('timer-box').innerHTML = html;
  // Ô "Thêm ca (nhập tay)": ẩn khi đang có ca cần đóng trong Sheet / ca hôm qua (tránh thêm chồng)
  const hideAdd = !!s && (blk.action === 'sheet' || (s.date < t && c.minOfDay >= STALE_FROM_MIN));
  $('add').closest('.add-wrap').hidden = hideAdd || !can;
  syncWake();
}
// Đang gửi: chỉ báo đang lưu, chưa cho Thử lại / Bỏ (khóa nút khi đang gửi)
const savingBox = () => '<div class="msg info" role="status"><span class="ic" aria-hidden="true">(・ω・)</span><p class="grow1"><b>Đang lưu vào Sheet…</b> Đọc Sheet trước, rồi mới ghi.</p></div>';
// Hộp báo lần bấm chưa lưu (khi chưa có thông báo nào khác)
function pendingBox(p) {
  const pc = pendClock(p);
  return `<div class="msg warn"><span class="ic" aria-hidden="true">(・・?)</span><p class="grow1"><b>Chưa lưu được vào Sheet; giờ thật là ${hm(pc)}.</b> Giờ bấm ${pendLabel(p)} đã được giữ trên máy này. Bấm Thử lại: app đọc Sheet trước, nếu đã vào rồi thì không ghi nữa.</p>
    <span class="acts">${!hasValidToken() ? '<button type="button" class="btn3d small" data-tdo="retry">Đăng nhập và lưu</button>' : '<button type="button" class="btn3d small" data-tdo="retry">Thử lại</button>'}<button type="button" class="btn3d small ghost" data-tdo="drop">Bỏ lần bấm này</button></span></div>`;
}
function tick() {
  const el = $('tclock');
  if (!el || !el.dataset.from) return;
  el.textContent = fmtElapsed(Date.now() - Number(el.dataset.from));
}
// Thẻ Cài đặt: lần bấm chưa lưu
function renderSettings() {
  const p = getPending();
  if ($('set-pend')) $('set-pend').textContent = p ? `${pendLabel(p)} lúc ${hm(pendClock(p))} ngày ${fmtDayShort(p.date)}` : 'Không có';
}
// Màn hình lỗi / mất mạng: app không hiện số liệu, nhưng vẫn nói còn lần bấm chưa lưu
export function renderStatePending(show) {
  const box = $('state-pend'), p = show ? getPending() : null;
  box.hidden = !p;
  if (!p) { box.innerHTML = ''; return; }
  const pc = pendClock(p);
  box.innerHTML = `<div class="msg warn"><span class="ic" aria-hidden="true">(・・?)</span><p class="grow1"><b>Còn 1 lần bấm chưa lưu trên máy này:</b> ${pendLabel(p)} lúc <b>${hm(pc)}</b> ngày ${fmtDayShort(pc.date)}${p.topic ? ` · ${esc(p.topic)} · ${esc(p.activity)}` : ''}. Giờ này đã được giữ lại; có mạng, bấm Tải lại rồi Thử lại. App đọc Sheet trước khi ghi, không ghi trùng.</p></div>`;
}

// =============================================================================================
// Bấm
// =============================================================================================
function onClick(e) {
  const b = e.target.closest('[data-tdo]');
  if (!b || b.disabled) return;
  const m = app.getModel();
  switch (b.dataset.tdo) {
    case 'mochi': replayStudy(b); jump(b); return;
    case 'signin': return doSignin();
    case 'reload': msg = null; return app.reload();
    case 'start': return onStart(m);
    case 'end': return onEnd(m);
    case 'switch': return onSwitch(m);
    case 'closeL5': { const s = startBlock(m.stats)?.session; if (s) app.onFinish(s.rowNumber); return; }
    case 'retry': { const p = getPending(); msg = null; if (p) run(p); else renderTimer(); return; }
    case 'drop':
      msg = { kind: 'warn', html: '<b>Bỏ lần bấm này?</b> Giờ bấm sẽ bị xóa khỏi máy, không ghi vào Sheet. Muốn ghi ca đó sau thì dùng "Thêm ca (nhập tay)".', buttons: [['dropYes', 'Bỏ', false], ['dropNo', 'Giữ lại', true]] };
      return renderTimer();
    case 'dropYes': clearPending(); msg = null; return renderTimer();
    case 'dropNo': msg = null; return renderTimer();
  }
}
async function doSignin() {
  try { await signIn(); app.onSignin?.(); msg = null; }
  catch (e) { msg = { kind: 'error', html: esc(signinText(e)) }; }
  renderTimer();
}
function signinText(e) {
  if (e.code === 'POPUP_popup_closed') return 'Cửa sổ đăng nhập Google đã bị đóng trước khi xong. Bấm lại để thử.';
  if (e.code === 'POPUP_popup_failed_to_open') return 'Trình duyệt chặn cửa sổ đăng nhập Google. Hãy cho phép cửa sổ bật lên (popup) cho trang này rồi bấm lại.';
  if (e.code === 'AUTH_access_denied') return 'Bạn đã từ chối cấp quyền cho app.';
  if (e.code === 'AUTH_SCOPE') return 'Bạn chưa tick quyền chỉnh sửa Google Sheets khi đăng nhập.';
  if (e.code === 'GIS') { ensureGis(); return 'Thư viện đăng nhập Google chưa tải xong (có thể do vừa mất mạng). Chờ vài giây rồi bấm lại; nếu vẫn vậy thì tải lại trang, giờ bấm vẫn được giữ.'; }
  return `Chưa đăng nhập được Google (${e.message}).`;
}
const vibrate = () => { if (pref('tt-vibrate')) try { navigator.vibrate?.(40); } catch { /* bỏ qua */ } };

function onStart(m) {
  if (busy || getPending()) return;
  const c = clockFromMs(Date.now()); // giờ bấm, chốt NGAY
  const { topic, activity } = readPick('st');
  if (!topic || !activity) { msg = { kind: 'error', html: 'Chọn chủ đề và hoạt động trước khi Bắt đầu.' }; return renderTimer(); }
  pick = { topic, activity };
  if (startBlock(m.stats)) return renderTimer(); // đã có ca mở (theo dữ liệu đang có)
  const p = makePending({ kind: 'start', clock: c, topic, activity });
  savePending(p);
  vibrate();
  run(p);
}
function onEnd(m) {
  if (busy) return;
  const s = startBlock(m.stats)?.session;
  if (!s) return;
  endAt = clockFromMs(Date.now()); // giờ kết thúc = lúc bấm Kết thúc (không phải lúc bấm Lưu trong hộp)
  const p = planEnd(s, endAt);
  if (p.kind === 'zero') {
    $('t-zero-sum').innerHTML = `<b>${fmtTime(s.start)} → ${hm(endAt)}</b><p>mới được ${Math.max(0, Math.floor((endAt.ms - sessionStartMs(s)) / 1000))} giây · ${esc(s.topic)}</p>`;
    return $('t-zero').showModal();
  }
  if (p.kind === 'behind') { msg = { kind: 'warn', html: 'Đồng hồ điện thoại đang trước giờ bắt đầu ghi trong Sheet nên chưa Kết thúc được. Kiểm tra giờ của máy rồi bấm lại.' }; return renderTimer(); }
  if (p.kind !== 'close') return app.reload();
  $('t-end-sum').innerHTML = `<b>${fmtTime(s.start)} → ${hm(endAt)}${p.nextDay ? ' (hôm sau)' : ''} · ${fmtHM(p.durMin)}</b><p>Giờ kết thúc là lúc bạn bấm Kết thúc. ${chip(s.category, s.topic)} ${esc(s.activity ?? '')}</p>`;
  $('t-end-note-w').hidden = !p.noteAllowed;
  $('t-end-note').value = splitNote(s.note).text;
  $('t-end-msg').innerHTML = p.noteAllowed ? '' : '<p class="muted">Tuần của ca này đang tạm chốt: chỉ điền giờ kết thúc, không sửa ghi chú.</p>';
  $('t-end').showModal();
}
function saveEnd() {
  const m = app.getModel(), s = startBlock(m.stats)?.session;
  if (busy || !s || !endAt) return;
  const plan = planEnd(s, endAt);
  const p = makePending({ kind: 'end', clock: endAt, session: s, note: plan.noteAllowed ? $('t-end-note').value : undefined });
  savePending(p);
  $('t-end').close();
  vibrate();
  run(p);
}
function onSwitch(m) {
  if (busy) return;
  const s = startBlock(m.stats)?.session;
  if (!s) return;
  swAt = clockFromMs(Date.now()); // giờ đổi ca = lúc bấm Đổi ca
  const d = planEnd(s, swAt);
  $('t-sw-sum').innerHTML = `<b>${hm(swAt)}: ca cũ kết thúc, ca mới bắt đầu</b><p>Ca cũ: ${chip(s.category, s.topic)} ${esc(s.activity ?? '')}${d.kind === 'close' ? ` · ${fmtHM(d.durMin)}` : ''}</p>`;
  $('t-sw-pick').innerHTML = topicPicker('sw', recentTopics(m.sessions, m.topics).find(x => x !== s.topic) ?? s.topic, m) + actPicker('sw', s.activity);
  $('t-sw-msg').innerHTML = '<p class="hint2">Ca mới phải khác chủ đề hoặc khác hoạt động.</p>';
  $('t-sw').showModal();
}
function saveSwitch() {
  const m = app.getModel(), s = startBlock(m.stats)?.session;
  if (busy || !s || !swAt) return;
  const choice = readPick('sw');
  if (!choice.topic || !choice.activity) { $('t-sw-msg').innerHTML = msgBlock('error', 'Chọn chủ đề và hoạt động của ca mới.'); return; }
  const plan = planSwitch(s, swAt, choice);
  if (!plan.ok) {
    const why = { same: 'Ca mới đang giống hệt ca cũ (cùng chủ đề, cùng hoạt động). Đổi chủ đề hoặc hoạt động.',
      zero: 'Ca cũ chưa được 1 phút nên chưa đóng được. Bấm Thôi, rồi Kết thúc để Hủy ca, hoặc học thêm chút nữa.',
      behind: 'Đồng hồ điện thoại đang trước giờ bắt đầu của ca cũ. Kiểm tra giờ của máy.' }[plan.reason] ?? 'Ca cũ không đóng được trong app.';
    $('t-sw-msg').innerHTML = msgBlock('error', why);
    return;
  }
  pick = choice;
  const p = makePending({ kind: 'switch', clock: swAt, session: s, topic: choice.topic, activity: choice.activity });
  savePending(p);
  $('t-sw').close();
  vibrate();
  run(p);
}
const msgBlock = (kind, text) => `<div class="msg ${kind}"><span class="ic" aria-hidden="true">${ICON[kind]}</span><p class="grow1">${esc(text)}</p></div>`;

// =============================================================================================
// Ghi: chạy 1 lần bấm đã lưu tạm. Đăng nhập (nếu cần) được gọi NGAY trong lúc bấm, trước mọi bước chờ,
// để trình duyệt không chặn cửa sổ đăng nhập.
// =============================================================================================
async function run(p) {
  if (busy || !p) return;
  busy = true;
  msg = null;
  const login = hasValidToken() ? null : signIn();
  renderTimer();
  checkSkew(); // chạy song song, không chặn việc ghi
  if (login) {
    try { await login; app.onSignin?.(); }
    catch (e) { busy = false; msg = { kind: 'error', html: `${esc(signinText(e))} <b>Giờ ${pendLabel(p)} đã chốt: ${hm(pendClock(p))}</b>, vẫn giữ trên máy này.`, buttons: [['retry', 'Đăng nhập và lưu', true], ['drop', 'Bỏ lần bấm này']] }; renderTimer(); return; }
  }
  const ctx = { phase: 'read' };
  try {
    msg = await commit(p, ctx);
  } catch (e) {
    msg = errorMsg(e, p, ctx.phase);
  }
  busy = false;
  renderTimer();
}

async function commit(p, ctx) {
  const m = app.getModel();
  ctx.phase = 'read';
  // 1. Đọc lại: tiêu đề cột + toàn bộ A2:F1002 (giá trị thô)
  const headers = await readHeaders();
  const bad = checkHeaders(headers);
  if (bad) throw err('RULE', bad);
  const rows = await readRange(`A2:F${LAST_FORMULA_ROW}`);
  const sessions = parseSessions([headers, ...rows], 'values', m.topics).sessions;
  // 2. Lần bấm này đã vào Sheet chưa? (không ghi trùng)
  const st = pendingStatus(p, sessions);
  if (st.state === 'done') {
    clearPending();
    await app.reload();
    return { kind: 'ok', html: `Đã kiểm tra: ${pendLabel(p)} lúc ${hm(st.clock)} đã có trong Sheet (dòng ${st.rowNumber}). Không ghi lại.` };
  }
  if (st.state === 'conflict') {
    clearPending();
    await app.reload();
    const o = st.session;
    return { kind: 'error', html: st.reason === 'other-open'
      ? `Chưa ghi: trong Sheet đã có ca đang mở khác (${o ? `${dayName(o.date)} từ ${fmtTime(o.start)} · ${esc(o.topic)}, dòng ${o.rowNumber}` : ''}), có thể vừa mở từ máy khác. Đồng hồ giờ chạy theo ca đó.`
      : `Chưa ghi: dòng ${p.rowNumber} trong Sheet đã bị sửa hoặc xóa ở nơi khác kể từ lúc bấm. Lần bấm lúc ${hm(st.clock)} đã được bỏ; hãy xem lại tab Lịch.` };
  }
  const today = todaySerial(), nowFrac = nowFraction();
  const vctx = { today, nowFrac, topics: m.topics, headers, sessions };
  let input, row, mode, original = null, lowWarn = null;
  if (p.kind === 'start' || st.step === 'start') {
    // 3a. Dòng mới: ngày + giờ bấm, chưa có giờ kết thúc
    input = buildStartInput({ clock: st.clock, topic: p.topic, activity: p.activity });
    mode = 'add';
  } else {
    // 3b. Đóng ca: chỉ điền giờ kết thúc = giờ bấm (luật tuần tính theo ngày hiện tại)
    const plan = planEnd(st.session, st.clock, { note: p.note, today });
    if (plan.kind !== 'close') {
      clearPending();
      await app.reload();
      return { kind: 'error', html: plan.kind === 'zero' ? 'Ca chưa được 1 phút nên chưa đóng được. Lần bấm đã được bỏ.'
        : plan.kind === 'sheet' ? `Ca này không đóng được trong app nữa (${plan.reason === 'over24h' ? 'từ 24 giờ trở lên' : 'từ 2 ngày trước'}). Hãy sửa giờ kết thúc ở dòng ${st.session.rowNumber} trong Sheet.`
        : 'Không đóng được ca này. Hãy tải lại và xem tab Lịch.' };
    }
    input = plan.input; mode = 'edit'; original = st.session; row = st.session.rowNumber;
  }
  const v = validateRow(input, { ...vctx, mode, original });
  if (v.errors.length) {
    clearPending();
    await app.reload();
    return { kind: 'error', html: `Chưa ghi: ${esc(v.errors.join(' '))} Lần bấm lúc ${hm(st.clock)} đã được bỏ.` };
  }
  if (mode === 'add') { const r = findFirstEmptyRow(rows); row = r.row; lowWarn = r.warning; }
  else {
    // Ngay trước khi ghi: dòng phải còn giống lúc vừa đọc
    const cur = await readRowAF(row);
    if (!snapshotCompare(original.raw, cur.raw).same) throw err('CHANGED', `Dòng ${row} vừa bị thay đổi ở nơi khác. Chưa ghi gì.`);
  }
  // 4. Ghi (writeRow tự kiểm tra lại dòng còn trống khi thêm)
  const sent = serializeRow(input);
  ctx.phase = 'write';
  await writeRow(row, sent, { mustBeEmpty: mode === 'add' });
  // 5. Đặt định dạng ngày/giờ (tránh sự cố dòng 168), đọc lại đối chiếu
  ctx.phase = 'verify';
  let fmtWarn = null;
  try { await formatRow(row); } catch (e) { fmtWarn = `Chưa đặt được định dạng ngày/giờ cho dòng ${row} (${e.message}).`; }
  const back = await readRowAF(row);
  const rv = verifyReadback(sent, back.raw, back.formatted);
  if (!rv.ok) { clearPending(); throw err('READBACK', `Đã gửi nhưng dòng ${row} đọc lại không khớp: ${rv.errors.join('; ')}. Hãy mở Sheet kiểm tra dòng này.`); }
  if (p.kind === 'switch' && mode === 'edit') return commit(p, ctx); // Đổi ca: xong bước đóng -> đọc lại, làm bước mở với CÙNG giờ bấm
  clearPending();
  await app.reload();
  const extra = [...v.warnings, ...rv.warnings, lowWarn, fmtWarn].filter(Boolean).map(esc).join(' ');
  const what = p.kind === 'start' ? `Đã bắt đầu lúc ${hm(st.clock)} (dòng ${row}). Học vui nha (＾▽＾)`
    : p.kind === 'switch' ? `Đã đổi ca lúc ${hm(st.clock)}: ca cũ đã đóng, ca mới ở dòng ${row}.`
    : `Đã kết thúc lúc ${hm(st.clock)} · ${fmtHM(planEnd(original, st.clock, { today }).durMin ?? 0)} đã cộng vào hôm nay (＾▽＾)`;
  return { kind: extra ? 'warn' : 'ok', html: `${what}${extra ? ` ${extra}` : ''}` };
}

function errorMsg(e, p, phase) {
  const pc = pendClock(p), at = `<b>Giờ thật là ${hm(pc)}</b>, đã giữ trên máy này.`;
  if (AUTH.includes(e.code))
    return { kind: 'info', html: `<b>Cần đăng nhập lại Google. Giờ ${pendLabel(p)} đã chốt: ${hm(pc)}</b> (lúc bạn bấm). Đăng nhập xong app ghi đúng ${hm(pc)}, không lấy giờ lúc đăng nhập.`, buttons: [['retry', 'Đăng nhập và lưu', true], ['drop', 'Bỏ lần bấm này']] };
  if (NET.includes(e.code)) {
    const unsure = phase === 'write' || phase === 'verify';
    return { kind: 'warn', html: unsure
      ? `<b>Chưa chắc đã lưu</b> (${esc(e.message)}). ${at} Bấm Thử lại: app đọc Sheet trước, nếu đã vào rồi thì không ghi nữa.`
      : `<b>Chưa lưu được</b> (${esc(e.message)}). ${at} Có mạng thì bấm Thử lại.`, buttons: [['retry', 'Thử lại', true], ['drop', 'Bỏ lần bấm này']] };
  }
  if (e.code === 'READBACK') return { kind: 'error', html: esc(e.message) };
  if (e.code === 'NOT_EMPTY' || e.code === 'CHANGED')
    return { kind: 'warn', html: `${esc(e.message)} ${at} Bấm Thử lại để app đọc Sheet và làm lại.`, buttons: [['retry', 'Thử lại', true], ['drop', 'Bỏ lần bấm này']] };
  return { kind: 'error', html: `${esc(e.message)} ${at}`, buttons: [['retry', 'Thử lại', true], ['drop', 'Bỏ lần bấm này']] };
}

// So giờ máy với giờ Google (Phần A f). Lỗi mạng: bỏ qua, không báo gì.
async function checkSkew() {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const sent = Date.now();
    const r = await fetch(SKEW_URL, { cache: 'no-store', signal: ctl.signal });
    const recv = Date.now();
    skew = clockSkew({ dateHeader: r.headers.get('date'), sentMs: sent, recvMs: recv }) ?? skew;
  } catch { /* không có mạng: không kết luận */ } finally { clearTimeout(timer); }
}

// Giữ màn hình sáng (Screen Wake Lock) khi đang có ca chạy + công tắc bật + trang đang hiện. Trình duyệt tự nhả khi ẩn app.
async function syncWake() {
  const m = app?.getModel();
  const s = m && startBlock(m.stats)?.session;
  const c = clockFromMs(Date.now());
  const running = (!!s && !(s.date < m.stats.today && c.minOfDay >= STALE_FROM_MIN) && !elapsed(s, c.ms).overDay) || getPending()?.kind === 'start';
  const want = pref('tt-wakelock') && running && document.visibilityState === 'visible' && 'wakeLock' in navigator;
  if (want && !wake) {
    try { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } catch { wake = null; }
  } else if (!want && wake) { try { await wake.release(); } catch { /* bỏ qua */ } wake = null; }
}
