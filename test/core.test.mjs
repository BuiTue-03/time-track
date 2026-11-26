// core.test.mjs — Test lõi tính toán bằng dữ liệu mẫu, không gọi Google. Chạy: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildModel, serialFromYMD, ymdFromSerial, fmtDate, weekday, todaySerial, rawCell, durationMin,
  parseTopics, parseSessions, computeStats, weekStatus, weekNo, WEEK_STATUS, UNCATEGORIZED, BUSY_TOPIC,
} from '../src/core.js';
import { parseGvizText } from '../src/gviz.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/sheet-to-2026-11-23.json', import.meta.url), 'utf8'));
const D = serialFromYMD;
const model = buildModel({ caRows: fx.caHoc, cdRows: fx.chuDe, source: 'values', today: D(2026, 11, 23) });
const st = model.stats;
const wk = w => st.weeks.find(x => x.week === w);

// ---- Số kiểm chứng mục 9 (dữ liệu 21/10–23/11/2026) ----
test('mục 9: số dòng', () => {
  assert.equal(st.rows, 161);
  assert.equal(st.rowsWithTime, 157);
  assert.equal(st.busyRowsNoTime, 4);
  assert.equal(st.otherRowsNoTime, 0);
});
test('mục 9: ngày có học và tổng phút', () => {
  assert.equal(st.studyDays, 29);
  assert.equal(st.totalMin, 6675);
  assert.equal(st.totalMin / 60, 111.25);
});
test('mục 9: theo tuần', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(w => wk(w).min), [1530, 1715, 1200, 1273, 957]);
  assert.deepEqual([1, 2, 3, 4, 5].map(w => wk(w).studyDays), [7, 6, 4, 6, 6]);
  assert.deepEqual([1, 2, 3, 4, 5].map(w => wk(w).daysAtLeast4h), [4, 4, 2, 2, 1]);
});
test('mục 9: theo hoạt động và nhóm', () => {
  const a = st.groups.activity, c = st.groups.category;
  assert.deepEqual([a['Lý thuyết'].min, a['Thực hành'].min, a['Ôn tập'].min, a['Kiểm tra nhớ'].min], [2434, 2693, 1284, 264]);
  assert.equal(a['Nhờ AI'], undefined);
  assert.deepEqual([c['Ngoại ngữ'].min, c['Chuyên môn BA'].min], [6435, 240]);
});
test('mục 9: theo tháng, ngày ≥ 4 giờ, trung vị', () => {
  assert.equal((st.groups.month['2026-10'].min / 60).toFixed(2), '40.00');
  assert.equal((st.groups.month['2026-11'].min / 60).toFixed(2), '71.25');
  assert.equal(st.daysAtLeast4h, 13);
  assert.equal(st.medianMinPerStudyDay, 215);
});
test('tổng các nhóm = tổng phút; số ca = dòng có giờ', () => {
  for (const k of ['week', 'activity', 'category', 'topic', 'phase', 'month']) {
    const vals = Object.values(st.groups[k]);
    assert.equal(vals.reduce((s, x) => s + x.min, 0), 6675, k);
    assert.equal(vals.reduce((s, x) => s + x.count, 0), 157, k);
  }
  assert.equal(Object.values(st.days).reduce((s, d) => s + d.min, 0), 6675);
});
test('fixture không chứa cột ghi chú hay cột tự tính', () => {
  for (const r of fx.caHoc) assert.equal(r.cells.length, 5);
  assert.deepEqual(fx.meta.columns.caHoc, ['date', 'start_time', 'end_time', 'topic', 'activity']);
});

