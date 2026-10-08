import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdirSync } from 'node:fs';
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
async function finish(page, questions, returnToOverview = true) {
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
  if (returnToOverview) await page.getByRole('button', { name: 'Zpět ke kapitolám', exact: true }).click();
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
  const mobileContext = await browser.newContext({ viewport: { width: 320, height: 740 }, colorScheme: 'dark' });
  const mobile = await mobileContext.newPage(); mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(base);
  await mobile.getByRole('button', { name: 'Správa obsahu', exact: true }).waitFor();
  assert.equal(await mobile.locator('html').getAttribute('data-theme'), 'dark');
  assert.ok(await mobile.locator('.level-card:not(.is-locked)').first().evaluate(card => {
    const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
    const luminance = value => { const [r, g, b] = rgb(value); return .2126 * r + .7152 * g + .0722 * b; };
    const foreground = luminance(getComputedStyle(card.querySelector('h2')).color), background = luminance(getComputedStyle(card).backgroundColor);
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) >= 4.5;
  }), 'Dark chapter title has readable contrast');
  await mobile.locator('.theme-control summary').click();
  await mobile.locator('#theme-preference').selectOption('light');
  assert.equal(await mobile.locator('html').getAttribute('data-theme'), 'light');
  await mobile.reload();
  assert.equal(await mobile.locator('html').getAttribute('data-theme'), 'light');
  await mobile.locator('.theme-control summary').click();
  await mobile.locator('#theme-preference').selectOption('system');
  await mobile.emulateMedia({ colorScheme: 'light' }); await poll(() => mobile.locator('html').getAttribute('data-theme'), 'light');
  await mobile.emulateMedia({ colorScheme: 'dark' }); await poll(() => mobile.locator('html').getAttribute('data-theme'), 'dark');
  await mobile.locator('.theme-control summary').press('Escape');
  await mobile.getByRole('button', { name: 'Správa obsahu', exact: true }).click();
  await mobile.getByRole('button', { name: 'Načíst koncept', exact: true }).click();
  await mobile.getByLabel('Otázka', { exact: true }).fill('Mobilní úprava bez ztráty konceptu');
  assert.equal(await mobile.locator('.admin-sidebar').isVisible(), false);
  assert.equal(await mobile.locator('.admin-preview').isVisible(), false);
  assert.equal(await mobile.locator('.system-settings').evaluate(node => node.open), false);
  await mobile.getByRole('button', { name: 'Náhled', exact: true }).click();
  await mobile.locator('.admin-preview').getByRole('heading', { name: 'Mobilní úprava bez ztráty konceptu', exact: true }).waitFor();
  await mobile.getByRole('button', { name: 'Kapitoly', exact: true }).click();
  await mobile.locator('.admin-list button').nth(1).click();
  assert.equal(await mobile.locator('.admin-editor').isVisible(), true);
  await mobile.getByRole('button', { name: 'Kapitoly', exact: true }).click();
  await mobile.locator('.admin-list button').first().click();
  assert.equal(await mobile.getByLabel('Otázka', { exact: true }).inputValue(), 'Mobilní úprava bez ztráty konceptu');
  await mobile.getByRole('button', { name: 'Uložit v prohlížeči', exact: true }).click();
  for (const width of [320, 360, 390]) {
    await mobile.setViewportSize({ width, height: 740 });
    for (const pane of ['Kapitoly', 'Úpravy', 'Náhled']) {
      await mobile.getByRole('button', { name: pane, exact: true }).click();
      assert.equal(await mobile.locator('.admin-dialog').evaluate(node => node.scrollWidth <= node.clientWidth), true, `${pane} fits ${width}px`);
      assert.equal(await mobile.locator('.admin-grid').evaluate(node => node.scrollWidth <= node.clientWidth), true, `${pane} content fits ${width}px`);
      const footer = await mobile.locator('.admin-footer').boundingBox();
      assert.ok(footer.y + footer.height <= 741 && footer.y > 400, 'Save actions stay on screen with room to edit');
    }
  }
  if (process.env.HABRA_SCREENSHOT_DIR) {
    await mobile.screenshot({ path: process.env.HABRA_SCREENSHOT_DIR + '/editor-dark-mobile.png' });

  }
  await mobileContext.close();
  console.log('PASS persistent theme preference, live system theme and mobile editor navigation, draft preservation and visible save actions at 320–390px');
  const studentContext = await browser.newContext();
  const student = await studentContext.newPage();
  student.on('pageerror', error => errors.push(error.message));
  await student.goto(base);
  const progressBar = student.getByRole('progressbar', { name: 'Splněné kapitoly', exact: true });
  assert.equal(await progressBar.getAttribute('value'), '0');
  assert.equal(await progressBar.getAttribute('max'), String(content.systems[0].levels.length));
  await student.getByRole('button', { name: 'Odemčené', exact: true }).click();
  assert.equal(await student.locator('.level-card').count(), 1);
  await student.getByRole('button', { name: 'S chybami', exact: true }).click();
  await student.getByRole('heading', { name: 'Žádné chyby k procvičení' }).waitFor();
  await student.getByRole('button', { name: 'Všechny', exact: true }).click();
  await student.getByRole('button', { name: 'Začít první lekci', exact: true }).click();
  const originalPrompt = await student.locator('.question-heading').innerText();
  await student.getByRole('button', { name: 'PASS', exact: true }).click();
  assert.equal(await student.getByRole('progressbar', { name: 'Vyřešené úlohy v pokusu' }).getAttribute('aria-valuenow'), '1');
  await student.getByRole('button', { name: '← Pozastavit', exact: true }).click();
  await student.getByRole('button', { name: 'Pokračovat v pokusu', exact: true }).click();
  assert.equal(await student.locator('.question-heading').innerText(), originalPrompt);
  await student.locator('.feedback').waitFor();
  assert.equal(await student.evaluate(key => JSON.parse(localStorage.getItem(key)).systems['lepsi-levna'].answered, progressKey), 1);
  await student.getByRole('button', { name: 'Další úloha', exact: true }).click();
  await student.getByRole('button', { name: '← Pozastavit', exact: true }).click();
  student.once('dialog', dialog => dialog.dismiss());
  await student.locator('#training-system').selectOption('epstein-precision');
  assert.equal(await student.locator('#training-system').inputValue(), 'lepsi-levna');
  await student.getByRole('button', { name: 'Pokračovat v pokusu', exact: true }).click();
  for (const question of content.systems[0].levels[0].questions.slice(1)) {
    if (question.type === 'bid_box') await student.getByRole('button', { name: bidName(question.correctBid), exact: true }).click();
    else await student.locator('.choices .choice').nth(question.options.findIndex(o => o.correct)).click();
    await student.getByRole('button', { name: /Další úloha|Zobrazit výsledek/ }).click();
  }
  await student.getByRole('button', { name: 'Spustit test', exact: true }).click();
  await finish(student, content.systems[0].levels[0].questions, false);
  await student.getByRole('button', { name: 'Další kapitola', exact: true }).click();
  assert.equal(await student.locator('.question-heading').innerText(), content.systems[0].levels[1].questions[0].prompt);
  await student.getByRole('button', { name: '← Pozastavit', exact: true }).click();
  assert.equal(await progressBar.getAttribute('value'), '1');
  await student.getByRole('button', { name: 'Nedokončené', exact: true }).click();
  assert.equal(await student.locator('.level-card').count(), content.systems[0].levels.length - 1);
  await student.getByRole('button', { name: 'Všechny', exact: true }).click();
  if (process.env.HABRA_SCREENSHOT_DIR) {
    mkdirSync(process.env.HABRA_SCREENSHOT_DIR, { recursive: true });
    await student.evaluate(() => window.scrollTo(0, 0));
    await student.screenshot({ path: process.env.HABRA_SCREENSHOT_DIR + '/student-desktop.png', fullPage: true });
  }
  await student.setViewportSize({ width: 360, height: 800 });
  assert.equal(await progressBar.isVisible(), true);
  assert.equal(await student.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.HABRA_SCREENSHOT_DIR) {
    await student.evaluate(() => window.scrollTo(0, 0));
    await student.screenshot({ path: process.env.HABRA_SCREENSHOT_DIR + '/student-mobile.png', fullPage: true });
  }
  await studentContext.close();
  console.log('PASS accurate progress, filters, pause/resume without duplicate answers, cancelled system change, summary actions and mobile dashboard');
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
  b.once('dialog', dialog => dialog.accept());
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

  const creation = await browser.newPage();
  await creation.goto(base);
  await creation.getByRole('button', { name: 'Správa obsahu', exact: true }).click();
  await creation.getByRole('button', { name: 'Načíst koncept', exact: true }).click();
  await creation.getByRole('button', { name: 'Nový systém', exact: true }).click();
  await creation.getByLabel('Název systému', { exact: true }).fill('Nový výukový systém');
  await creation.getByLabel('Pravidla systému', { exact: false }).fill('1♣ = 16+ FB\nNová barva = F');
  await creation.getByRole('button', { name: 'Přidat kapitolu', exact: true }).click();
  await creation.getByLabel('Název', { exact: true }).fill('První kapitola');
  await creation.locator('.admin-editor .chapter-status [role="checkbox"]').first().click();
  await creation.getByRole('button', { name: 'Přidat úlohu', exact: true }).click();
  await creation.locator('.question-editor [role="checkbox"]').click();
  await creation.getByLabel('Otázka', { exact: true }).fill('Tréninková otázka');
  await creation.getByLabel('Vysvětlení', { exact: true }).fill('Vysvětlení tréninku.');
  await creation.getByLabel('Otázky pro test', { exact: true }).selectOption('separate');
  await creation.getByRole('button', { name: 'Testové otázky', exact: true }).click();
  await creation.getByRole('button', { name: 'Přidat úlohu', exact: true }).click();
  await creation.locator('.question-editor [role="checkbox"]').click();
  await creation.getByLabel('Otázka', { exact: true }).fill('Samostatná testová otázka');
  await creation.getByLabel('Vysvětlení', { exact: true }).fill('Vysvětlení testu.');
  await creation.getByLabel('Počet otázek v testu', { exact: false }).fill('1');
  await creation.getByLabel('Stav systému', { exact: true }).selectOption('active');
  await creation.getByRole('button', { name: 'Uložit v prohlížeči', exact: true }).click();
  const createdStore = await creation.evaluate(key => JSON.parse(localStorage.getItem(key)), editorKey);
  const createdSystem = createdStore.systems.at(-1);
  assert.equal(createdSystem.name, 'Nový výukový systém');
  assert.deepEqual(createdSystem.rules, ['1♣ = 16+ FB', 'Nová barva = F']);
  assert.equal(createdSystem.levels[0].questions[0].prompt, 'Tréninková otázka');
  assert.equal(createdSystem.levels[0].test.questions[0].prompt, 'Samostatná testová otázka');
  assert.equal(await creation.getByRole('button', { name: 'Exportovat pro web', exact: true }).isEnabled(), true);
  await creation.close();
  console.log('PASS creating a system from scratch, editing rules and independent test questions through the editor');

  const configured = structuredClone(content);
  const configuredLevel = configured.systems[0].levels[0];
  configuredLevel.test = { source: 'separate', questionCount: 2, shuffle: false, requireLesson: false, questions: configuredLevel.questions.slice(0, 3).map((question, i) => ({ ...question, id: 'separate-' + question.id, prompt: 'Testová otázka ' + (i + 1) })) };
  const custom = await browser.newPage();
  await custom.route('**/content/trainer.json', route => route.fulfill({ json: configured }));
  await custom.goto(base);
  await custom.locator('.level-card').first().getByRole('button', { name: 'Test', exact: true }).click();
  assert.equal(await custom.getByRole('progressbar', { name: 'Vyřešené úlohy v pokusu' }).getAttribute('aria-valuemax'), '2');
  await finish(custom, configuredLevel.test.questions.slice(0, 2), false);
  // Successful standalone test unlocks the next chapter without marking the lesson complete.
  const state = await custom.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key)).systems['lepsi-levna'].levels[id], { key: progressKey, id: configuredLevel.id });
  assert.equal(state.testPassed, true); assert.equal(state.lessonCompleted, false);
  await custom.close();
  console.log('PASS separate test bank, configured question count/order and optional lesson prerequisite');

  const randomContent = structuredClone(content);
  randomContent.systems[0].levels = [0, 1].map(chapter => ({ id: 'random-level-' + chapter, title: 'Téma ' + chapter, description: 'Náhodný trénink', passingPercent: 80,
    questions: [0, 1].map(index => ({ id: 'shared-question-' + index, type: 'choice', sequence: [], prompt: `Téma ${chapter}, příklad ${index}`, rationale: 'Vysvětlení náhodného příkladu.', options: [{ id: 'yes', text: 'Správně', correct: true }, { id: 'no', text: 'Nesprávně', correct: false }] })),
    test: { source: 'separate', questions: [{ id: 'test-only-' + chapter, type: 'bid_box', sequence: [], prompt: 'Jen pro test', correctBid: 'PASS', rationale: 'Testová otázka.' }] }
  }));
  const randomContext = await browser.newContext();
  const randomPage = await randomContext.newPage();
  randomPage.on('pageerror', error => errors.push(error.message));
  await randomPage.route('**/content/trainer.json', route => route.fulfill({ json: randomContent }));
  await randomPage.goto(base);
  await randomPage.getByLabel('Kapitoly pro náhodné příklady', { exact: true }).selectOption('unlocked');
  await randomPage.getByLabel('Počet náhodných příkladů', { exact: true }).selectOption('5');
  await randomPage.getByRole('button', { name: 'Spustit náhodné příklady', exact: true }).click();
  assert.equal(await randomPage.getByRole('progressbar', { name: 'Vyřešené úlohy v pokusu' }).getAttribute('aria-valuemax'), '2');
  await finish(randomPage, randomContent.systems[0].levels[0].questions);
  await randomPage.getByLabel('Kapitoly pro náhodné příklady', { exact: true }).selectOption('all');
  await randomPage.getByLabel('Počet náhodných příkladů', { exact: true }).selectOption('all');
  await randomPage.getByRole('button', { name: 'Spustit náhodné příklady', exact: true }).click();
  assert.equal(await randomPage.getByRole('progressbar', { name: 'Vyřešené úlohy v pokusu' }).getAttribute('aria-valuemax'), '4');
  const seen = [], pool = randomContent.systems[0].levels.flatMap(level => level.questions.map(question => ({ level, question })));
  const wrongPrompt = await randomPage.locator('.question-heading').innerText();
  for (let i = 0; i < 4; i++) {
    const prompt = await randomPage.locator('.question-heading').innerText();
    assert.ok(pool.some(example => example.question.prompt === prompt)); seen.push(prompt);
    await randomPage.locator('.choices .choice').nth(i === 0 ? 1 : 0).click();
    if (i === 0) {
      await randomPage.getByRole('button', { name: '← Pozastavit', exact: true }).click();
      await randomPage.getByRole('button', { name: 'Pokračovat v pokusu', exact: true }).click();
      assert.equal(await randomPage.locator('.question-heading').innerText(), prompt);
      await randomPage.locator('.feedback').waitFor();
    }
    await randomPage.getByRole('button', { name: /Další úloha|Zobrazit výsledek/ }).click();
  }
  assert.equal(new Set(seen).size, 4);
  assert.equal(await randomPage.locator('.summary-card h1').innerText(), '75 %');
  const randomProgress = await randomPage.evaluate(key => JSON.parse(localStorage.getItem(key)).systems['lepsi-levna'], progressKey);
  assert.equal(randomProgress.answered, 6); assert.equal(randomProgress.correct, 5);
  assert.deepEqual(randomProgress.levels, {});
  const wrong = pool.find(example => example.question.prompt === wrongPrompt);
  assert.deepEqual(randomProgress.mistakes[wrong.level.id], [wrong.question.id]);
  await randomPage.getByRole('button', { name: 'Nová náhodná sada', exact: true }).click();
  await randomPage.getByRole('button', { name: '← Pozastavit', exact: true }).click();
  assert.equal(await randomPage.locator('.locked-label').count(), 1);
  await randomPage.setViewportSize({ width: 360, height: 800 });
  assert.equal(await randomPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  randomPage.once('dialog', dialog => dialog.accept());
  await randomPage.getByRole('button', { name: 'Spustit chytré opakování', exact: true }).click();
  assert.equal(await randomPage.locator('.question-heading').innerText(), wrongPrompt);
  for (let i = 0; i < 4; i++) {
    await randomPage.locator('.choices .choice').first().click();
    await randomPage.getByRole('button', { name: /Další úloha|Zobrazit výsledek/ }).click();
  }
  await randomPage.getByText('Chytré opakování dokončeno', { exact: true }).waitFor();
  const afterReview = await randomPage.evaluate(key => JSON.parse(localStorage.getItem(key)).systems['lepsi-levna'], progressKey);
  assert.deepEqual(afterReview.levels, {});
  assert.deepEqual(afterReview.mistakes[wrong.level.id], []);
  assert.ok(afterReview.questionStats[wrong.level.id][wrong.question.id].dueAt > Date.now());
  await randomContext.close();
  console.log('PASS random system examples, scopes/count limits, no repeats, separate test exclusion, pause/resume, chapter-specific mistakes and unchanged chapter locks');

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
  assert.equal(await lessons.getByRole('progressbar', { name: 'Splněné kapitoly', exact: true }).getAttribute('value'), String(content.systems.at(-1).levels.length));
  await lessons.getByRole('heading', { name: 'Všechny testy máš splněné' }).waitFor();
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
