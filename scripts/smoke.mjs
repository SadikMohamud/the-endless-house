// Headless browser smoke test: serves the production build and checks the app starts cleanly.
// Requires `npm run build` first. Set CHROME_PATH if Chrome is not in a standard location.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const URL = 'http://localhost:4173/';
const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error('smoke: Chrome not found. Set CHROME_PATH.');
  process.exit(1);
}

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'],
  { stdio: 'ignore' },
);

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('preview server did not start');
}

let failed = false;
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=d3d11'],
});
try {
  await waitForServer();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  page.on('pageerror', (e) => errors.push(e.message));

  // SMOKE_NO_WEBGPU=1 hides WebGPU from the page to exercise the automatic WebGL2 fallback.
  if (process.env.SMOKE_NO_WEBGPU) {
    await page.evaluateOnNewDocument(() => {
      delete Object.getPrototypeOf(navigator).gpu;
    });
  }

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__foundation, { timeout: 15000 });
  const result = await page.evaluate(() => window.__foundation);

  console.log('smoke:', JSON.stringify(result));
  if (result.error || result.physics === 'failed') failed = true;
  if (errors.length) {
    console.error('smoke: console errors:\n  ' + errors.join('\n  '));
    failed = true;
  }
} catch (err) {
  console.error('smoke:', err.message);
  failed = true;
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? 'smoke: FAIL' : 'smoke: PASS');
process.exit(failed ? 1 : 0);
