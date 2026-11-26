// badges.js — Huy hiệu mốc giờ tích lũy (L5): vẽ thẻ "Thành tích" ở Thống kê và ăn mừng mốc mới.
// Phép tính nằm ở milestones.js (thuần, có test). Ở đây chỉ vẽ + nhớ "đã xem mốc nào" trên MÁY NÀY.
// localStorage chỉ giữ 1 khóa 'tt-badges-seen' (danh sách mốc đã xem, ví dụ [10,25,50]); không lưu số liệu Sheet.
// Hình huy hiệu: thiết kế gốc, vẽ bằng ô vuông 14×17 trong code (không dùng file ảnh).
import { CONFIG, fmtDate } from './core.js';
import { MILESTONES_H, milestoneProgress, celebrationPlan } from './milestones.js';
import { fmtHM } from './format.js';
import { UI } from './ui-config.js';
import { esc } from './ui-charts.js';
import { mochiSvg, party } from './mochi.js';

const $ = id => document.getElementById(id);
const KEY = 'tt-badges-seen';
const store = {
  get() { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v.filter(Number.isFinite) : null; } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* chế độ riêng tư: bỏ qua */ } },
};

// Kaomoji riêng cho từng mốc (chỉ dùng ký tự có trong phông của app)
export const KAO = { 10: '(・ω・)', 25: '(•ω•)', 50: '(＾▽＾)', 100: 'ヾ(＾∇＾)', 150: '(≧▽≦)', 200: '(≧▽≦)♪', 300: '＼(＾▽＾)／', 500: 'ヽ(＾▽＾)ノ', 750: '＼(≧▽≦)／', 1000: 'ヽ(≧▽≦)ノ♪' };

// r = ruy băng, o = viền, m = mặt huy hiệu (màu theo bậc), h = đốm sáng, s = ngôi sao
const BADGE = [
  '.rrr......rrr.', '..rrr....rrr..', '...rrr..rrr...', '....rrrrrr....', '....oooooo....', '..oommmmmmoo..', '.ohhmmmmmmmmo.',
  '.ohmmmmsmmmmo.', 'ommmmmsssmmmmo', 'ommsssssssmmmo', 'ommmmsssssmmmo', 'ommmmmsssmmmmo', '.ommmssmssmmo.', '.ommmsmmmsmmo.',
  '..ommmmmmmmo..', '...oommmmoo...', '.....oooo.....',
];
const TIER = { 10: 'var(--accent)', 25: 'var(--accent)', 50: 'var(--pink-l)', 100: 'var(--pink-l)', 150: 'var(--a4)', 200: 'var(--a4)', 300: 'var(--a3)', 500: 'var(--a3)', 750: 'var(--gold)', 1000: 'var(--gold)' };
export function badgeSvg(h, on) {
  const C = on ? { r: 'var(--pink-d)', o: 'var(--mochi-line)', m: TIER[h], h: '#FFFFFF', s: '#FFFFFF' }
    : { r: 'var(--border)', o: 'var(--grey-cat)', m: 'var(--badge-lock)', h: 'var(--badge-lock)', s: 'var(--border)' };
  let r = '';
  BADGE.forEach((row, y) => {
    let x = 0;
    while (x < row.length) { // gộp ô cùng màu liền nhau thành 1 hình chữ nhật
      const ch = row[x];
      let n = 1;
      while (row[x + n] === ch) n++;
      if (C[ch]) r += `<rect x="${x}" y="${y}" width="${n + 0.02}" height="1.02" fill="${C[ch]}"/>`;
      x += n;
    }
  });
  return `<svg viewBox="0 0 14 17" class="pixel" aria-hidden="true">${r}</svg>`;
}

// Thẻ "Thành tích" ở Thống kê. fresh = mốc vừa ăn mừng (nhấp nháy 2 lần).
let fresh = null;
export function renderBadges(m) {
  const p = milestoneProgress(m.sessions, CONFIG);
  $('bd-total').textContent = fmtHM(p.totalMin);
  $('st-badges').innerHTML = p.list.map(x => {
    const tip = x.reached ? `${x.hours} giờ · đạt ngày ${fmtDate(x.date)} ${KAO[x.hours]}` : `${x.hours} giờ · còn ${fmtHM(x.min - p.totalMin)}`;
    return `<button class="bdg ${x.reached ? '' : 'lock'} ${fresh === x.hours ? 'new' : ''}" type="button" data-tip="${esc(tip)}" aria-label="${esc(tip)}">${badgeSvg(x.hours, x.reached)}<b>${x.hours}</b><span>giờ</span></button>`;
  }).join('');
  const prev = [...p.list].reverse().find(x => x.reached)?.min ?? 0;
  $('bd-next').innerHTML = p.next ? `<div class="row"><b>Mốc tiếp theo: ${p.next.hours} giờ</b><span class="muted">còn ${fmtHM(p.next.leftMin)}</span></div>` +
    `<div class="bar" role="img" aria-label="Đã đi được ${Math.round(((p.totalMin - prev) / (p.next.hours * 60 - prev)) * 100)}% tới mốc ${p.next.hours} giờ"><i style="width:${((p.totalMin - prev) / (p.next.hours * 60 - prev)) * 100}%"></i></div>`
    : '<p class="muted">Đã đạt cả 10 huy hiệu. Quá giỏi! ヽ(≧▽≦)ノ♪</p>';
  if ($('set-badges')) $('set-badges').textContent = `${p.list.filter(x => x.reached).length}/${MILESTONES_H.length} đã đạt · mỗi mốc ăn mừng 1 lần trên máy này`;
}

// Gọi mỗi lần tải xong số liệu. Lần đầu trên máy này: chỉ đánh dấu đã xem (không ăn mừng hồi tố).
// Mốc mới: ăn mừng 1 lần (nhiều mốc cùng lúc -> 1 lần với mốc lớn nhất). "Đã xem" chỉ thêm, không bớt.
export function checkCelebration(m) {
  const p = milestoneProgress(m.sessions, CONFIG);
  const reached = p.list.filter(x => x.reached).map(x => x.hours);
  const plan = celebrationPlan(reached, store.get());
  store.set(plan.seen);
  if (!plan.celebrate.length) return;
  const h = plan.celebrate[0], when = p.list.find(x => x.hours === h).date;
  fresh = h;
  setTimeout(() => party([$('peek'), $('brand-mochi')],
    `<span class="row"><span class="bdg-big">${badgeSvg(h, true)}</span>${mochiSvg()}</span><span>${h} giờ rồi đó, ${esc(UI.name)}! <span class="nw">${KAO[h]}</span></span><small>Huy hiệu mới · ${fmtDate(when)}</small>`), 600);
}
