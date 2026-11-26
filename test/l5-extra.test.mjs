// l5-extra.test.mjs — Hàm thuần mới của L5: vòng tuần, vạch mốc TB 4 tuần, huy hiệu, chọn câu theo ngày.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { serialFromYMD as D, BUSY_TOPIC, CONFIG, buildModel, parseSessions, parseTopics, computeStats } from '../src/core.js';
import { weekRing, avg4Marker } from '../src/stats-extra.js';
import { MILESTONES_H, milestoneProgress, celebrationPlan } from '../src/milestones.js';
import { eligible, quoteForDay, pickGroup, dayIndex, otherQuote, displayParts, REST_TOPICS } from '../src/quotes.js';

const H = (h, m = 0) => (h * 60 + m) / 1440;
const fx = JSON.parse(readFileSync(new URL('./fixtures/sheet-to-2026-11-23.json', import.meta.url), 'utf8'));
const QUOTES = JSON.parse(readFileSync(new URL('../quotes.json', import.meta.url), 'utf8')).quotes;
const model = buildModel({ caRows: fx.caHoc, cdRows: fx.chuDe, source: 'values', today: D(2026, 11, 23) });
const topics = parseTopics([['Chủ đề', 'Nhóm'], ['JP - Từ vựng', 'Ngoại ngữ'], [BUSY_TOPIC, 'Không học'], ['Nghỉ ngơi', 'Không học']], 'values');
const parse = rows => parseSessions([['h'], ...rows], 'values', topics).sessions;

// ---------- Vòng tuần ----------
test('vòng tuần: phút tuần / 1440, vượt 100% thì vòng đầy, có cờ "vượt"', () => {
  const st = model.stats; // hôm nay 23/11, tuần 5 đang diễn ra
  const r = weekRing(st);
  assert.equal(r.goal, 1440);
  assert.equal(r.min, 957);
  assert.equal(r.studyDays, 6);
  assert.equal(r.goalDays, 6);
  assert.ok(Math.abs(r.pct - 957 / 1440) < 1e-9);
  assert.equal(r.reached, false);
  const big = weekRing({ ...st, weeks: st.weeks.map(w => (w.week === 5 ? { ...w, min: 1600 } : w)) });
  assert.equal(big.pct, 1);
  assert.equal(big.reached, true);
});
test('vạch mốc TB 4 tuần: tuần đã qua gần nhất, tính cả Tạm chốt (kèm cờ), thiếu tuần thì dùng số có', () => {
  const m = avg4Marker(model.stats); // tuần 1–4 đã qua (tuần 4 Tạm chốt)
  assert.deepEqual(m.weeks, [1, 2, 3, 4]);
  assert.equal(m.avgMin, (1530 + 1715 + 1200 + 1273) / 4);
  assert.equal(m.enough, true);
  assert.equal(m.includesProvisional, true);
  const early = buildModel({ caRows: fx.caHoc, cdRows: fx.chuDe, source: 'values', today: D(2026, 11, 5) }).stats; // tuần 3
  const e = avg4Marker(early);
  assert.deepEqual(e.weeks, [1, 2]);
  assert.equal(e.enough, false);
  assert.equal(avg4Marker(computeStats([], D(2026, 10, 22))), null); // tuần 1: chưa có tuần nào đã qua
});

