import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
assert.ok(executablePath, 'Install Chromium or set CHROMIUM_PATH to its executable.');
const base = 'http://127.0.0.1:5180/';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5180', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', chunk => { serverLog += chunk; });
server.stderr.on('data', chunk => { serverLog += chunk; });
let browser;
const progressKey = 'habra-progress-pages-v2:/';
const editorKey = 'habra-editor-pages-v1:/';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(read, expected) {
  for (let i = 0; i < 100; i++) { if (JSON.stringify(await read()) === JSON.stringify(expected)) return; await pause(50); }
  assert.deepEqual(await read(), expected);
}
const bidName = bid => ['PASS', 'X', 'XX'].includes(bid) ? ({ PASS: 'PASS', X: 'KONTRA', XX: 'REKONTRA' }[bid]) : bid.replace('C', '♣').replace('D', '♦').replace('H', '♥').replace('S', '♠');
async function finish(page, questions) {
  for (let i = 0; i < questions.length; i++) {
    const prompt = await page.locator('.question-heading').innerText();
    const question = questions.find(q => q.prompt === prompt);
    assert.ok(question, prompt);
    if (question.type === 'bid_box') await page.getByRole('button', { name: bidName(question.correctBid), exact: true }).click();
    else await page.locator('.choices .choice').nth(question.options.findIndex(o => o.correct)).click();
    await page.getByRole('button', { name: /Další úloha|Zobrazit výsledek/ }).click();
  }
  await page.locator('.summary-card').waitFor();
  assert.equal(await page.locator('.summary-card h1').innerText(), '100 %');
  await page.getByRole('button', { name: 'Zpět ke kapitolám', exact: true }).click();
}

