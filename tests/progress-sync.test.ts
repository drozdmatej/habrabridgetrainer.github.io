import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceReplica, aggregateReplicas, completeLevel, emptyProgress, mergeSameReplica, progressStoreSchema, recordAnswer, smartExamples } from '../app/progress.ts';
import type { ProgressReplica, ProgressStore } from '../app/progress.ts';
const a = '00000000-0000-4000-8000-000000000001', b = '00000000-0000-4000-8000-000000000002';
const store = (progress = emptyProgress()): ProgressStore => ({ selectedSystemId: 's', systems: { s: progress } });
const replica = (deviceId: string, data: ProgressStore): ProgressReplica => ({ deviceId, revision: 1, store: data });
test('independent devices add answers once, even after a duplicate upload or aggregation', () => {
  const one = store(recordAnswer(emptyProgress(), 'l', 'q', false, 100));
  const two = store(recordAnswer(emptyProgress(), 'l', 'q', true, 200));
  const combined = aggregateReplicas([replica(a, one), replica(a, one), replica(b, two)], 's');
  assert.equal(combined.systems.s.answered, 2); assert.equal(combined.systems.s.correct, 1);
  assert.deepEqual(combined.systems.s.mistakes.l, []);
  assert.equal(combined.systems.s.questionStats!.l.q.errors, 1);
  assert.equal(combined.systems.s.questionStats!.l.q.attempts, 2);
  assert.deepEqual(aggregateReplicas([replica(b, two), replica(a, one)], 's'), combined);
});
test('stale same-device snapshots cannot remove newer answers, achievements or resolved mistakes', () => {
  const old = store(recordAnswer(emptyProgress(), 'l', 'q', false, 100));
  const newer = store(completeLevel(recordAnswer(old.systems.s, 'l', 'q', true, 200), 'l', 'test', 9, 10, 80));
  const merged = mergeSameReplica(newer, old);
  assert.equal(merged.systems.s.answered, 2); assert.equal(merged.systems.s.correct, 1);
  assert.deepEqual(merged.systems.s.mistakes.l, []);
  assert.equal(merged.systems.s.levels.l.testPassed, true);
  assert.equal(merged.systems.s.levels.l.bestScore, 90);
});
test('editing the aggregate produces only this device delta, never a copy of remote counters', () => {
  const remote = store(recordAnswer(emptyProgress(), 'l', 'q', false, 100));
  const local: ProgressStore = { selectedSystemId: 's', systems: {} };
  const before = aggregateReplicas([replica(b, remote), replica(a, local)], 's');
  const after = store(recordAnswer(before.systems.s, 'l', 'q', true, 200));
  const next = advanceReplica(local, before, after);
  assert.equal(next.systems.s.answered, 1); assert.equal(next.systems.s.correct, 1);
  assert.equal(next.systems.s.questionStats!.l.q.attempts, 1);
  assert.equal(next.systems.s.questionStats!.l.q.errors, 0);
  assert.deepEqual(aggregateReplicas([replica(a, next), replica(b, remote)], 's').systems.s.mistakes.l, []);
});
test('old local progress imports with its counters and mistakes without duplicating them', () => {
  const legacy = store({ ...emptyProgress(), answered: 20, correct: 15, mistakes: { l: ['q'] } });
  const newer = store(recordAnswer(emptyProgress(), 'l', 'q', true, 100));
  const merged = aggregateReplicas([replica(a, legacy), replica(b, newer)], 's').systems.s;
  assert.equal(merged.answered, 21); assert.equal(merged.correct, 16);
  assert.deepEqual(merged.mistakes.l, []);
  assert.equal(progressStoreSchema.safeParse({ selectedSystemId: 's', systems: { constructor: emptyProgress() } }).success, false);
});
test('spaced repetition resets after a mistake and increases the interval after correct answers', () => {
  let progress = recordAnswer(emptyProgress(), 'l', 'q', false, 100);
  assert.equal(progress.questionStats!.l.q.dueAt, 100);
  progress = recordAnswer(progress, 'l', 'q', true, 200);
  assert.equal(progress.questionStats!.l.q.dueAt, 200 + 86_400_000);
  progress = recordAnswer(progress, 'l', 'q', true, 300);
  assert.equal(progress.questionStats!.l.q.dueAt, 300 + 3 * 86_400_000);
  progress = recordAnswer(progress, 'l', 'q', false, 400);
  assert.equal(progress.questionStats!.l.q.streak, 0);
  assert.equal(progress.questionStats!.l.q.dueAt, 400);
});
test('smart repetition prioritizes errors, overdue questions and unseen examples ahead of recent successes', () => {
  const level = { id: 'l', title: 'L', description: '', passingPercent: 80, questions: [] };
  const pool = ['recent', 'new', 'due', 'wrong'].map(id => ({ level, question: { id, type: 'bid_box' as const, prompt: id, rationale: 'NF', sequence: [], correctBid: 'PASS' } }));
  let progress = recordAnswer(emptyProgress(), 'l', 'recent', true, 200_000_000);
  progress = recordAnswer(progress, 'l', 'due', true, 1);
  progress = recordAnswer(progress, 'l', 'wrong', false, 200_000_001);
  assert.deepEqual(smartExamples(pool, progress, 'all', 200_000_002, () => .5).map(q => q.question.id), ['wrong', 'due', 'new', 'recent']);
  assert.equal(smartExamples(pool, progress, 2).length, 2);
});

test('completion on one device synchronizes without reimporting another device answer counts', () => {
  const remote = store(recordAnswer(emptyProgress(), 'l', 'q', true, 100));
  const local: ProgressStore = { selectedSystemId: 's', systems: {} };
  const before = aggregateReplicas([replica(b, remote)], 's');
  const after = store(completeLevel(before.systems.s, 'l', 'test', 9, 10, 80));
  const advanced = advanceReplica(local, before, after);
  const merged = aggregateReplicas([replica(b, remote), replica(a, advanced)], 's');
  assert.equal(advanced.systems.s.answered, 0);
  assert.equal(merged.systems.s.answered, 1);
  assert.equal(merged.systems.s.levels.l.testPassed, true);
  assert.equal(merged.systems.s.levels.l.bestScore, 90);
});