// ---------- Huy hiệu ----------
test('mốc huy hiệu đã duyệt', () => {
  assert.deepEqual(MILESTONES_H, [10, 25, 50, 100, 150, 200, 300, 500, 750, 1000]);
});
test('huy hiệu trên dữ liệu mẫu: đạt 10/25/50/100 giờ, ngày đạt mốc lấy từ dữ liệu', () => {
  const p = milestoneProgress(model.sessions, CONFIG);
  assert.equal(p.totalMin, 6675);
  assert.deepEqual(p.list.filter(x => x.reached).map(x => x.hours), [10, 25, 50, 100]);
  for (const x of p.list.filter(x => x.reached)) assert.ok(x.date >= CONFIG.startDate && x.date <= D(2026, 11, 23));
  assert.equal(p.next.hours, 150);
  assert.equal(p.next.leftMin, 150 * 60 - 6675);
});
test('ngày đạt mốc: ca qua đêm tính ngày bắt đầu; ca mở và ca trước 21/10 không tính', () => {
  const s = parse([
    [D(2026, 10, 20), H(8), H(18), 'JP - Từ vựng', 'Lý thuyết'],          // trước ngày bắt đầu: không tính
    [D(2026, 10, 21), H(8), H(13), 'JP - Từ vựng', 'Lý thuyết'],          // 300 phút
    [D(2026, 10, 22), H(22), H(5), 'JP - Từ vựng', 'Lý thuyết'],          // qua đêm 420 phút -> đủ 600 (10 giờ) vào 22/10
    [D(2026, 10, 23), H(8), null, 'JP - Từ vựng', 'Lý thuyết'],           // ca mở: không tính
  ]);
  const p = milestoneProgress(s, CONFIG);
  assert.equal(p.totalMin, 720);
  assert.equal(p.list[0].reached, true);
  assert.equal(p.list[0].date, D(2026, 10, 22));
  // Xóa ca 22/10 -> mất mốc (ngày đạt mốc không lưu riêng)
  assert.equal(milestoneProgress(s.filter(x => x.date !== D(2026, 10, 22)), CONFIG).list[0].reached, false);
});
test('ăn mừng: lần chạy đầu chỉ đánh dấu đã xem; sau đó mỗi mốc mới ăn mừng 1 lần', () => {
  const reached = [10, 25, 50, 100];
  const first = celebrationPlan(reached, null); // null = thiết bị chưa từng lưu
  assert.deepEqual(first.celebrate, []);
  assert.deepEqual(first.seen, [10, 25, 50, 100]);
  const next = celebrationPlan([10, 25, 50, 100, 150], first.seen);
  assert.deepEqual(next.celebrate, [150]);
  assert.deepEqual(next.seen, [10, 25, 50, 100, 150]);
  // Xóa ca làm mất mốc 150 rồi đạt lại: không ăn mừng lần 2
  assert.deepEqual(celebrationPlan([10, 25, 50, 100], next.seen).seen, [10, 25, 50, 100, 150]);
  assert.deepEqual(celebrationPlan([10, 25, 50, 100, 150], next.seen).celebrate, []);
  // Đạt 2 mốc cùng lúc: ăn mừng 1 lần với mốc lớn nhất
  assert.deepEqual(celebrationPlan([10, 25, 50], [10]).celebrate, [50]);
});