try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (server.exitCode !== null) throw new Error(serverLog);
    try { if ((await fetch(base + 'content/trainer.json')).ok) { ready = true; break; } } catch {}
    await pause(100);
  }
  assert.ok(ready, 'Vite failed to start: ' + serverLog);
  const content = await (await fetch(base + 'content/trainer.json')).json();
  browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-dev-shm-usage'] });
  const errors = [];
  const context = await browser.newContext();
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const a = await context.newPage(), b = await context.newPage();
  await a.goto(base); await b.goto(base);
  const chapter = content.systems[0].levels[2];
  await a.getByLabel('Hledat kapitolu', { exact: true }).fill(chapter.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase());
  assert.equal(await a.locator('.level-card').count(), 1);
  assert.equal(await a.locator('.level-number').innerText(), '03');
  await a.locator('.locked-label').waitFor();
  await a.getByLabel('Hledat kapitolu', { exact: true }).fill('nenalezena-kapitola-xyz');
  assert.equal(await a.locator('.level-card').count(), 0);
  await a.getByRole('button', { name: 'Vymazat hledání', exact: true }).click();
  assert.equal(await a.locator('.level-card').count(), content.systems[0].levels.length);
  await a.getByLabel('Hledat kapitolu', { exact: true }).fill(chapter.title);
  await a.locator('#training-system').selectOption('epstein-precision');
  assert.equal(await a.getByLabel('Hledat kapitolu', { exact: true }).inputValue(), '');
  await a.locator('#training-system').selectOption('lepsi-levna');
  console.log('PASS chapter search ignores case/diacritics, preserves order and locks, and resets on system change');
  await a.getByRole('button', { name: 'Začít trénink', exact: true }).click();
  await b.getByRole('button', { name: 'Začít trénink', exact: true }).click();
  await Promise.all([a.getByRole('button', { name: '1♣', exact: true }).click(), b.getByRole('button', { name: 'PASS', exact: true }).click()]);
  await poll(() => a.evaluate(key => { const p = JSON.parse(localStorage.getItem(key)).systems['lepsi-levna']; return [p.answered, p.correct]; }, progressKey), [2, 1]);
  await b.getByRole('button', { name: 'Přejít na přehled lekcí', exact: true }).click();
  await b.locator('#training-system').selectOption('epstein-precision');
  await b.getByRole('heading', { name: 'Epstein Precision, krok za krokem.' }).waitFor();
  await a.getByRole('button', { name: 'Další úloha', exact: true }).click();
  await a.getByRole('button', { name: '1♥', exact: true }).click();
  await poll(() => a.evaluate(key => { const p = JSON.parse(localStorage.getItem(key)).systems['lepsi-levna']; return [p.answered, p.correct]; }, progressKey), [3, 2]);
  console.log('PASS simultaneous tab writes and independent active systems');

  await a.evaluate(key => localStorage.setItem(key, '{broken'), editorKey);
  await a.getByRole('button', { name: 'Správa obsahu', exact: true }).click();
  await a.getByRole('button', { name: 'Načíst koncept', exact: true }).click();
  await a.getByText('Uložený koncept je poškozený.', { exact: false }).waitFor();
  a.once('dialog', dialog => dialog.accept());
  await a.getByRole('button', { name: 'Načíst obsah webu', exact: true }).click();
  await a.locator('.question-editor').waitFor();
  a.once('dialog', dialog => dialog.dismiss());
  await a.getByRole('button', { name: 'Načíst obsah webu', exact: true }).click();
  assert.equal(await a.getByRole('button', { name: 'Načíst obsah webu', exact: true }).isEnabled(), true);
  assert.equal(await a.evaluate(key => localStorage.getItem(key), editorKey), '{broken');
  const promptField = a.getByLabel('Otázka', { exact: true });
  await promptField.fill('');
  await promptField.pressSequentially('Testovací otázka', { delay: 10 });
  assert.equal(await promptField.inputValue(), 'Testovací otázka');
  assert.equal(await promptField.evaluate(node => node === document.activeElement), true);
  console.log('PASS editor recovery, cancellation, preserved draft, and typing focus');

  const damagedContext = await browser.newContext();
  const damaged = await damagedContext.newPage();
  await damaged.addInitScript(key => localStorage.setItem(key, '{damaged'), progressKey);
  await damaged.goto(base);
  await damaged.locator('.storage-warning').waitFor();
  assert.equal(await damaged.evaluate(key => localStorage.getItem(key), progressKey), '{damaged');
  await damaged.getByRole('button', { name: 'Začít trénink', exact: true }).click();
  await damaged.getByRole('button', { name: '1♣', exact: true }).click();
  await poll(() => damaged.evaluate(key => localStorage.getItem(key + ':damaged'), progressKey), '{damaged');
  console.log('PASS damaged progress is backed up before replacement');

  const invalid = await browser.newPage();
  await invalid.route('**/content/trainer.json', async route => { const raw = structuredClone(content); raw.systems[0].levels[0].questions[0].correctBid = '8NT'; await route.fulfill({ json: raw }); });
  await invalid.goto(base);
  await invalid.getByRole('status').filter({ hasText: 'neplatné nebo neúplné úlohy' }).waitFor();
  assert.equal(await invalid.locator('#training-system').count(), 0);
  console.log('PASS invalid runtime content is rejected');

  const blocked = await browser.newPage();
  await blocked.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('Unavailable', 'QuotaExceededError'); }; });
  await blocked.goto(base);
  await blocked.getByRole('button', { name: 'Začít trénink', exact: true }).click();
  await blocked.getByRole('button', { name: '1♣', exact: true }).click();
  await blocked.locator('.storage-warning').waitFor();
  await blocked.getByRole('button', { name: 'Další úloha', exact: true }).click();
  await blocked.locator('.question-heading').waitFor();
  console.log('PASS usable training without persistent storage');

  const seeded = { selectedSystemId: content.systems[0].id, systems: Object.fromEntries(content.systems.map(s => [s.id, { answered: 0, correct: 0, mistakes: {}, levels: Object.fromEntries(s.levels.slice(0, -2).map(l => [l.id, { lessonCompleted: true, testPassed: true, bestScore: 100 }])) }])) };
  const lessonsContext = await browser.newContext();
  const lessons = await lessonsContext.newPage();
  lessons.on('pageerror', error => errors.push(error.message));
  await lessons.addInitScript(({ key, store }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(store)); }, { key: progressKey, store: seeded });
  await lessons.goto(base);
  for (const system of content.systems) {
    await lessons.locator('#training-system').selectOption(system.id);
    await lessons.getByRole('heading', { name: system.name + ', krok za krokem.' }).waitFor();
    for (const chapter of system.levels.slice(-2)) {
      const card = lessons.locator('.level-card').filter({ has: lessons.getByRole('heading', { name: chapter.title, exact: true }) });
      await card.getByRole('button', { name: 'Začít trénink', exact: true }).click();
      const firstBid = chapter.questions.find(q => q.type === 'bid_box' && q.sequence.length);
      if (chapter.questions[0] === firstBid) assert.equal(await lessons.getByRole('button', { name: '1♣', exact: true }).isDisabled(), true);
      await finish(lessons, chapter.questions);
      await card.getByRole('button', { name: 'Test', exact: true }).click();
      await finish(lessons, chapter.questions);
      console.log('PASS new lesson and test:', system.name, '/', chapter.title);
    }
  }
  await lessons.setViewportSize({ width: 360, height: 800 });
  assert.equal(await lessons.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await lessons.getByRole('button', { name: 'Výsledky', exact: true }).click();
  assert.equal(await lessons.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS mobile overview/statistics and no application exceptions');
} finally {
  if (browser) await browser.close();
  const exited = once(server, 'exit');
  server.kill('SIGTERM');
  await Promise.race([exited, pause(3000)]);
}
