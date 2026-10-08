import test from 'node:test';
import assert from 'node:assert/strict';
import { completeLevel, emptyProgress, passesTest, recordAnswer, restoreProgress, shuffle, updateStoredProgress, readStoredProgress, scorePercent } from '../app/progress.ts';

test('legacy progress migrates only to the original system and keeps the backup format', () => {
  const legacy = { levels: { zahajeni: { lessonCompleted: true, testPassed: true, bestScore: 90 } }, answered: 10, correct: 9 };
  const restored = restoreProgress(null, JSON.stringify(legacy), 'lepsi-levna');
  assert.equal(restored.systems['lepsi-levna'].levels.zahajeni.bestScore, 90);
  assert.deepEqual(restored.systems['lepsi-levna'].mistakes, {});
  assert.equal(restored.systems.precision, undefined);
});

const key = 'habra-progress-pages-v2:/';
function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test('storage transactions retain both tabs answers and updates to different systems', () => {
  const storage = memoryStorage();
  updateStoredProgress(storage, key, 'a', latest => ({ ...latest, systems: { ...latest.systems, a: recordAnswer(latest.systems.a || emptyProgress(), 'l', 'q1', true) } }));
  updateStoredProgress(storage, key, 'a', latest => ({ ...latest, systems: { ...latest.systems, a: recordAnswer(latest.systems.a || emptyProgress(), 'l', 'q2', false) } }));
  updateStoredProgress(storage, key, 'a', latest => ({ ...latest, systems: { ...latest.systems, b: recordAnswer(latest.systems.b || emptyProgress(), 'l', 'q1', true) } }));
  const { store } = readStoredProgress(storage, key, 'a');
  assert.equal(store.systems.a.answered, 2);
  assert.equal(store.systems.a.correct, 1);
  assert.equal(store.systems.b.answered, 1);
});

test('corrupt saved progress is preserved before replacing it; loading alone does not overwrite it', () => {
  const storage = memoryStorage();
  storage.setItem(key, '{broken');
  assert.equal(readStoredProgress(storage, key, 'a').damaged, true);
  assert.equal(storage.getItem(key), '{broken');
  updateStoredProgress(storage, key, 'a', latest => latest);
  assert.equal(storage.getItem(key + ':damaged'), '{broken');
  storage.setItem(key, '{other');
  updateStoredProgress(storage, key, 'a', latest => latest);
  assert.equal(storage.getItem(key + ':damaged'), '{broken');
  assert.equal(storage.getItem(key + ':damaged:1'), '{other');
});

test('a below-threshold score is displayed below the threshold instead of rounding to 80', () => {
  assert.equal(scorePercent(39, 49), 79.59);
  assert.equal(scorePercent(0, 0), 0);
  const result = completeLevel(emptyProgress(), 'a', 'test', 39, 49, 80);
  assert.equal(result.levels.a.bestScore, 79.59);
  assert.equal(result.levels.a.testPassed, false);
});

test('selected system, same-named chapters, and mistakes survive serialization separately', () => {
  const original = { selectedSystemId: 'precision', systems: {
    'lepsi-levna': completeLevel(emptyProgress(), 'zahajeni', 'test', 9, 10, 80),
    precision: recordAnswer(emptyProgress(), 'zahajeni', 'prec-101', false),
  } };
  const result = restoreProgress(JSON.stringify(original), null, 'lepsi-levna');
  assert.deepEqual(result, original);
  assert.equal(result.systems.precision.levels.zahajeni, undefined);
});

test('malformed storage and invalid counts cannot break training', () => {
  for (const saved of ['{', 'null', JSON.stringify({ selectedSystemId: 'a', systems: { a: { levels: {}, answered: 1, correct: 2 } } })]) {
    assert.deepEqual(restoreProgress(saved, '{', 'a'), { selectedSystemId: 'a', systems: {} });
  }
});

test('mistakes are unique per chapter and disappear after a correct answer', () => {
  const original = emptyProgress();
  let progress = recordAnswer(original, 'chapter-a', 'q1', false);
  progress = recordAnswer(progress, 'chapter-a', 'q1', false);
  progress = recordAnswer(progress, 'chapter-b', 'q1', false);
  progress = recordAnswer(progress, 'chapter-a', 'q1', true);
  assert.deepEqual(progress.mistakes, { 'chapter-a': [], 'chapter-b': ['q1'] });
  assert.equal(progress.answered, 4);
  assert.equal(progress.correct, 1);
  assert.deepEqual(original, emptyProgress());
});

test('review does not complete lessons, pass tests, or unlock chapters', () => {
  const original = emptyProgress();
  assert.deepEqual(completeLevel(original, 'a', 'review', 10, 10, 80), original);
  const lesson = completeLevel(original, 'a', 'lesson', 0, 10, 80);
  assert.equal(lesson.levels.a.lessonCompleted, true);
  assert.equal(lesson.levels.a.testPassed, false);
});

test('test thresholds use the actual score; best results never regress', () => {
  assert.equal(passesTest(39, 49, 80), false); // 79.59% rounds to 80%, but is below the threshold.
  assert.equal(passesTest(8, 10, 80), true);
  assert.equal(passesTest(0, 0, 80), false);
  const passed = completeLevel(emptyProgress(), 'a', 'test', 9, 10, 80);
  const retry = completeLevel(passed, 'a', 'test', 2, 10, 80);
  assert.equal(retry.levels.a.bestScore, 90);
  assert.equal(retry.levels.a.testPassed, true);
});

test('test shuffle retains each question exactly once without changing content order', () => {
  const questions = ['a', 'b', 'c', 'd'];
  const shuffled = shuffle(questions, () => 0);
  assert.deepEqual([...shuffled].sort(), questions);
  assert.notDeepEqual(shuffled, questions);
  assert.deepEqual(questions, ['a', 'b', 'c', 'd']);
});


test('zero-score test is distinguishable from an unattempted test and survives storage', () => {
  const lesson = completeLevel(emptyProgress(), 'a', 'lesson', 0, 4, 80);
  assert.equal(lesson.levels.a.testAttempted, false);
  const failed = completeLevel(lesson, 'a', 'test', 0, 4, 80);
  const saved = restoreProgress(JSON.stringify({ selectedSystemId: 's', systems: { s: failed } }), null, 's');
  assert.equal(saved.systems.s.levels.a.testAttempted, true);
  assert.equal(saved.systems.s.levels.a.bestScore, 0);
  assert.equal(saved.systems.s.levels.a.testPassed, false);
  assert.equal(completeLevel(failed, 'a', 'lesson', 4, 4, 80).levels.a.testAttempted, true);
});
