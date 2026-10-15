import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auctionState, callError, questionAuction, questionCallError, seats } from '../app/auction.ts';
import { contentSchema, loadPublishedContent, publicationIssues, validateQuestion } from '../app/content-validation.ts';
import type { Auction, Seat, TrainerQuestion } from '../app/types.ts';

function auction(bids: string[], dealer: Seat = 'N'): Auction {
  return { dealer, player: seats[(seats.indexOf(dealer) + bids.length) % 4], vulnerability: 'none',
    calls: bids.map((bid, i) => ({ seat: seats[(seats.indexOf(dealer) + i) % 4], bid })) };
}
function legal(bids: string[], bid: string, dealer: Seat = 'N') {
  const a = auction(bids, dealer);
  return callError(auctionState(a), { seat: a.player, bid }) === null;
}
const q = (a: Auction, correctBid = 'PASS'): TrainerQuestion => ({ id: 'competitive', type: 'bid_box', sequence: [], auction: a, prompt: 'Co dražíš?', rationale: 'Vysvětlení.', correctBid });

test('all four dealers rotate clockwise, including opening passes', () => {
  for (const dealer of seats) for (let n = 0; n < 4; n++) {
    const a = auction(Array(n).fill('PASS'), dealer);
    assert.equal(auctionState(a).next, a.player);
    assert.deepEqual(auctionState(a).errors, []);
  }
});

test('doubles require an opponents undoubled contract; intervening passes preserve rights', () => {
  for (const dealer of seats) {
    assert.equal(legal([], 'X', dealer), false);
    assert.equal(legal(['PASS'], 'X', dealer), false);
    assert.equal(legal(['1C'], 'X', dealer), true);
    assert.equal(legal(['1C', 'PASS'], 'X', dealer), false);
    assert.equal(legal(['1C', 'PASS', 'PASS'], 'X', dealer), true);
    assert.equal(legal(['1C', 'X', 'PASS'], 'X', dealer), false);
    assert.equal(legal(['1C', 'X', 'XX'], 'X', dealer), false);
    assert.equal(legal(['1C', '1D'], 'X', dealer), true);
  }
});

test('redoubles belong to the declaring side, including bidder after two passes', () => {
  assert.equal(legal([], 'XX'), false);
  assert.equal(legal(['1C'], 'XX'), false);
  assert.equal(legal(['1C', 'X'], 'XX'), true);
  assert.equal(legal(['1C', 'X', 'PASS'], 'XX'), false);
  assert.equal(legal(['1C', 'X', 'PASS', 'PASS'], 'XX'), true);
  assert.equal(legal(['1C', 'X', 'XX', 'PASS'], 'XX'), false);
});

test('higher bids reset doubles and pass counts, including the 7NT ceiling', () => {
  const a = auction(['1C', 'X', 'XX', '1D']);
  assert.equal(auctionState(a).contract?.doubling, 'none');
  assert.equal(legal(['1C', 'X', 'XX', '1D'], 'X'), true);
  assert.equal(legal(['1C', 'X', '2C'], 'XX'), false);
  assert.equal(legal(['1C', 'PASS', 'PASS'], '1D'), true);
  assert.equal(auctionState(auction(['1C', 'PASS', 'PASS', '1D', 'PASS'])).passes, 1);
  for (const bid of ['7C', '7D', '7H', '7S', '7NT', '8C', 'junk', '']) assert.equal(legal(['7NT'], bid), false);
  assert.equal(legal(['7NT'], 'X'), true);
  assert.equal(legal(['7NT', 'X'], 'XX'), true);
  assert.equal(legal(['1♣'], '1♦'), true);
  assert.equal(legal(['1S'], '1H'), false);
});

test('four opening passes and three passes after any non-pass end the auction', () => {
  const ended = [Array(4).fill('PASS'), ['1C', 'PASS', 'PASS', 'PASS'], ['1C', 'X', 'PASS', 'PASS', 'PASS'], ['1C', 'X', 'XX', 'PASS', 'PASS', 'PASS']];
  for (const bids of ended) {
    const a = auction(bids), state = auctionState(a);
    assert.equal(state.ended, true);
    assert.equal(state.next, null);
    for (const bid of ['PASS', 'X', 'XX', '7NT']) assert.equal(legal(bids, bid), false);
    assert.ok(auctionState(auction([...bids, 'PASS'])).errors.length);
    assert.ok(validateQuestion(q(a)).length);
    assert.deepEqual(validateQuestion({ ...q(a), type: 'choice', options: [{ id: 'a', text: 'Ano', correct: true }, { id: 'b', text: 'Ne', correct: false }] }), []);
  }
  assert.equal(auctionState(auction(ended[0])).passedOut, true);
  assert.equal(auctionState(auction(ended[1])).passedOut, false);
  assert.equal(auctionState(auction(['PASS', 'PASS', 'PASS'])).ended, false);
});

