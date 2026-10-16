import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(process.argv[2] + '?nopre=1&gpu=2&snap=1', { waitUntil: 'networkidle' });
await p.waitForTimeout(Number(process.argv[3] || 15000));
console.log(await p.evaluate(() => JSON.stringify({ sh: document.documentElement.scrollHeight, secs: [...document.querySelectorAll('section')].map(s => [s.id, s.offsetHeight, getComputedStyle(s).height]) })));
await b.close();