// ---------- Câu khích lệ ----------
test('quotes.json: 120 câu, id không trùng; loại verified_weak và unverified', () => {
  assert.equal(QUOTES.length, 120);
  assert.equal(new Set(QUOTES.map(q => q.id)).size, 120);
  const pools = Object.fromEntries(['co_gang', 'nghi_ngoi', 'khong_nhu_y'].map(g => [g, eligible(QUOTES, g)]));
  assert.deepEqual(Object.values(pools).map(p => p.length), [63, 41, 12]);
  for (const p of Object.values(pools)) for (const q of p) assert.ok(!['verified_weak', 'unverified'].includes(q.status));
  assert.ok(!pools.co_gang.some(q => q.id === 'q009'));
});
test('cùng ngày cùng nhóm thì cùng câu (không phụ thuộc thứ tự trong file)', () => {
  const n = dayIndex(D(2026, 11, 26), CONFIG);
  assert.equal(n, 36);
  const a = quoteForDay(QUOTES, 'co_gang', n), b = quoteForDay([...QUOTES].reverse(), 'co_gang', n);
  assert.equal(a.id, b.id);
});
test('không lặp câu trong 1 vòng; không lặp ở chỗ nối 2 vòng', () => {
  for (const g of ['co_gang', 'nghi_ngoi', 'khong_nhu_y']) {
    const L = eligible(QUOTES, g).length;
    for (let c = 0; c < 6; c++) {
      const ids = Array.from({ length: L }, (_, i) => quoteForDay(QUOTES, g, c * L + i).id);
      assert.equal(new Set(ids).size, L, `${g} vòng ${c}`);
      assert.notEqual(quoteForDay(QUOTES, g, (c + 1) * L).id, quoteForDay(QUOTES, g, (c + 1) * L - 1).id, `${g} nối vòng ${c}`);
    }
  }
});
test('chọn nhóm: ngày thường = co_gang; ngày nghỉ hoặc đã đạt mục tiêu tuần = nghi_ngoi; không bao giờ tự chọn khong_nhu_y', () => {
  const T = D(2026, 11, 26);
  assert.deepEqual(REST_TOPICS, [BUSY_TOPIC, 'Nghỉ ngơi']);
  const st = rows => computeStats(parse(rows), T);
  assert.equal(pickGroup(st([[T, H(8), H(9), 'JP - Từ vựng', 'Ôn tập']]), parse([[T, H(8), H(9), 'JP - Từ vựng', 'Ôn tập']])), 'co_gang');
  const rest = [[T, null, null, 'Nghỉ ngơi', null]];
  assert.equal(pickGroup(st(rest), parse(rest)), 'nghi_ngoi');
  const busy = [[T, null, null, BUSY_TOPIC, null]];
  assert.equal(pickGroup(st(busy), parse(busy)), 'nghi_ngoi');
  const goal = [[D(2026, 11, 25), H(0), H(23), 'JP - Từ vựng', 'Ôn tập'], [T, H(0), H(2), 'JP - Từ vựng', 'Ôn tập']]; // 1500 phút >= 1440
  assert.equal(pickGroup(st(goal), parse(goal)), 'nghi_ngoi');
  assert.equal(pickGroup(computeStats([], T), []), 'co_gang'); // chưa có ca nào
});
test('"Xem câu khác": lấy lần lượt từ khong_nhu_y, quay vòng, cố định theo ngày', () => {
  const n = 36, L = eligible(QUOTES, 'khong_nhu_y').length;
  const seq = Array.from({ length: L }, (_, k) => otherQuote(QUOTES, n, k + 1).id);
  assert.equal(new Set(seq).size, L);
  assert.equal(otherQuote(QUOTES, n, L + 1).id, seq[0]);
  assert.ok(seq.every(id => QUOTES.find(q => q.id === id).group === 'khong_nhu_y'));
});
test('hiển thị: câu Claude viết không có tác giả; câu có nguồn hiện tác giả; tiếng Nhật gốc theo công tắc, không hiện cách đọc', () => {
  const byId = id => QUOTES.find(q => q.id === id);
  const claude = displayParts(QUOTES.find(q => q.status === 'claude'), { showJapanese: true });
  assert.equal(claude.author, null);
  assert.equal(claude.big, null);
  const tuan = displayParts(byId('q001'), { showJapanese: true });
  assert.equal(tuan.author, 'Tuân Tử');            // work trùng tên tác giả: không lặp
  assert.equal(tuan.big, null);                      // Hán văn show_original = false: không hiện chữ gốc
  const ja = displayParts(byId('q093'), { showJapanese: true });
  assert.equal(ja.big, '七転び八起き');
  assert.equal(ja.vi, 'Ngã bảy lần, đứng dậy tám lần.');
  assert.equal(ja.author, 'Tục ngữ Nhật Bản');
  assert.equal('reading' in ja, false);
  assert.equal(displayParts(byId('q093'), { showJapanese: false }).big, null);
  const poem = displayParts(byId('q112'), { showJapanese: true });
  assert.ok(poem.note && poem.note.startsWith('Cách hiểu'));
  assert.equal(JSON.stringify(poem).includes('春眠不覺曉'), false); // original_zh không hiện
});
