// l6-core.test.mjs — Thay đổi core.js của L6 (Oriana duyệt Phần A câu m, 26/11/2026):
//   - "Nghỉ ngơi" cũng là ngày không học (như "Bận đi làm"), kể cả khi ngày đó có ca đã đóng (giờ vẫn cộng).
//   - Dòng nhóm "Không học" không có giờ thì không bắt buộc hoạt động (không báo "Hoạt động không hợp lệ").
import test from 'node:test';
import assert from 'node:assert/strict';
import { serialFromYMD as D, BUSY_TOPIC, REST_TOPICS, parseSessions, parseTopics, computeStats } from '../src/core.js';

const H = (h, m = 0) => (h * 60 + m) / 1440;
const T = D(2026, 11, 26);
const topics = parseTopics([['Chủ đề', 'Nhóm'], ['JP - Từ vựng', 'Ngoại ngữ'], [BUSY_TOPIC, 'Không học'], ['Nghỉ ngơi', 'Không học']], 'values');
const parse = rows => parseSessions([['h'], ...rows], 'values', topics);

test('REST_TOPICS = Bận đi làm + Nghỉ ngơi (danh sách duy nhất cho cả app)', () => {
  assert.deepEqual(REST_TOPICS, [BUSY_TOPIC, 'Nghỉ ngơi']);
});

test('dòng Nghỉ ngơi không giờ, không hoạt động: không bị báo lỗi, không phải ca mở, ngày không học', () => {
  const { sessions, issues } = parse([[T, null, null, 'Nghỉ ngơi', null, null]]);
  assert.deepEqual(issues, []);
  assert.equal(sessions[0].open, false);
  assert.equal(sessions[0].rest, true);
  const st = computeStats(sessions, T);
  assert.equal(st.days[T].rest, true);
  assert.equal(st.days[T].studyDay, false);
  assert.equal(st.openSessions.length, 0);
});

test('ngày có Nghỉ ngơi + 1 ca đã đóng: giờ vẫn cộng, ngày KHÔNG là ngày có học', () => {
  const { sessions } = parse([[T, null, null, 'Nghỉ ngơi', null, null], [T, H(9), H(10), 'JP - Từ vựng', 'Ôn tập', '']]);
  const st = computeStats(sessions, T);
  assert.equal(st.totalMin, 60);
  assert.equal(st.days[T].min, 60);
  assert.equal(st.days[T].studyDay, false);
  assert.equal(st.studyDays, 0);
});

test('Bận đi làm vẫn như cũ (busy + rest), ca học thường vẫn bắt buộc hoạt động', () => {
  const { sessions, issues } = parse([[T, null, null, BUSY_TOPIC, null, null], [T - 1, H(9), H(10), 'JP - Từ vựng', null, '']]);
  assert.equal(sessions[0].busy, true);
  assert.equal(sessions[0].rest, true);
  assert.equal(issues.length, 1);
  assert.match(issues[0].msg, /Hoạt động không hợp lệ/);
});
