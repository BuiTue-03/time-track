// stats-extra.test.mjs — Test phép tính mới của L4.5 (vòng hôm nay, tuần theo ngày, xu hướng, khung giờ). Chạy: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildModel, serialFromYMD as D } from '../src/core.js';
import { weekDays, weekVsPrevByDay, trendAvg4, timeOfDay, latestOpen, dayMinutes } from '../src/stats-extra.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/sheet-to-2026-11-23.json', import.meta.url), 'utf8'));
const at = today => buildModel({ caRows: fx.caHoc, cdRows: fx.chuDe, source: 'values', today });
const m25 = at(D(2026, 11, 25));

test('7 ngày của tuần: tổng = phút của tuần, ngày sau hôm nay đánh dấu chưa tới', () => {
  for (const w of m25.stats.weeks) {
    const days = weekDays(m25.stats, w.week);
    assert.equal(days.length, 7);
    assert.equal(days.reduce((s, d) => s + d.min, 0), w.min);
    assert.equal(days[0].date, w.start);
  }
  const cur = weekDays(m25.stats, 6);
  assert.deepEqual(cur.map(d => d.future), [false, true, true, true, true, true, true]); // 25/11 là thứ Tư
  assert.equal(dayMinutes(m25.stats, D(2026, 11, 25)), cur[0].min);
});

test('thứ Ba so với tuần trước: tổng 2 tuần khớp bảng tuần', () => {
  const m = at(D(2026, 11, 24)); // thứ Ba, tuần 5
  const c = weekVsPrevByDay(m.stats);
  assert.equal(c.week, 5);
  assert.equal(c.curMin, m.stats.weeks[4].min);
  assert.equal(c.prevMin, m.stats.weeks[3].min);
  assert.equal(weekVsPrevByDay(at(D(2026, 10, 22)).stats), null); // tuần 1: không có tuần trước
});

test('xu hướng [DỰ ĐOÁN]: trung bình 4 tuần đã qua gần nhất + dải thấp nhất–cao nhất', () => {
  const t = trendAvg4(m25.stats);
  assert.deepEqual(t.baseWeeks, [2, 3, 4, 5]);
  assert.equal(t.avgMin, (1715 + 1200 + 1273 + 957) / 4);
  assert.equal(t.lo, 957);
  assert.equal(t.hi, 1715);
  assert.equal(trendAvg4(at(D(2026, 10, 25)).stats), null); // tuần 1 đang diễn ra: chưa có tuần nào đã qua
});

test('khung giờ: tổng 4 khung = tổng phút; ca vắt qua khung được chia phút', () => {
  const s = m25.stats;
  const tod = timeOfDay(m25.sessions, D(2026, 10, 21), s.today);
  assert.equal(tod.reduce((a, b) => a + b.min, 0), s.totalMin);
  const mk = (start, end) => ({ date: 100, start, end, duration: Math.round(((end - start + (end < start ? 1 : 0))) * 1440) });
  const one = list => timeOfDay(list, 0, 1000).map(b => b.min);
  // thứ tự khung: Sáng, Chiều, Tối, Khuya
  assert.deepEqual(one([mk(11.5 / 24, 12.5 / 24)]), [30, 30, 0, 0]);        // 11:30–12:30
  assert.deepEqual(one([mk(23.5 / 24, 0.5 / 24)]), [0, 0, 30, 30]);         // 23:30–00:30 (qua nửa đêm)
  assert.deepEqual(one([mk(4 / 24, 19 / 24)]), [420, 360, 60, 60]);         // 04:00–19:00
  assert.deepEqual(one([mk(5 / 24, 12 / 24)]), [420, 0, 0, 0]);             // đúng mốc: 05:00–12:00 là Sáng
  assert.deepEqual(one([{ date: 100, start: 0.5, end: null, duration: null }]), [0, 0, 0, 0]); // ca đang mở: không tính
});

test('ca đang mở mới nhất + thời lượng tạm tới bây giờ', () => {
  const stats = { today: 50, openSessions: [{ date: 49, start: 0.5 }, { date: 50, start: 14 / 24 + 50 / 1440 }, { date: 50, start: 0.25 }] };
  const o = latestOpen(stats, 15 * 60 + 34);
  assert.equal(o.startMin, 14 * 60 + 50);
  assert.equal(o.runningMin, 44);
  assert.equal(o.others, 2);
  assert.equal(latestOpen({ today: 50, openSessions: [] }, 0), null);
  assert.equal(latestOpen({ today: 50, openSessions: [{ date: 49, start: 0.5 }] }, 600).runningMin, null); // ca của hôm trước: không đoán thời lượng
});
