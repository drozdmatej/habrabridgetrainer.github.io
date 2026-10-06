import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contentSchema, normalizeBid, publicationIssues, publishedContent, validateQuestion } from '../app/content-validation.ts';
const content = contentSchema.parse(JSON.parse(readFileSync(new URL('../content/trainer.json', import.meta.url), 'utf8')));

test('all published training content validates and each requested system has lessons', () => {
  assert.deepEqual(publicationIssues(content), []);
  assert.deepEqual(content.systems.map(s => s.id), ['lepsi-levna', 'lepsi-levna-21', 'epstein-precision', 'precision-smith', 'matej-mikulas']);
  for (const system of content.systems) {
    assert.ok(system.rules?.length);
    assert.ok(system.levels.length >= 3);
    for (const level of system.levels) assert.ok(level.questions.length >= 4);
  }
});

test('every hand contains exactly thirteen distinct cards; corrected q-105 has twenty HCP', () => {
  for (const q of content.systems.flatMap(s => s.levels.flatMap(l => l.questions))) {
    if (q.hand) assert.deepEqual(validateQuestion(q), [], q.id);
  }
  const hand = content.systems[0].levels[0].questions.find(q => q.id === 'q-105')!.hand!;
  const points: Record<string, number> = { A: 4, K: 3, Q: 2, J: 1 };
  assert.equal(Object.values(hand).join('').split('').reduce((sum, rank) => sum + (points[rank] || 0), 0), 20);
});

test('invalid hands, bids, and ambiguous multiple-choice answers are rejected', () => {
  const q = content.systems[0].levels[0].questions[0];
  assert.ok(validateQuestion({ ...q, hand: { s: 'AAK', h: 'Q32', d: 'J32', c: '5432' } }).some(x => x.includes('vícekrát')));
  assert.ok(validateQuestion({ ...q, hand: { s: 'AK', h: 'Q32', d: 'J32', c: '5432' } }).some(x => x.includes('12 karet')));
  assert.ok(validateQuestion({ ...q, correctBid: '8NT' }).length);
  assert.ok(validateQuestion({ ...q, type: 'choice', options: [{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B', correct: true }] }).length);
});

test('draft systems and chapters never leak into player content', () => {
  const draft = structuredClone(content);
  draft.systems[1].status = 'draft';
  draft.systems[0].levels[1].status = 'draft';
  const published = publishedContent(draft);
  assert.equal(published.systems.length, 4);
  assert.equal(published.systems[0].levels.length, 2);
  assert.equal(draft.systems.length, 5);
});

test('bid aliases are accepted consistently and invalid bids are empty', () => {
  assert.equal(normalizeBid(' 1 ♥ '), '1H');
  assert.equal(normalizeBid('2BT'), '2NT');
  assert.equal(normalizeBid('pas'), 'PASS');
  assert.equal(normalizeBid('rekontra'), 'XX');
  assert.equal(normalizeBid('8S'), '');
});

test('the two supplied Precision variants retain their different major and balanced responses', () => {
  const question = (systemId: string, id: string) => content.systems.find(s => s.id === systemId)!.levels.flatMap(l => l.questions).find(q => q.id === id)!;
  assert.equal(question('epstein-precision', 'ep-202').correctBid, '1H');
  assert.equal(question('precision-smith', 'sm-202').correctBid, '1S');
  assert.equal(question('epstein-precision', 'ep-205').correctBid, '2NT');
  assert.equal(question('precision-smith', 'sm-203').correctBid, '1H');
  assert.equal(question('epstein-precision', 'ep-302').correctBid, '2H');
  assert.equal(question('precision-smith', 'sm-301').correctBid, '2S');
});

test('the expert standard remains separate, sourced, and uses its own transfer and NT agreements', () => {
  const system = content.systems.find(s => s.id === 'matej-mikulas')!;
  assert.equal(system.difficulty, 'expert');
  assert.ok(system.sources?.some(source => source.includes('Mikulas a Matej sys (1).pdf')));
  const questions = system.levels.flatMap(l => l.questions);
  assert.equal(questions.find(q => q.id === 'mm-201')!.correctBid, '1D');
  assert.equal(questions.find(q => q.id === 'mm-202')!.correctBid, '1H');
  assert.ok(questions.find(q => q.id === 'mm-301')!.options!.find(o => o.correct)!.text.includes('NF'));
  assert.equal(questions.find(q => q.id === 'mm-104')!.correctBid, '2NT');
});
