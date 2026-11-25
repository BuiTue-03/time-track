// verify.mjs — Tính lại số kiểm chứng (mục 9 Hướng dẫn dự án) từ dữ liệu thô đã tải về.
// Cách chạy: node spike/verify.mjs <ca-hoc.json> <chu-de.json>
//   Mỗi file có thể là: kết quả spreadsheets.get (grid, effectiveValue)
//   hoặc mảng 2 chiều kiểu values.get (UNFORMATTED_VALUE + SERIAL_NUMBER).
import { readFileSync } from 'node:fs';
import { parseTopics, parseSessions, computeStats, serialFromYMD, fmtDate, weekNo } from '../src/core.js';

// Nhận diện định dạng file rồi trả về [rows, source]
function load(path) {
  const j = JSON.parse(readFileSync(path, 'utf8'));
  const sheet = j?.content?.sheets?.[0] ?? j?.sheets?.[0];
  if (sheet) return [sheet.data[0].rowData.map(r => r.values ?? []), 'grid'];
  return [Array.isArray(j) ? j : j.values, 'values'];
}
const [caRows, caSrc] = load(process.argv[2]);
const [cdRows, cdSrc] = load(process.argv[3]);
const topics = parseTopics(cdRows, cdSrc);
const { sessions, issues } = parseSessions(caRows, caSrc, topics);
const CUTOFF = serialFromYMD(2026, 11, 23);
const st = computeStats(sessions, CUTOFF);

// Bảng so khớp: [tên chỉ số, tính được, kỳ vọng]
const w = k => st.byWeek[k] ?? 0, sd = k => st.studyDaysByWeek[k] ?? 0, h4 = k => st.daysAtLeast4hByWeek[k] ?? 0;
const checks = [
  ['Số dòng Ca học', st.rows, 161],
  ['Dòng có giờ', st.rowsWithTime, 157],
  ['Dòng "Bận đi làm" không giờ', st.busyRowsNoTime, 4],
  ['Dòng khác không giờ', st.otherRowsNoTime, 0],
  ['Ngày có học', st.studyDays, 29],
  ['Tổng phút', st.totalMin, 6675],
  ['Phút theo tuần T1–T5', [1, 2, 3, 4, 5].map(w).join('/'), '1530/1715/1200/1273/957'],
  ['Ngày có học theo tuần', [1, 2, 3, 4, 5].map(sd).join('/'), '7/6/4/6/6'],
  ['Lý thuyết', st.byActivity['Lý thuyết'] ?? 0, 2434],
  ['Thực hành', st.byActivity['Thực hành'] ?? 0, 2693],
  ['Ôn tập', st.byActivity['Ôn tập'] ?? 0, 1284],
  ['Kiểm tra nhớ', st.byActivity['Kiểm tra nhớ'] ?? 0, 264],
  ['Ngoại ngữ', st.byCategory['Ngoại ngữ'] ?? 0, 6435],
  ['Chuyên môn BA', st.byCategory['Chuyên môn BA'] ?? 0, 240],
  ['Giờ tháng 10/2026', ((st.byMonth['10/2026'] ?? 0) / 60).toFixed(2), '40.00'],
  ['Giờ tháng 11/2026 (đến 23/11)', ((st.byMonth['11/2026'] ?? 0) / 60).toFixed(2), '71.25'],
  ['Ngày đạt ≥ 4 giờ', st.daysAtLeast4h, 13],
  ['Ngày ≥ 4 giờ theo tuần', [1, 2, 3, 4, 5].map(h4).join('/'), '4/4/2/2/1'],
  ['Trung vị phút/ngày có học', st.medianMinPerStudyDay, 215],
];
console.log('| Chỉ số | Tính được | Kỳ vọng | Khớp? |\n|---|---|---|---|');
for (const [name, got, exp] of checks) console.log(`| ${name} | ${got} | ${exp} | ${String(got) === String(exp) ? '✅' : '❌'} |`);
console.log('\nPhân bổ khác:', JSON.stringify({ byActivity: st.byActivity, byCategory: st.byCategory }));

console.log('\nVấn đề dữ liệu (toàn bộ Sheet):');
for (const i of issues) {
  const s = sessions.find(x => x.rowNumber === i.rowNumber);
  console.log(`- Dòng ${i.rowNumber} (${typeof s?.date === 'number' ? fmtDate(s.date) : '?'}): ${i.msg}`);
}
if (!issues.length) console.log('- Không có');

// Dữ liệu sau mốc 23/11 — chỉ báo cáo riêng
const after = sessions.filter(s => typeof s.date === 'number' && s.date > CUTOFF);
console.log(`\nSau 23/11/2026: ${after.length} dòng`);
for (const s of after) console.log(`- Dòng ${s.rowNumber}: ${fmtDate(s.date)} (tuần ${weekNo(s.date)}) | ${s.topic} | ${s.activity ?? ''} | ${s.duration ?? 'chưa có giờ'} phút`);
