// sw.test.mjs — Danh sách STATIC của service worker (quy tắc an toàn L5 số 4):
// mọi file trong src/, quotes.json, phông, biểu tượng phải được lưu; không có gì của Google (số liệu) trong danh sách.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sw = readFileSync(new URL('sw.js', root), 'utf8');
const STATIC = [...sw.match(/const STATIC = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
const VERSION = sw.match(/const VERSION = '([^']+)'/)[1];

test('sw: phiên bản cache của L5 là tt-static-v2', () => assert.equal(VERSION, 'tt-static-v2'));
test('sw: mọi file .js trong src/, quotes.json, phông, biểu tượng đều có trong STATIC', () => {
  const need = [
    ...readdirSync(new URL('src/', root)).filter(f => f.endsWith('.js')).map(f => `./src/${f}`),
    './quotes.json', './index.html', './styles.css', './manifest.webmanifest',
    ...readdirSync(new URL('fonts/', root)).filter(f => f.endsWith('.woff2')).map(f => `./fonts/${f}`),
    ...readdirSync(new URL('icons/', root)).filter(f => f.endsWith('.png')).map(f => `./icons/${f}`),
  ];
  const missing = need.filter(f => !STATIC.includes(f));
  assert.deepEqual(missing, []);
});
test('sw: mọi mục trong STATIC đều có file thật; không có địa chỉ Google', () => {
  for (const f of STATIC) {
    assert.ok(!/google|https?:/.test(f), f);
    if (f !== './') assert.ok(existsSync(new URL(f.slice(2), root)), `thiếu file ${f}`);
  }
});
