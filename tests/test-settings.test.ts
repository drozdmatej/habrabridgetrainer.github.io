import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contentSchema, publicationIssues, loadPublishedContent, allLevelQuestions, testPool, publicContent } from '../app/content-validation.ts';
import type { TrainerContent } from '../app/types.ts';
const original: TrainerContent = JSON.parse(readFileSync('content/trainer.json', 'utf8'));
function fixture() {
  const content = structuredClone(original);
  const level = content.systems[0].levels[0];
  level.test = { source: 'separate', questions: level.questions.slice(0, 3).map(q => ({ ...q, id: 'test-' + q.id })), questionCount: 2, requireLesson: false, shuffle: false };
  return { content, level };
}
test('independent test settings and questions survive validation and publishing', () => {
  const { content, level } = fixture();
  content.systems[0].access = 'restricted';
  content.systems[0].rules = ['1♣ = 16+ FB', '1♦ = 11–15 FB'];
  assert.deepEqual(contentSchema.parse(content), content);
  assert.deepEqual(publicationIssues(content), []);
  assert.deepEqual(loadPublishedContent(content).systems[0].levels[0].test, level.test);
  assert.equal(testPool(level).length, 3);
  assert.equal(allLevelQuestions(level).length, level.questions.length + 3);
});
test('invalid separate questions, duplicate IDs and impossible test sizes are rejected', () => {
  const { content, level } = fixture();
  level.test!.questionCount = 4;
  assert.ok(publicationIssues(content).some(issue => /Počet úloh/.test(issue.message)));
  level.test!.questionCount = 0;
  assert.equal(contentSchema.safeParse(content).success, false);
  level.test!.questionCount = 2;
  level.test!.questions![0].id = level.questions[0].id;
  assert.equal(contentSchema.safeParse(content).success, false);
  level.test!.questions![0].id = 'distinct';
  level.test!.questions![0].correctBid = '8NT';
  assert.ok(publicationIssues(content).some(issue => issue.bank === 'test' && issue.questionId === 'distinct'));
  level.test!.questions = [];
  assert.ok(publicationIssues(content).some(issue => /Test nemá/.test(issue.message)));
});
test('dormant separate questions are not used in training or review', () => {
  const { level } = fixture();
  level.test!.source = 'lesson';
  assert.deepEqual(testPool(level), level.questions);
  assert.deepEqual(allLevelQuestions(level), level.questions);
});
test('empty locked content is accepted only for server access responses', () => {
  const denied = { title: 'HABRA', academyName: 'HABRA', systems: [], lockedSystems: [{ id: 'locked', name: 'Uzamčeno' }] };
  assert.deepEqual(loadPublishedContent(denied, true), denied);
  assert.throws(() => loadPublishedContent(denied));
  assert.throws(() => loadPublishedContent({ ...denied, systems: [{}] }, true));
  assert.throws(() => loadPublishedContent({ ...denied, lockedSystems: [{ id: '__proto__', name: 'Uzamčeno' }] }, true));
});

test('static public build contains no restricted questions', () => {
  const { content } = fixture();
  content.systems[0].access = 'restricted';
  const publicOnly = publicContent(content);
  assert.equal(publicOnly.systems.some(s => s.id === content.systems[0].id), false);
  assert.deepEqual(publicOnly.lockedSystems, [{ id: content.systems[0].id, name: content.systems[0].name }]);
  assert.equal(JSON.stringify(publicOnly).includes('test-' + content.systems[0].levels[0].questions[0].id), false);
});
