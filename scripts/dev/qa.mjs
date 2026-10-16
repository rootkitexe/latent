// Full-page QA: walks the whole journey, measures fps in the middle of every chapter, collects console
// errors and grabs one frame per chapter.  node scripts/dev/qa.mjs [url] [outdir] [--mobile]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://localhost:3000/';
const out = process.argv[3] || '../shots-latent/qa';
const mobile = process.argv.includes('--mobile');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--headless=new'],
});
const ctx = await browser.newContext({
  viewport: mobile ? { width: 390, height: 844 } : { width: Number(process.env.QA_W || 1440), height: Number(process.env.QA_H || 900) },
  isMobile: mobile,
  hasTouch: mobile,
});
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && logs.push(`${m.type()}: ${m.text().slice(0, 300)}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
page.on('response', (r) => r.status() >= 400 && logs.push(`http ${r.status()} ${r.url()}`));

await page.goto(url + '?nopre=1', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => document.querySelectorAll('section[data-chapter]').length >= 9, null, { timeout: 120000 });
await page.waitForTimeout(3000);

const chapters = await page.evaluate(() =>
  [...document.querySelectorAll('section[data-chapter]')].map((s) => ({ id: s.id, top: s.offsetTop, h: s.offsetHeight }))
);
const results = [];
for (const c of chapters) {
  for (const f of [0.15, 0.55, 0.9]) {
    const y = Math.round(c.top + Math.max(0, c.h - (mobile ? 844 : Number(process.env.QA_H || 900))) * f);
    await page.evaluate((yy) => { window.__lenis?.scrollTo(yy, { immediate: true, force: true }); window.scrollTo(0, yy); }, y);
    await page.waitForTimeout(1800);
    const fps = await page.evaluate(() => new Promise((res) => {
      let n = 0; const t0 = performance.now();
      const tick = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(tick); else res(Math.round((n * 1000) / (performance.now() - t0))); };
      requestAnimationFrame(tick);
    }));
    const canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
    results.push({ id: c.id, f, fps, canvases });
    if (f === 0.55) await page.screenshot({ path: path.join(out, `${mobile ? 'm-' : ''}${c.id}.png`) });
  }
}
console.log(results.map((r) => `${r.id.padEnd(11)} @${r.f}  ${String(r.fps).padStart(3)} fps  canvases=${r.canvases}`).join('\n'));
console.log(`\nconsole entries: ${logs.length}`);
for (const l of [...new Set(logs)].slice(0, 30)) console.log(' -', l);
await browser.close();
