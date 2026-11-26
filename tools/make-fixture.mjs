// make-fixture.mjs — Tạo dữ liệu mẫu (fixture) cho test từ Sheet THẬT. Chỉ ĐỌC, không ghi gì vào Sheet.
// Fixture = cột NHẬP A–E của "Ca học" (bỏ cột F ghi chú, không lấy cột tự tính G–K) cắt đến hết ngày --cutoff,
// cộng bảng "Chủ đề" (A–B). Giá trị thô: ngày/giờ là số serial, không phải chuỗi hiển thị.
//
// Cách 1 (máy bình thường có mạng, cần Node 18+):
//   node tools/make-fixture.mjs --gviz
// Cách 2 (từ file đã tải bằng Sheets API / connector, định dạng grid effectiveValue hoặc mảng values thô):
//   node tools/make-fixture.mjs --files <ca-hoc.json> <chu-de.json> [--captured-at 2026-11-25]
// Tùy chọn: --cutoff 2026-11-23 (mặc định)   --out test/fixtures/sheet-to-2026-11-23.json (mặc định)
import { readFileSync, writeFileSync } from 'node:fs';
import { rawCell, serialFromYMD, fmtDate, todaySerial } from '../src/core.js';
import { gvizUrl, parseGvizText, SPREADSHEET_ID, TAB_SESSIONS, TAB_TOPICS } from '../src/gviz.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const ymd = s => { const [y, m, d] = s.split('-').map(Number); return serialFromYMD(y, m, d); };
const cutoff = ymd(opt('--cutoff', '2026-11-23'));
const capturedAt = opt('--captured-at') ? ymd(opt('--captured-at')) : todaySerial();
const out = opt('--out', `test/fixtures/sheet-to-${opt('--cutoff', '2026-11-23')}.json`);

// Đọc 1 file dump -> [rows, source]
function loadFile(path) {
  const j = JSON.parse(readFileSync(path, 'utf8'));
  const sheet = j?.content?.sheets?.[0] ?? j?.sheets?.[0];
  if (sheet) return [sheet.data[0].rowData.map(r => r.values ?? []), 'grid'];
  return [Array.isArray(j) ? j : j.values, 'values'];
}

let ca, cd, source;
if (args.includes('--gviz')) {
  const get = async (tab, range) => parseGvizText(await (await fetch(gvizUrl(tab, range))).text());
  [ca, cd] = [await get(TAB_SESSIONS, 'A1:E'), await get(TAB_TOPICS, 'A1:B')];
  ca = [ca[0], ...ca.slice(1)]; cd = [cd[0], ...cd.slice(1)];
  source = 'gviz';
} else if (args.includes('--files')) {
  const i = args.indexOf('--files');
  const [a, sa] = loadFile(args[i + 1]), [b, sb] = loadFile(args[i + 2]);
  if (sa !== sb) throw new Error('Hai file phải cùng định dạng');
  [ca, cd, source] = [a, b, sa];
} else {
  console.error('Thiếu --gviz hoặc --files <ca-hoc.json> <chu-de.json>'); process.exit(1);
}

// Chuẩn hóa về giá trị thô; giữ số dòng gốc trong Sheet (dòng 1 = tiêu đề).
// [CHƯA XÁC MINH] Với --gviz, số dòng chỉ đúng nếu gviz không bỏ dòng trống giữa bảng.
const caRows = [];
ca.slice(1).forEach((r, i) => {
  const cells = [0, 1, 2, 3, 4].map(c => rawCell(r?.[c], source));
  if (cells.every(v => v === null)) return;              // dòng trống
  if (typeof cells[0] === 'number' && Math.floor(cells[0]) > cutoff) return; // sau mốc cắt
  caRows.push({ rowNumber: i + 2, cells });
});
const cdRows = cd.slice(1).map(r => [rawCell(r?.[0], source), rawCell(r?.[1], source)]).filter(r => r[0] !== null);

const fixture = {
  meta: {
    spreadsheetId: SPREADSHEET_ID,
    capturedAt: fmtDate(capturedAt),
    cutoff: fmtDate(cutoff),
    readVia: source,
    columns: { caHoc: ['date', 'start_time', 'end_time', 'topic', 'activity'], chuDe: ['topic', 'category'] },
    note: 'Ngày/giờ là serial Google Sheets. Bỏ cột note (F) và mọi cột tự tính. Tạo bằng tools/make-fixture.mjs.',
  },
  caHoc: [{ rowNumber: 1, cells: ['Ngày', 'Bắt đầu', 'Kết thúc', 'Chủ đề', 'Hoạt động'] }, ...caRows],
  chuDe: [['Chủ đề', 'Nhóm học'], ...cdRows],
};
// Ghi mỗi dòng dữ liệu trên 1 dòng file để diff dễ đọc
const body = JSON.stringify(fixture, null, 1)
  .replace(/\{\s*"rowNumber": (\d+),\s*"cells": \[\s*([^\]]*?)\s*\]\s*\}/g, (_, n, c) => `{"rowNumber": ${n}, "cells": [${c.replace(/\s*\n\s*/g, ' ')}]}`)
  .replace(/\[\s*("[^"]*"),\s*("[^"]*")\s*\]/g, '[$1, $2]');
writeFileSync(out, body + '\n');
console.log(`Đã ghi ${out}: ${caRows.length} dòng Ca học (đến ${fmtDate(cutoff)}), ${cdRows.length} chủ đề, chụp ngày ${fmtDate(capturedAt)}.`);
