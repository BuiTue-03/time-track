// tools/sw-stamp.mjs — "Dấu" của bộ nhớ service worker (L6, Oriana duyệt Phần A mục o, 26/11/2026).
// Vấn đề: sửa một file trong STATIC (ví dụ styles.css) mà QUÊN đổi VERSION trong sw.js thì điện thoại đã cài PWA
// có thể giữ bản cũ khi mất mạng. Cách chặn: băm (SHA-256) tên + nội dung mọi file trong STATIC, lưu cùng VERSION vào
// test/sw-stamp.json. test/sw-stamp.test.mjs băm lại mỗi lần chạy test:
//   - băm khớp dấu                      -> đạt
//   - băm khác dấu, VERSION vẫn như cũ   -> HỎNG: "đổi nội dung STATIC nhưng chưa đổi VERSION"
//   - băm khác dấu, VERSION đã đổi       -> HỎNG: nhắc chạy `node tools/sw-stamp.mjs --write` để cập nhật dấu
// Lệnh --write từ chối ghi dấu mới nếu nội dung đổi mà VERSION chưa đổi.
// Cách dùng: node tools/sw-stamp.mjs          (in dấu hiện tại và so với test/sw-stamp.json)
//            node tools/sw-stamp.mjs --write  (sau khi đã đổi VERSION: ghi dấu mới)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
export const STAMP_FILE = new URL('test/sw-stamp.json', ROOT);

export function readSw(root = ROOT) {
  const sw = readFileSync(new URL('sw.js', root), 'utf8');
  const version = sw.match(/const VERSION = '([^']+)'/)[1];
  const files = [...sw.match(/const STATIC = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  return { version, files };
}
// Băm: danh sách tên file (đổi danh sách cũng tính là đổi) + nội dung từng file theo đúng thứ tự trong STATIC.
// './' là chính index.html nên bỏ qua (đã có './index.html').
export function computeStamp(root = ROOT) {
  const { version, files } = readSw(root);
  const h = createHash('sha256');
  for (const f of files) {
    h.update(`\n${f}\n`);
    if (f !== './') h.update(readFileSync(new URL(f.slice(2), root)));
  }
  return { version, hash: h.digest('hex'), files: files.length };
}
export const readStamp = (file = STAMP_FILE) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cur = computeStamp(), old = readStamp();
  console.log(`Hiện tại: ${cur.version} · ${cur.hash.slice(0, 16)}… · ${cur.files} file`);
  console.log(old ? `Dấu đã lưu: ${old.version} · ${old.hash.slice(0, 16)}…` : 'Chưa có dấu.');
  if (process.argv.includes('--write')) {
    if (old && old.hash !== cur.hash && old.version === cur.version) {
      console.error(`TỪ CHỐI: nội dung STATIC đã đổi nhưng VERSION vẫn là ${cur.version}. Đổi VERSION trong sw.js trước.`);
      process.exit(1);
    }
    writeFileSync(STAMP_FILE, JSON.stringify(cur, null, 2) + '\n');
    console.log('Đã ghi test/sw-stamp.json');
  }
}
