// Headless browser smoke test: serves the production build and checks the app runs.
// Requires `npm run build` first. Set CHROME_PATH if Chrome is not in a standard location.
// SMOKE_NO_WEBGPU=1 hides WebGPU to exercise the WebGL2 fallback.
// SMOKE_SHOTS=dir saves screenshots along the walk.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error('preview server did not start');
}

const failures = [];
const check = (ok, label) => {
  console.log(`smoke: ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=d3d11', '--window-size=1280,720'],
  defaultViewport: { width: 1280, height: 720 },
});
try {
  await waitForServer();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));

  if (process.env.SMOKE_NO_WEBGPU) {
    await page.evaluateOnNewDocument(() => {
      delete Object.getPrototypeOf(navigator).gpu;
    });
  }

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__house?.status !== 'starting', { timeout: 20000 });
  const state = await page.evaluate(() => ({
    status: window.__house.status,
    renderer: window.__house.renderer,
    physics: window.__house.physics,
    error: window.__house.error,
  }));
  console.log('smoke:', JSON.stringify(state));
  check(state.status === 'ready', 'app reaches ready state');

  const f0 = await page.evaluate(() => window.__house.frames());
  await sleep(1000);
  const f1 = await page.evaluate(() => window.__house.frames());
  console.log(`smoke: ${f1 - f0} frames in 1 s (headless; not a performance figure)`);
  check(f1 - f0 > 5, 'frames are rendering');

  // Enter: click the start screen, which requests pointer lock.
  await page.mouse.click(640, 360);
  await sleep(300);
  const locked = await page.evaluate(() => window.__house.locked());
  const shot = async (name) => {
    if (!process.env.SMOKE_SHOTS) return;
    const path = `${process.env.SMOKE_SHOTS}/${name}.png`;
    await page.screenshot({ path });
    console.log(`smoke: screenshot ${path}`);
  };

  if (locked) {
    await sleep(1000); // let the start screen finish fading
    await shot('1-start');
    const before = await page.evaluate(() => window.__house.feet());
    await page.keyboard.down('KeyW');
    await sleep(1000);
    const after = await page.evaluate(() => window.__house.feet());
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    console.log(`smoke: moved ${moved.toFixed(2)} m holding W for ~1 s`);
    check(moved > 0.5 && moved < 3, 'keyboard movement works');

    // Keep walking: through the corridor to the door (about 32 m at 1.5 m/s).
    await sleep(10000);
    await shot('2-corridor');
    await sleep(13000);
    await page.keyboard.up('KeyW');
    const atDoor = await page.evaluate(() => window.__house.feet());
    console.log(`smoke: stopped at z=${atDoor.z.toFixed(2)}`);
    check(await page.evaluate(() => window.__house.inReach()), 'door is in reach after walking');
    await shot('3-door');

    await page.keyboard.press('KeyE');
    await sleep(700);
    await shot('4-door-opening');
    await sleep(900);
    const state = await page.evaluate(() => window.__house.doorState());
    check(state === 'OPEN', `door opens with E (state ${state})`);
    await shot('5-door-open');
  } else {
    check(false, 'pointer lock granted');
  }

  check(errors.length === 0, 'no console or network errors');
  if (errors.length) console.error('  ' + errors.join('\n  '));
} catch (err) {
  check(false, `unexpected: ${err.message}`);
} finally {
  await browser.close();
  server.kill();
}
console.log(failures.length ? 'smoke: FAIL' : 'smoke: PASS');
process.exit(failures.length ? 1 : 0);
