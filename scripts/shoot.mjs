// Screenshot harness. Usage:
//   node scripts/shoot.mjs --url http://localhost:3000/ --out shots --scroll 0,0.25,0.5,0.75,1 --w 1440 --h 900 [--mobile] [--chrome] [--wait 1800] [--name home]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    opt[k] = v;
  }
}
const url = opt.url || 'http://localhost:3000/';
const out = opt.out || 'shots';
const scrolls = String(opt.scroll ?? '0').split(',').map(Number);
const mobile = !!opt.mobile;
const W = mobile ? 390 : Number(opt.w || 1440);
const H = mobile ? 844 : Number(opt.h || 900);
const wait = Number(opt.wait || 1800);
const name = opt.name || new URL(url).pathname.replace(/\W+/g, '_').replace(/^_|_$/g, '') || 'home';

fs.mkdirSync(out, { recursive: true });

const launch = opt.chrome
  ? { channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--headless=new'] }
  : { headless: true, args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'] };

const browser = await chromium.launch(launch);
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  isMobile: mobile,
  hasTouch: mobile,
  userAgent: mobile
    ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    : undefined,
});
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') logs.push({ type: t, text: m.text().slice(0, 600) });
});
page.on('pageerror', (e) => logs.push({ type: 'pageerror', text: String(e).slice(0, 600) }));
page.on('response', (r) => r.status() >= 400 && logs.push({ type: 'http', text: `${r.status()} ${r.url()}` }));

const u = new URL(url);
u.searchParams.set('gpu', '2');
u.searchParams.set('nopre', '1');
u.searchParams.set('snap', '1');
await page.goto(u.toString(), { waitUntil: 'networkidle', timeout: 90000 }).catch((e) => logs.push({ type: 'goto', text: String(e) }));
// wait for the (code-split) chapter sections to mount before measuring the page
await page.waitForSelector('section[data-chapter]', { timeout: 90000 }).catch(() => logs.push({ type: 'wait', text: 'no chapter section mounted' }));
await page.waitForTimeout(wait);

// --hover "0.5,0.85" moves the pointer (viewport fractions) in a short sweep after each scroll,
// so hover states, cursor labels and pointer-driven shaders are captured.
const hover = opt.hover ? String(opt.hover).split(',').map(Number) : null;

const total = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
for (const f of scrolls) {
  const y = Math.round(total * f);
  await page.evaluate((yy) => {
    if (window.__lenis) window.__lenis.scrollTo(yy, { immediate: true, force: true });
    window.scrollTo(0, yy);
  }, y);
  await page.waitForTimeout(wait);
  if (hover) {
    const hx = hover[0] * W;
    const hy = hover[1] * H;
    await page.mouse.move(hx - 160, hy + 30, { steps: 8 });
    await page.waitForTimeout(120);
    await page.mouse.move(hx + 40, hy - 10, { steps: 14 });
    await page.waitForTimeout(120);
    await page.mouse.move(hx, hy, { steps: 6 });
    await page.waitForTimeout(Number(opt.hoverwait || 450));
  }
  const file = path.join(out, `${name}${mobile ? '-m' : ''}-${String(Math.round(f * 100)).padStart(3, '0')}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log('shot', file, 'y=', y);
}
fs.writeFileSync(path.join(out, `${name}${mobile ? '-m' : ''}-console.json`), JSON.stringify(logs, null, 2));
console.log(`console entries: ${logs.length}`);
for (const l of logs.slice(0, 20)) console.log(' -', l.type, l.text.slice(0, 200));
await browser.close();