// ---- Ngày là số nguyên, không lệch múi giờ ----
test('serial <-> ngày: khớp lịch trên 1900–2100', () => {
  for (let s = D(1900, 3, 1); s <= D(2100, 12, 31); s += 13) {
    const { y, m, d } = ymdFromSerial(s);
    const dt = new Date(Date.UTC(1899, 11, 30) + s * 86400000); // chỉ làm "đáp án" trong test
    assert.deepEqual([y, m, d], [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()]);
    assert.equal(D(y, m, d), s);
  }
  assert.equal(D(2026, 10, 21), 46316);
  assert.equal(fmtDate(46351), '25/11/2026');
  assert.equal(weekday(D(2026, 10, 21)), 3); // thứ Tư
});
test('hôm nay theo Asia/Ho_Chi_Minh (UTC+7), không theo múi giờ máy', () => {
  assert.equal(fmtDate(todaySerial(new Date('2026-11-24T16:59:59Z'))), '24/11/2026'); // 23:59:59 giờ VN
  assert.equal(fmtDate(todaySerial(new Date('2026-11-24T17:00:00Z'))), '25/11/2026'); // 00:00 giờ VN
  assert.equal(fmtDate(todaySerial(new Date('2026-11-25T16:59:00Z'))), '25/11/2026');
});
test('gviz: Date(...) -> serial, giờ -> phần thập phân', () => {
  assert.equal(rawCell({ v: 'Date(2026,10,25)', f: '25/11/2026' }, 'gviz'), 46351); // tháng tính từ 0
  assert.equal(rawCell({ v: 'Date(1899,11,30,12,15,0)', f: '12:15' }, 'gviz'), 735 / 1440);
  assert.equal(rawCell(null, 'gviz'), null);
  const rows = parseGvizText('/*O_o*/\ngoogle.visualization.Query.setResponse({"status":"ok","table":{"cols":[{"label":"Ngày"}],"rows":[{"c":[{"v":"Date(2026,10,25)"}]},{"c":[null]}]}});');
  assert.equal(rows.length, 3);
  assert.throws(() => parseGvizText('<html>Sign in</html>'));
});

// ---- Trường hợp biên ----
const topics = parseTopics([['Chủ đề', 'Nhóm'], ['JP - Từ vựng', 'Ngoại ngữ'], [BUSY_TOPIC, 'Không học']], 'values');
const H = (h, m = 0) => (h * 60 + m) / 1440;
const parse = rows => parseSessions([['h'], ...rows], 'values', topics);