test('declarer is first denomination bidder on winning side, not the final bidder', () => {
  const state = auctionState(auction(['1H', '1S', '2H', '2S', '4H', 'X', 'XX', 'PASS', 'PASS', 'PASS']));
  assert.deepEqual(state.errors, []);
  assert.deepEqual(state.contract, { bid: '4H', bidder: 'N', declarer: 'N', doubling: 'XX' });
  assert.equal(auctionState(auction(['1H', '1S', '4H'])).contract?.declarer, 'N');
  assert.equal(auctionState(auction(['1H', '1S', '2H', '4S'])).contract?.declarer, 'E');
});

test('wrong seat, wrong answer player, malformed call and conflicting formats fail closed', () => {
  const a = auction(['1C']);
  a.calls[0].seat = 'S';
  assert.ok(auctionState(a).errors.some(x => x.includes('Na řadě')));
  assert.ok(questionCallError(q(a), 'PASS'));
  assert.ok(validateQuestion(q({ ...auction(['1C']), player: 'S' })).length);
  assert.ok(validateQuestion(q(auction(['1C', 'X', 'X']))).length);
  assert.ok(validateQuestion(q(auction(['1C', 'nonsense']))).length);
  assert.ok(validateQuestion({ ...q(auction([])), sequence: ['1C'] }).length);
  assert.deepEqual(validateQuestion(q(auction(['1C']), 'X')), []);
  assert.ok(validateQuestion(q(auction(['1C', 'PASS']), 'X')).length);
});

test('all 172 legacy questions retain IDs, answers, cards and system agreements', () => {
  const raw = JSON.parse(readFileSync(new URL('../content/trainer.json', import.meta.url), 'utf8'));
  const before = JSON.stringify(raw);
  const content = loadPublishedContent(raw);
  const questions = content.systems.flatMap(s => s.levels.flatMap(l => l.questions));
  assert.equal(questions.length, 172);
  for (const question of questions) {
    const a = questionAuction(question);
    assert.equal(a.calls.length, question.sequence.length * 2);
    assert.deepEqual(a.calls.filter((_, i) => i % 2).map(c => c.bid), Array(question.sequence.length).fill('PASS'));
    assert.deepEqual(validateQuestion(question), [], question.id);
    if (question.type === 'bid_box') assert.equal(questionCallError(question, question.correctBid!), null, question.id);
  }
  const migrated = structuredClone(content);
  for (const system of migrated.systems) for (const level of system.levels) for (const question of level.questions) {
    question.auction = questionAuction(question);
    question.sequence = [];
  }
  assert.doesNotThrow(() => loadPublishedContent(JSON.parse(JSON.stringify(migrated))));
  assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(content.systems, raw.systems);
});

test('full auctions survive import/export and separate test publication; illegal auctions block publishing', () => {
  const content = contentSchema.parse(JSON.parse(readFileSync(new URL('../content/trainer.json', import.meta.url), 'utf8')));
  const level = content.systems[0].levels[0];
  level.questions[0] = q(auction(['1C']), 'X');
  level.test = { source: 'separate', questions: [{ ...q(auction(['1C', 'X']), 'XX'), id: 'test-auction' }] };
  const roundTrip = loadPublishedContent(JSON.parse(JSON.stringify(content)));
  assert.deepEqual(roundTrip.systems[0].levels[0], level);
  level.test.questions![0].correctBid = 'X';
  assert.ok(publicationIssues(content).some(i => i.bank === 'test' && i.questionId === 'test-auction'));
  assert.throws(() => loadPublishedContent(content));
  for (const field of ['dealer', 'player', 'vulnerability']) {
    const broken = structuredClone(content);
    Object.assign(broken.systems[0].levels[0].questions[0].auction!, { [field]: 'invalid' });
    assert.equal(contentSchema.safeParse(broken).success, false);
  }
});
