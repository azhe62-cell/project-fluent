/**
 * REAL-BROWSER verification of the exam screen (layout, scrolling, divider, answers, navigation, dialog, timer).
 *
 *   1. Start the app:            npm run dev            (default http://localhost:5173)
 *   2. Point at a Chromium-based browser you already have (nothing is downloaded):
 *        PowerShell:  $env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
 *                     (or Edge: "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
 *   3. Run:                      npm run check:browser
 *
 * Output: a PASS/FAIL line per check per viewport + screenshots in ./browser-check-output/. Exit code 1 on any failure.
 * It runs against local demo mode (no backend needed). Env: BASE (url), CHROME_PATH, CHROME_ARGS ("--no-sandbox ..."), OUT_DIR.
 */
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const VIEWPORTS = [
  { name: 'desktop-1440x900', width: 1440, height: 900, desktop: true },
  { name: 'laptop-1280x720', width: 1280, height: 720, desktop: true },
  { name: 'small-laptop-1024x768', width: 1024, height: 768, desktop: true },
  { name: 'tablet-768x1024', width: 768, height: 1024, desktop: false },
  { name: 'phone-390x844', width: 390, height: 844, desktop: false },
  { name: 'small-phone-360x640', width: 360, height: 640, desktop: false },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startExam(page, base, email) {
  await page.goto(`${base}/auth/register?next=${encodeURIComponent('/tests/reading-mini-mock-01')}`, { waitUntil: 'networkidle0' });
  await page.type('input[autocomplete="nickname"]', 'Browser Check');
  await page.type('input[type="email"]', email);
  await page.click('input[type="checkbox"]');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => document.body.textContent.includes('Readiness check'), { timeout: 10000 });
  for (const b of await page.$$('input[type="checkbox"]')) await b.click();
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Start the test/.test(b.textContent))?.click());
  await page.waitForSelector('[role="timer"]', { timeout: 10000 });
  await sleep(500);
}

