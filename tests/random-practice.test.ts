import test from 'node:test';
import assert from 'node:assert/strict';
import { practicePool, randomExamples } from '../app/progress.ts';
import type { TrainerSystem } from '../app/types.ts';
const q = (id: string) => ({ id, type: 'bid_box' as const, prompt: id, sequence: [], correctBid: 'PASS', rationale: 'NF.' });
const system: TrainerSystem = { id: 's', name: 'S', status: 'active', levels: [
  { id: 'a', title: 'A', description: '', passingPercent: 80, questions: [q('same'), q('a2')], test: { source: 'separate', questions: [q('test-only')] } },
  { id: 'b', title: 'B', description: '', passingPercent: 80, questions: [q('same'), q('b2')] },
  { id: 'draft', title: 'Draft', description: '', status: 'draft', passingPercent: 80, questions: [q('hidden')] },
] };
test('random pool uses training questions and preserves chapter identity even for equal question IDs', () => {
  const pool = practicePool(system);
  assert.equal(pool.length, 4);
  assert.deepEqual(pool.map(item => item.level.id + ':' + item.question.id), ['a:same', 'a:a2', 'b:same', 'b:b2']);
  assert.equal(practicePool({ ...system, status: 'draft' }).length, 0);
});
test('unlocked practice pool excludes locked chapters and supports an empty set', () => {
  assert.deepEqual(practicePool(system, new Set(['a'])).map(item => item.level.id), ['a', 'a']);
  assert.deepEqual(practicePool(system, new Set()), []);
});
test('random selection is bounded, has no repeats, keeps source order intact and changes with the draw', () => {
  const pool = practicePool(system);
  const selected = randomExamples(pool, 3, () => 0);
  assert.equal(selected.length, 3);
  assert.equal(new Set(selected.map(item => item.level.id + ':' + item.question.id)).size, 3);
  assert.notDeepEqual(selected, randomExamples(pool, 3, () => 0.99));
  assert.equal(randomExamples(pool, 100).length, 4);
  assert.equal(randomExamples(pool, 'all').length, 4);
  assert.deepEqual(randomExamples([], 10), []);
  assert.deepEqual(pool.map(item => item.level.id + ':' + item.question.id), ['a:same', 'a:a2', 'b:same', 'b:b2']);
});