test('ca đang mở (chưa có giờ kết thúc): không tính phút, đếm riêng, không phải lỗi', () => {
  const { sessions, issues } = parse([[D(2026, 11, 25), H(8, 40), H(11, 15), 'JP - Từ vựng', 'Lý thuyết'], [D(2026, 11, 25), H(12, 15), null, 'JP - Từ vựng', 'Nhờ AI']]);
  assert.equal(issues.length, 0);
  const s = computeStats(sessions, D(2026, 11, 25));
  assert.equal(s.totalMin, 155);
  assert.equal(s.openSessions.length, 1);
  assert.equal(s.rowsWithTime, 1);
  assert.equal(s.days[D(2026, 11, 25)].studyDay, true); // có 1 ca đã đóng -> ngày có học
});
test('ngày CHỈ có ca đang mở: 0 phút và KHÔNG phải "ngày có học" (quy tắc ca mở L5, Oriana chốt 26/11/2026)', () => {
  // Thay quyết định L4 Q1(c): ngày chỉ tính là có học khi có ≥1 ca đã đóng (có giờ kết thúc).
  const { sessions, issues } = parse([[D(2026, 11, 24), H(8), H(9), 'JP - Từ vựng', 'Ôn tập'], [D(2026, 11, 25), H(12, 15), null, 'JP - Từ vựng', 'Nhờ AI']]);
  assert.equal(issues.length, 0);
  const s = computeStats(sessions, D(2026, 11, 25));
  const day = s.days[D(2026, 11, 25)];
  assert.equal(day.min, 0);
  assert.equal(day.count, 0);   // không có ca nào có thời lượng
  assert.equal(day.open, 1);
  assert.equal(day.studyDay, false);
  assert.equal(s.studyDays, 1);
  assert.equal(s.totalMin, 60);
  assert.equal(s.weeks.at(-1).studyDays, 0); // tuần 6 (25/11) chưa có ngày có học: ca mở chưa đóng
});
test('dòng bị xóa nội dung A–E: bỏ qua', () => {
  const { sessions, issues } = parse([[null, null, null, null, null], ['', '', '', '', '', 'ghi chú sót'], [D(2026, 11, 25), H(8), H(9), 'JP - Từ vựng', 'Ôn tập']]);
  assert.equal(sessions.length, 1);
  assert.equal(issues.length, 0);
});
test('chủ đề chưa có trong bảng Chủ đề -> "Chưa phân loại" + cảnh báo', () => {
  const { sessions, issues } = parse([[D(2026, 11, 25), H(8), H(9), 'JP - Chủ đề mới', 'Ôn tập']]);
  assert.equal(sessions[0].category, UNCATEGORIZED);
  assert.equal(issues.length, 1);
  assert.equal(computeStats(sessions, D(2026, 11, 25)).groups.category[UNCATEGORIZED].min, 60);
});
test('ca qua nửa đêm: +1 ngày, tính vào ngày bắt đầu', () => {
  assert.equal(durationMin(H(23, 30), H(0, 30)), 60);
  const { sessions } = parse([[D(2026, 12, 1), H(23, 30), H(0, 30), 'JP - Từ vựng', 'Ôn tập']]); // thứ Ba, cuối tuần 6
  const s = computeStats(sessions, D(2026, 12, 2));
  assert.equal(s.days[D(2026, 12, 1)].min, 60);
  assert.equal(s.weeks.find(w => w.week === 6).min, 60);
});
test('tuần chưa có dữ liệu vẫn có trong danh sách (0 phút)', () => {
  const s = computeStats(model.sessions, D(2026, 11, 25)); // hôm nay = ngày đầu tuần 6
  const w6 = s.weeks.at(-1);
  assert.deepEqual([w6.week, w6.min, w6.studyDays, w6.daysElapsed, w6.status], [6, 0, 0, 1, WEEK_STATUS.CURRENT]);
});
test('trạng thái tuần theo hôm nay', () => {
  const today = D(2026, 11, 25);
  assert.equal(weekNo(today), 6);
  assert.deepEqual([6, 5, 4, 1, 7].map(w => weekStatus(w, today)),
    [WEEK_STATUS.CURRENT, WEEK_STATUS.PROVISIONAL, WEEK_STATUS.FINAL, WEEK_STATUS.FINAL, WEEK_STATUS.FUTURE]);
  assert.equal(weekStatus(5, D(2026, 11, 24)), WEEK_STATUS.CURRENT);      // thứ Ba vẫn là tuần 5
});
test('tháng thiếu dữ liệu: 10/2026 thiếu đầu tháng; 11/2026 đang diễn ra', () => {
  const [oct, nov] = st.months;
  assert.deepEqual([oct.key, oct.missingStart, oct.inProgress, fmtDate(oct.dataFrom)], ['2026-10', true, false, '21/10/2026']);
  assert.deepEqual([nov.key, nov.missingStart, nov.inProgress, fmtDate(nov.dataTo)], ['2026-11', false, true, '23/11/2026']);
});
test('ngày có dòng "Bận đi làm" không phải ngày có học, giờ ca khác trong ngày vẫn tính', () => {
  const { sessions } = parse([[D(2026, 11, 26), null, null, BUSY_TOPIC, null], [D(2026, 11, 26), H(20), H(20, 30), 'JP - Từ vựng', 'Ôn tập']]);
  const s = computeStats(sessions, D(2026, 11, 26));
  assert.equal(s.studyDays, 0);
  assert.equal(s.totalMin, 30);
});
test('ca có ngày sau hôm nay không vào thống kê', () => {
  const { sessions } = parse([[D(2026, 11, 27), H(8), H(9), 'JP - Từ vựng', 'Ôn tập']]);
  assert.equal(computeStats(sessions, D(2026, 11, 25)).totalMin, 0);
});
