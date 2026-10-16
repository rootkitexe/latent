// Layout collision detector. For each viewport size, walks every chapter at several scroll steps and
// reports visible text/controls that overlap each other or fall outside the viewport.
//   node scripts/dev/overlap.mjs [url] [sizes e.g. 1280x720,1366x768] [--shots dir] [--only id,id]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('http')) || 'http://localhost:3000/';
const sizes = (args.find((a) => /^\d+x\d+/.test(a)) || '1280x720,1366x768,1024x768,768x1024,390x844')
  .split(',').map((s) => s.split('x').map(Number));
const shotsDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const STEPS = [0.06, 0.25, 0.45, 0.65, 0.85, 0.98];

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--headless=new'],
});

function scan() {
  const vw = innerWidth, vh = innerHeight;
  const effOpacity = (el) => {
    let o = 1;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
      o *= parseFloat(cs.opacity);
      if (o < 0.15) return o;
    }
    return o;
  };
  const items = [];
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    if (el.closest('[aria-hidden="true"]') && !el.closest('[data-chapter]')) continue;
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'canvas', 'svg', 'path', 'br'].includes(tag)) continue;
    const interactive = ['button', 'input', 'a', 'select', 'textarea'].includes(tag);
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!interactive && !ownText) continue;
    if (interactive && el.parentElement?.closest('button, a')) continue;
    // visible box: clip to every ancestor that hides overflow (e.g. the .fit-copy fade area)
    const b0 = el.getBoundingClientRect();
    let r = { left: b0.left, top: b0.top, right: b0.right, bottom: b0.bottom };
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const p = e.getBoundingClientRect();
        r = { left: Math.max(r.left, p.left), top: Math.max(r.top, p.top), right: Math.min(r.right, p.right), bottom: Math.min(r.bottom, p.bottom) };
      }
    }
    r.width = r.right - r.left; r.height = r.bottom - r.top;
    if (r.width < 6 || r.height < 6) continue;
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
    if (effOpacity(el) < 0.15) continue;
    // ignore text nested inside an interactive element we already count
    if (!interactive && el.closest('button, a, label')) continue;
    // text inside a fixed-size scroll strip (e.g. chip rows with overflow-x) is fine to clip
    items.push({
      el, r, interactive,
      text: (el.innerText || el.value || el.getAttribute('aria-label') || tag).trim().replace(/\s+/g, ' ').slice(0, 40),
      hud: !!el.closest('.z-50, [class*="z-50"]') && !el.closest('[data-chapter]'),
    });
  }
  const issues = [];
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    // off-screen / clipped by the viewport edge
    const clipX = Math.max(0, -a.r.left) + Math.max(0, a.r.right - vw);
    const clipY = Math.max(0, -a.r.top) + Math.max(0, a.r.bottom - vh);
    if ((clipX > 4 || clipY > 4) && !a.el.closest('[class*="overflow-x-auto"], [class*="mega"]')) {
      issues.push({ kind: 'offscreen', a: a.text, px: Math.round(clipX + clipY) });
    }
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ix = Math.max(0, Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left));
      const iy = Math.max(0, Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top));
      const inter = ix * iy;
      if (inter < 30) continue;
      const small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if (inter / small < 0.12) continue;
      issues.push({ kind: 'overlap', a: a.text, b: b.text, frac: +(inter / small).toFixed(2), hud: a.hud || b.hud });
    }
  }
  return issues;
}

const report = {};
for (const [W, H] of sizes) {
  const mobile = W < 600;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  await page.goto(url + '?nopre=1&snap=1', { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => document.querySelectorAll('section[data-chapter]').length >= 9, null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  const chapters = await page.evaluate(() =>
    [...document.querySelectorAll('section[data-chapter]')].map((s) => ({ id: s.id, top: s.offsetTop, h: s.offsetHeight })));
  const key = `${W}x${H}`;
  report[key] = {};
  for (const c of chapters) {
    if (only && !only.includes(c.id)) continue;
    for (const f of STEPS) {
      const y = Math.round(c.top + Math.max(0, c.h - H) * f);
      await page.evaluate((yy) => { window.__lenis?.scrollTo(yy, { immediate: true, force: true }); window.scrollTo(0, yy); }, y);
      await page.waitForTimeout(1100);
      const issues = await page.evaluate(scan);
      if (issues.length) {
        report[key][`${c.id}@${f}`] = issues;
        if (shotsDir) {
          fs.mkdirSync(path.join(shotsDir, key), { recursive: true });
          await page.screenshot({ path: path.join(shotsDir, key, `${c.id}-${String(Math.round(f * 100)).padStart(2, '0')}.png`) });
        }
      }
    }
  }
  await ctx.close();
}
await browser.close();

for (const [size, steps] of Object.entries(report)) {
  const n = Object.values(steps).reduce((a, b) => a + b.length, 0);
  console.log(`\n=== ${size}: ${n} issues in ${Object.keys(steps).length} frames`);
  for (const [k, list] of Object.entries(steps)) {
    console.log(`  ${k}`);
    for (const it of list.slice(0, 6)) {
      console.log(it.kind === 'overlap'
        ? `    overlap ${it.frac}${it.hud ? ' [HUD]' : ''}: "${it.a}"  ×  "${it.b}"`
        : `    offscreen ${it.px}px: "${it.a}"`);
    }
    if (list.length > 6) console.log(`    … +${list.length - 6} more`);
  }
}
fs.mkdirSync(shotsDir || '.', { recursive: true });
fs.writeFileSync(path.join(shotsDir || '.', 'overlap-report.json'), JSON.stringify(report, null, 2));
