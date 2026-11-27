// sw-stamp.test.mjs — Bắt lỗi "đổi nội dung file trong STATIC mà quên đổi VERSION của sw.js" (L6). Cách làm: xem tools/sw-stamp.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStamp, readStamp } from '../tools/sw-stamp.mjs';

test('sw: nội dung STATIC khớp dấu đã lưu; đổi nội dung thì phải đổi VERSION', () => {
  const cur = computeStamp(), old = readStamp();
  assert.ok(old, 'Chưa có test/sw-stamp.json: chạy node tools/sw-stamp.mjs --write');
  if (cur.hash === old.hash) return assert.equal(cur.version, old.version, 'Nội dung không đổi mà VERSION đổi: chạy node tools/sw-stamp.mjs --write');
  assert.notEqual(cur.version, old.version,
    `Đã đổi nội dung file trong STATIC (hoặc danh sách STATIC) nhưng VERSION vẫn là ${cur.version}. ` +
    'Điện thoại đã cài app có thể giữ bản cũ. Đổi VERSION trong sw.js, rồi chạy node tools/sw-stamp.mjs --write.');
  assert.fail(`VERSION đã đổi (${old.version} -> ${cur.version}) nhưng chưa cập nhật dấu: chạy node tools/sw-stamp.mjs --write.`);
});