export async function runChecks({ puppeteer, launchOptions, base = 'http://localhost:5173', outDir = 'browser-check-output', viewports = VIEWPORTS }) {
  mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const vp of viewports) {
    const browser = await puppeteer.launch(launchOptions);          // fresh browser = fresh localStorage per viewport
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: vp.width < 600 ? 2 : 1 });
    const check = async (name, fn) => {
      try { const detail = await fn(); results.push({ vp: vp.name, name, pass: true, detail: detail ?? '' }); }
      catch (e) { results.push({ vp: vp.name, name, pass: false, detail: String(e.message ?? e).slice(0, 200) }); }
    };
    const must = (cond, msg) => { if (!cond) throw new Error(msg); };
    const shot = (n) => page.screenshot({ path: `${outDir}/${vp.name}-${n}.png` });
    const qBtn = (n) => page.evaluateHandle((n) => [...document.querySelectorAll('nav[aria-label="Question navigator"] button')].find((b) => b.getAttribute('aria-label')?.startsWith(`Question ${n}:`)), n);
    const paletteLabel = (n) => page.evaluate((n) => [...document.querySelectorAll('nav[aria-label="Question navigator"] button')].find((b) => b.getAttribute('aria-label')?.startsWith(`Question ${n}:`))?.getAttribute('aria-label'), n);
    const inView = (id) => page.evaluate((id) => { const p = document.querySelector('[data-pane="questions"]').getBoundingClientRect(); const e = document.getElementById('q-' + id); if (!e) return false; const r = e.getBoundingClientRect(); return r.top >= p.top - 4 && r.top < p.top + p.height * 0.6; }, id);
    const goToQ6 = async () => { await page.evaluate(() => { document.querySelector('[role="tab"][aria-selected]'); [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === 'Questions')?.click(); }); await (await qBtn(6)).click(); await sleep(250); };

    await startExam(page, base, `check-${vp.name}@example.com`);

    await check('page itself does not scroll vertically', async () => { const m = await page.evaluate(() => ({ h: document.scrollingElement.scrollHeight, v: innerHeight })); must(m.h <= m.v + 1, `document ${m.h}px > viewport ${m.v}px`); return `${m.h}/${m.v}`; });
    await check('no horizontal overflow', async () => { const m = await page.evaluate(() => ({ w: document.scrollingElement.scrollWidth, v: innerWidth })); must(m.w <= m.v + 1, `scrollWidth ${m.w} > ${m.v}`); });
    await check('toolbar pinned at top; timer + Submit fully visible', async () => {
      const r = await page.evaluate(() => { const rc = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right }; }; return { header: rc('header'), timer: rc('[role="timer"]'), submit: [...document.querySelectorAll('header button')].filter((b) => /Submit/.test(b.textContent)).map((b) => { const x = b.getBoundingClientRect(); return { l: x.left, r: x.right, t: x.top, b: x.bottom }; })[0], vw: innerWidth }; });
      must(r.header && Math.abs(r.header.t) < 1, 'toolbar not at top'); must(r.timer && r.timer.l >= 0 && r.timer.r <= r.vw, 'timer clipped'); must(r.submit && r.submit.l >= 0 && r.submit.r <= r.vw, 'Submit clipped');
    });
    await check('workspace starts below the toolbar and fills most of the screen', async () => {
      const r = await page.evaluate(() => { const hb = document.querySelector('header').getBoundingClientRect().bottom; const p = [...document.querySelectorAll('[data-pane]')].filter((e) => e.getBoundingClientRect().height > 0); const f = document.querySelector('footer').getBoundingClientRect(); return { hb, tops: p.map((e) => e.getBoundingClientRect().top), ph: Math.max(...p.map((e) => e.getBoundingClientRect().height)), vh: innerHeight, ft: f.top, fb: f.bottom }; });
      must(r.tops.every((t) => t >= r.hb - 1), 'content overlaps toolbar'); must(r.fb <= r.vh + 1, 'footer clipped'); const frac = r.ph / r.vh; must(frac >= (vp.height < 700 ? 0.5 : 0.62), `content only ${(frac * 100).toFixed(0)}% of viewport`); return `${(frac * 100).toFixed(0)}% of viewport is content`;
    });
    await check('question palette is a single compact row', async () => { const h = await page.evaluate(() => document.querySelector('nav[aria-label="Question navigator"]').getBoundingClientRect().height); must(h <= 64, `palette ${h}px tall`); return `${Math.round(h)}px`; });
    await check('exactly one timer, counting down', async () => {
      const n = await page.evaluate(() => document.querySelectorAll('[role="timer"]').length); must(n === 1, `${n} timers`);
      const t1 = await page.$eval('[role="timer"]', (e) => e.textContent); await sleep(2200); const t2 = await page.$eval('[role="timer"]', (e) => e.textContent);
      const sec = (s) => { const m = s.match(/(\d+):(\d+)/); return Number(m[1]) * 60 + Number(m[2]); }; must(sec(t1) - sec(t2) >= 1 && sec(t1) - sec(t2) <= 4, `timer ${t1} → ${t2}`); return `${t1} → ${t2}`;
    });
    await shot('1-exam');

    if (!vp.desktop) {
      await check('phone/tablet: Passage ⇄ Questions tabs switch panes and keep scroll position', async () => {
        const vis = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-pane]')].map((e) => [e.dataset.pane, e.getBoundingClientRect().height > 0])));
        let v = await vis(); must(v.questions && !v.passage, `initial ${JSON.stringify(v)}`);
        await page.evaluate(() => { document.querySelector('[data-pane="questions"]').scrollTop = 500; });
        await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === 'Passage').click()); await sleep(150);
        v = await vis(); must(v.passage && !v.questions, `after Passage ${JSON.stringify(v)}`); await shot('2-passage');
        await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === 'Questions').click()); await sleep(150);
        const st = await page.evaluate(() => document.querySelector('[data-pane="questions"]').scrollTop); must(Math.abs(st - 500) < 3, `scroll lost: ${st}`);
      });
    }

    await goToQ6();
    await check('sentence-completion blank is an obvious, labelled field with the limit shown beneath', async () => {
      const r = await page.evaluate(() => { const i = document.querySelector('input[aria-label="Answer for question 6"]'); const b = i.getBoundingClientRect(); const cs = getComputedStyle(i); const card = i.closest('[data-question]'); const chip = [...card.querySelectorAll('p')].find((p) => /NO MORE THAN/.test(p.textContent)); const c = chip?.getBoundingClientRect(); return { w: b.width, h: b.height, bw: parseFloat(cs.borderTopWidth), ph: i.placeholder, bottom: b.bottom, chipTop: c?.top, chipVisible: !!c && c.width > 0, chipText: chip?.textContent, l: b.left, r: b.right, vw: innerWidth }; });
      must(r.w >= 95 && r.h >= 36, `field ${Math.round(r.w)}×${Math.round(r.h)}`); must(r.bw >= 2, 'weak border'); must(r.ph.length > 0, 'no placeholder'); must(r.l >= 0 && r.r <= r.vw, 'field off-screen'); must(r.chipVisible && r.chipTop >= r.bottom - 2, 'word limit not directly beneath'); return `${Math.round(r.w)}×${Math.round(r.h)} · "${r.chipText.trim().slice(0, 32)}"`;
    });
    await shot('3-sentence-completion');
    await check('typing marks the question answered everywhere (palette + progress)', async () => {
      await page.focus('input[aria-label="Answer for question 6"]'); await page.keyboard.type('common'); await sleep(250);
      const lab = await paletteLabel(6); must(/: answered/.test(lab), lab); const txt = await page.evaluate(() => document.querySelector('header [role="status"]').textContent); must(/^1(\/| of )19/.test(txt.replace(/\s+/g, ' ').trim()), `progress "${txt}"`);
      const b = await page.evaluate(() => document.querySelector('[data-question="rd01-q06"]').dataset.answered); must(b === 'true', 'card not marked answered');
    });
    await check('answers persist while navigating between questions, passages and panes', async () => {
      await (await qBtn(14)).click(); await sleep(250);
      const onP2 = await page.evaluate(() => !!document.getElementById('q-rd01-q14')); must(onP2, 'did not switch to passage 2');
      await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === 'Passage' || t.getAttribute('aria-label') === 'Passage')?.click()); await sleep(100);
      await goToQ6(); const v = await page.$eval('input[aria-label="Answer for question 6"]', (e) => e.value); must(v === 'common', `value "${v}"`);
    });
    await check('Previous / Next move between questions and across the passage boundary', async () => {
      await (await qBtn(9)).click(); await sleep(250);
      await page.click('button[aria-label="Next question"]'); await sleep(300);
      const cur = await page.evaluate(() => document.querySelector('nav[aria-label="Question navigator"] [aria-current="true"]')?.textContent.trim().replace(/\D/g, '')); must(cur === '10', `current ${cur}`); must(await inView('rd01-q10'), 'question 10 not scrolled into view');
      await page.click('button[aria-label="Previous question"]'); await sleep(300);
      const cur2 = await page.evaluate(() => document.querySelector('nav[aria-label="Question navigator"] [aria-current="true"]')?.textContent.trim().replace(/\D/g, '')); must(cur2 === '9', `back to ${cur2}`); must(await inView('rd01-q09'), 'question 9 not scrolled into view');
    });
    await check('flag for review shows on the palette and in the card', async () => {
      await goToQ6(); await page.evaluate(() => document.querySelector('[data-question="rd01-q06"] button[aria-pressed]').click()); await sleep(150);
      const lab = await paletteLabel(6); must(/flagged for review/.test(lab), lab);
    });

    if (vp.desktop) {
      await check('panes scroll independently (questions scroll leaves the passage still, and vice versa)', async () => {
        const r = await page.evaluate(async () => { const p = document.querySelector('[data-pane="passage"]'), q = document.querySelector('[data-pane="questions"]'); p.scrollTop = 0; q.scrollTop = 0; q.scrollTop = 700; await new Promise((r) => setTimeout(r, 50)); const a = { p: p.scrollTop, q: q.scrollTop }; p.scrollTop = 250; await new Promise((r) => setTimeout(r, 50)); return { a, b: { p: p.scrollTop, q: q.scrollTop }, canP: p.scrollHeight > p.clientHeight, canQ: q.scrollHeight > q.clientHeight }; });
        must(r.canP && r.canQ, 'a pane does not scroll'); must(r.a.q > 100 && r.a.p === 0, `questions scroll moved passage (${JSON.stringify(r.a)})`); must(r.b.p > 50 && Math.abs(r.b.q - r.a.q) < 3, `passage scroll moved questions (${JSON.stringify(r.b)})`);
      });
      const widths = () => page.evaluate(() => { const p = document.querySelector('[data-pane="passage"]').getBoundingClientRect().width, q = document.querySelector('[data-pane="questions"]').getBoundingClientRect().width; return { p, q, sep: Number(document.querySelector('[role="separator"]').getAttribute('aria-valuenow')) }; });
      await check('divider: drag resizes, minimum widths hold at both extremes, Reset restores 50%', async () => {
        const sep = await page.$eval('[role="separator"]', (e) => { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
        const w0 = await widths(); await page.mouse.move(sep.x, sep.y); await page.mouse.down(); await page.mouse.move(sep.x + 120, sep.y, { steps: 6 }); await page.mouse.up(); await sleep(100);
        const w1 = await widths(); must(w1.p - w0.p > 100 && w1.p - w0.p < 140, `drag +120 changed passage by ${Math.round(w1.p - w0.p)}`);
        const sep2 = await page.$eval('[role="separator"]', (e) => { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
        await page.mouse.move(sep2.x, sep2.y); await page.mouse.down(); await page.mouse.move(2, sep2.y, { steps: 8 }); await page.mouse.up(); await sleep(100);
        const w2 = await widths(); must(w2.p >= 338, `passage pane shrank to ${Math.round(w2.p)}px (< 340 min)`);
        const sep3 = await page.$eval('[role="separator"]', (e) => { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
        await page.mouse.move(sep3.x, sep3.y); await page.mouse.down(); await page.mouse.move(vp.width - 2, sep3.y, { steps: 8 }); await page.mouse.up(); await sleep(100);
        const w3 = await widths(); must(w3.q >= 338, `questions pane shrank to ${Math.round(w3.q)}px (< 340 min)`);
        await page.click('button[aria-label="Reset panel layout"]'); await sleep(150); const w4 = await widths(); must(Math.abs(w4.sep - 50) <= 1, `reset gave ${w4.sep}%`);
        return `+120 → ${Math.round(w1.p)}px · min ${Math.round(w2.p)}/${Math.round(w3.q)}px · reset ${w4.sep}%`;
      });
      await check('divider is keyboard operable (←/→/Home/End/Enter)', async () => {
        await page.focus('[role="separator"]'); const a = (await widths()).sep; await page.keyboard.press('ArrowRight'); const b = (await widths()).sep; must(b - a >= 1, `ArrowRight ${a}→${b}`);
        await page.keyboard.press('Home'); const c = (await widths()).sep; must(c < a - 3, `Home → ${c}`); await page.keyboard.press('End'); const d = (await widths()).sep; must(d > a + 3, `End → ${d}`); await page.keyboard.press('Enter'); const e = (await widths()).sep; must(Math.abs(e - 50) <= 1, `Enter → ${e}`);
      });
      await check('a hover-only/`select` drag does not select page text', async () => { const s = await page.evaluate(() => String(getSelection())); must(s.length < 5, `selected "${s.slice(0, 30)}"`); });
    }

    await check('Submit opens a confirmation listing unanswered + flagged questions; Escape cancels; nothing is submitted', async () => {
      await page.evaluate(() => [...document.querySelectorAll('header button')].find((b) => /Submit/.test(b.textContent)).click()); await sleep(250);
      const d = await page.evaluate(() => { const dlg = document.querySelector('dialog[open]'); if (!dlg) return null; const r = dlg.getBoundingClientRect(); return { text: dlg.textContent, t: r.top, b: r.bottom, l: r.left, r: r.right, vw: innerWidth, vh: innerHeight, chips: dlg.querySelectorAll('ul[aria-label$="unanswered"] button').length, flagged: [...dlg.querySelectorAll('ul[aria-label$="flagged for review"] button')].map((b) => b.textContent) }; });
      must(d, 'dialog did not open'); must(/17 unanswered|18 unanswered/.test(d.text), 'no unanswered summary'); must(d.chips >= 17, `${d.chips} unanswered chips`); must(d.flagged.includes('6'), `flagged ${d.flagged}`); must(d.t >= 0 && d.b <= d.vh + 1 && d.l >= 0 && d.r <= d.vw + 1, 'dialog overflows the viewport');
      await shot('4-submit-dialog'); await page.keyboard.press('Escape'); await sleep(200);
      const still = await page.evaluate(() => ({ open: !!document.querySelector('dialog[open]'), exam: location.pathname.startsWith('/attempts/') })); must(!still.open && still.exam, `after Escape ${JSON.stringify(still)}`);
    });
    await check('"Review unanswered" jumps to the first unanswered question (and it is in view)', async () => {
      await page.evaluate(() => [...document.querySelectorAll('header button')].find((b) => /Submit/.test(b.textContent)).click()); await sleep(250);
      await page.evaluate(() => [...document.querySelectorAll('dialog[open] button')].find((b) => /Review unanswered/.test(b.textContent)).click());
      const t0 = Date.now(); let cur, vis, ms;
      for (;;) {   // poll up to 2 s: a human would not notice < ~400 ms, and we report the real settle time
        await sleep(50); cur = await page.evaluate(() => document.querySelector('nav[aria-label="Question navigator"] [aria-current="true"]')?.textContent.trim().replace(/\D/g, '')); vis = await inView('rd01-q01'); ms = Date.now() - t0;
        if ((cur === '1' && vis) || ms > 2000) break;
      }
      const geo = await page.evaluate(() => { const p = document.querySelector('[data-pane="questions"]'); const e = document.getElementById('q-rd01-q01'); return `scrollTop=${Math.round(p.scrollTop)} paneTop=${Math.round(p.getBoundingClientRect().top)} q1Top=${Math.round(e?.getBoundingClientRect().top ?? -1)} sectionHasQ1=${!!e} dialogOpen=${!!document.querySelector('dialog[open]')} focus=${document.activeElement?.tagName}`; });
      must(cur === '1' && vis, `after ${ms}ms: current=${cur}, question 1 in view=${vis} [${geo}]`); must(ms < 800, `jump took ${ms}ms`); return `settled in ~${ms}ms`;
    });
    await browser.close();
  }
  return results;
}

export function report(results) {
  const byVp = new Map(); for (const r of results) byVp.set(r.vp, [...(byVp.get(r.vp) ?? []), r]);
  for (const [vp, rs] of byVp) { console.log(`\n${vp}`); for (const r of rs) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`); }
  const failed = results.filter((r) => !r.pass); console.log(`\n${results.length - failed.length}/${results.length} browser checks passed${failed.length ? `, ${failed.length} FAILED` : ''}`); return failed.length === 0;
}

// CLI entry
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { default: puppeteer } = await import('puppeteer-core');
  const executablePath = process.env.CHROME_PATH;
  if (!executablePath) { console.error('Set CHROME_PATH to a Chrome/Edge executable (see the header of this file).'); process.exit(2); }
  const args = (process.env.CHROME_ARGS ?? '').split(' ').filter(Boolean);
  const ok = report(await runChecks({ puppeteer, launchOptions: { executablePath, headless: 'shell', args }, base: process.env.BASE ?? 'http://localhost:5173', outDir: process.env.OUT_DIR ?? 'browser-check-output' }));
  process.exit(ok ? 0 : 1);
}
