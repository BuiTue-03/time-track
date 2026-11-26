// mochi.js — Nhân vật "cục bột pixel 24 ô" (thiết kế gốc từ hình vẽ tay của Oriana, L4.5 bản B)
// và hiệu ứng: nhảy 0,9 giây, ăn mừng ≤ 3 giây (dưới mốc 5 giây của WCAG 2.2.2).
// Theo ý Oriana: hiệu ứng luôn bật, không theo prefers-reduced-motion, không có công tắc tắt.
// Chỉ là giao diện: không đọc/ghi dữ liệu.
import { UI } from './ui-config.js';

// Bảng màu lấy từ biến CSS để tự đổi theo sáng/tối
const COL = { o: 'var(--mochi-line)', w: 'var(--mochi)', s: 'var(--mochi-shade)', e: 'var(--mochi-eye)', h: '#FFFFFF', p: 'var(--mochi-blush)', m: 'var(--mochi-eye)' };

// Lưới 24×20 tạo bằng công thức: hình bầu dục, viền, phần bóng dưới thân, mắt có đốm sáng, má 3 chấm, miệng tam giác
function makeMap() {
  const W = 24, H = 20, cx = 11.5, cy = 9.6, rx = 11.6, ry = 9.4;
  const inside = (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const g = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (inside(x, y) ? 'w' : '.')));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y][x] === 'w') {
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !inside(x + dx, y + dy));
    if (edge) g[y][x] = 'o';
    else if (y >= cy + 5 || (y >= cy + 3 && Math.abs(x - cx) > 8)) g[y][x] = 's';
  }
  const set = (x, y, c) => { if (g[y] && g[y][x] && g[y][x] !== '.') g[y][x] = c; };
  for (const ex of [7, 15]) { for (let y = 6; y <= 10; y++) { set(ex, y, 'e'); set(ex + 1, y, 'e'); } set(ex, 6, 'h'); set(ex + 1, 7, 'h'); set(ex, 7, 'e'); }
  for (const [x, y] of [[3, 12], [5, 12], [4, 13], [18, 12], [20, 12], [19, 13]]) set(x, y, 'p');
  for (let x = 10; x <= 13; x++) set(x, 13, 'm');
  set(11, 14, 'm'); set(12, 14, 'm');
  return g.map(r => r.join(''));
}
export const MAP = makeMap();

// Gộp các ô cùng màu liền nhau trên một hàng thành 1 hình chữ nhật (SVG gọn hơn)
function rects(map, colors) {
  let r = '';
  map.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let n = 1;
      while (row[x + n] === ch) n++;
      if (colors[ch]) r += `<rect x="${x}" y="${y}" width="${n + 0.02}" height="1.02" fill="${colors[ch]}"/>`;
      x += n;
    }
  });
  return r;
}

export function mochiSvg(cls = '') {
  const w = MAP[0].length, h = MAP.length;
  return `<svg class="mochi pixel ${cls}" viewBox="-1 -3 ${w + 2} ${h + 5}" aria-hidden="true">` +
    `<ellipse cx="${w / 2}" cy="${h + 0.9}" rx="${w * 0.36}" ry=".8" fill="var(--text)" opacity=".14"/><g class="body-g">${rects(MAP, COL)}</g></svg>`;
}

// Nhảy 1 lần (0,9 giây)
export function jump(el) {
  if (!el) return;
  const s = el.querySelector('svg.mochi') || el;
  s.classList.remove('jump');
  void s.getBoundingClientRect();
  s.classList.add('jump');
}

// Ăn mừng: ~40 hạt pixel bay ra + nhân vật nhảy + kaomoji; tự gỡ sau 3 giây.
// L5: html = nội dung riêng ở giữa (đủ mục tiêu tuần, huy hiệu mới); bỏ trống = câu khen mặc định.
export function party(alsoJump = [], html = null) {
  const box = document.createElement('div');
  box.className = 'party';
  box.setAttribute('aria-hidden', 'true');
  const colors = ['var(--accent)', 'var(--accent-edge)', 'var(--pink-l)', 'var(--pink-d)', '#FFD66B'];
  for (let i = 0; i < 40; i++) {
    const p = document.createElement('i'), a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 260;
    p.style.left = '50%'; p.style.top = '38%'; p.style.background = colors[i % colors.length];
    p.style.setProperty('--dx', `${Math.cos(a) * d}px`); p.style.setProperty('--dy', `${Math.sin(a) * d + 120}px`); p.style.setProperty('--r', `${Math.random() * 540}deg`);
    box.appendChild(p);
  }
  const say = document.createElement('div');
  say.className = html ? 'say col' : 'say';
  say.innerHTML = html ?? mochiSvg() + `<span>Giỏi quá, ${UI.name}! (≧▽≦)♪</span>`;
  box.appendChild(say);
  document.body.appendChild(box);
  setTimeout(() => jump(say), 250);
  alsoJump.forEach(jump);
  setTimeout(() => box.remove(), 3000);
}
