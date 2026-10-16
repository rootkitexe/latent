// Clicks the "more" toggle in a chapter at a short viewport and screenshots before/after.
//   node scripts/dev/more.mjs <chapter> <scrollFraction> <W>x<H> <outdir> [--mobile]
import { chromium } from 'playwright';
const [id, f, size, out] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const mobile = process.argv.includes('--mobile');
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--headless=new'] });
const p = await b.newPage({ viewport: { width: W, height: H }, isMobile: mobile, hasTouch: mobile });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto(`${process.env.QA_URL || "http://localhost:3000/"}?nopre=1&snap=1`, { waitUntil: 'load' });
await p.waitForSelector(`section#${id}`, { timeout: 120000 });
await p.waitForTimeout(2500);
const y = await p.evaluate(([id, f, H]) => { const s = document.getElementById(id); return s.offsetTop + (s.offsetHeight - H) * f; }, [id, Number(f), H]);
await p.evaluate((y) => { window.__lenis?.scrollTo(y, { immediate: true, force: true }); window.scrollTo(0, y); }, y);
await p.waitForTimeout(2500);
const on = await p.evaluate(() => document.querySelector('.fit-more')?.dataset.on);
console.log('toggle visible:', on === '1');
await p.screenshot({ path: `${out}/${id}-before.png` });
if (on === '1') {
  await p.click('.fit-more[data-on="1"]', mobile ? { force: true } : {});
  await p.waitForTimeout(800);
  console.log('panel open:', await p.evaluate(() => !!document.querySelector('.fit-panel')));
  await p.screenshot({ path: `${out}/${id}-open.png` });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  console.log('closed by Esc:', await p.evaluate(() => !document.querySelector('.fit-panel')));
}
console.log('errors:', errs.length, errs.slice(0, 3));
await b.close();
