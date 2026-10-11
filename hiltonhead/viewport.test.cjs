const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit, devices } = require('playwright');

async function check(browser, url, screenshot) {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  try {
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (url.startsWith('https:')) assert.equal(response.status(), 200);
    await page.locator('#onb .who').waitFor({ timeout: 45000 });
    const metrics = await page.evaluate(() => {
      const grid = document.querySelector('#onb .who').getBoundingClientRect();
      return { viewport: document.querySelector('meta[name="viewport"]')?.content,
        innerWidth, pixelRatio: devicePixelRatio,
        touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
        scrollWidth: document.documentElement.scrollWidth,
        grid: { x: grid.x, width: grid.width } };
    });
    assert.match(metrics.viewport || '', /width=device-width/);
    assert.match(metrics.viewport, /initial-scale=1(?:[,.]|$)/);
    assert.equal(metrics.innerWidth, 390);
    assert.equal(metrics.pixelRatio, 3);
    assert.ok(metrics.touch > 0);
    assert.ok(metrics.scrollWidth <= 390);
    assert.ok(Math.abs(metrics.grid.width - 358) <= 1, 'Grid must fill width inside 16px padding');
    assert.ok(Math.abs(metrics.grid.x - 16) <= 1);
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await page.screenshot({ path: screenshot });
    console.log('PASS', browser.browserType().name(), url, JSON.stringify(metrics));
  } finally { await context.close(); }
}

(async () => {
  const url = process.argv[2] || 'file://' + path.join(__dirname, 'index.html');
  const output = process.env.QA_OUTPUT || path.join(__dirname, 'screenshots');
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch({ headless: true });
    try { await check(browser, url, path.join(output, `viewport-${engine.name()}-iphone13.png`)); }
    finally { await browser.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
