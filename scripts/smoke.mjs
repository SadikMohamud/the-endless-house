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

  // Milestone 1 performance budget (docs/MILESTONE-1.md). Headless Chrome throttles its frame
  // rate, so fps is budgeted by `npm run perf` in a headed window; here only structure and CPU.
  const BUDGET = {
    house: { maxCpuMs: 8, maxDrawCalls: 200, maxTriangles: 200_000 },
    forest: { maxCpuMs: 8, maxDrawCalls: 40, maxTriangles: 1_500_000 },
  };
  const perf = async (label, budget) => {
    const d = await page.evaluate(() => window.__house.diagnostics());
    const a = d.loadedAssets;
    console.log(
      `smoke: perf ${label}: ${d.fps.toFixed(1)} fps, mean ${d.frameMs.toFixed(1)} ms, p95 ${d.frameP95Ms.toFixed(1)} ms, cpu ${d.cpuMs.toFixed(2)} ms, ${a.drawCalls} draw calls, ${a.triangles} triangles, ${a.geometries} geometries, ${a.textures} textures, heap ${d.jsHeapMb?.toFixed(0)} MB`,
    );
    check(d.cpuMs <= budget.maxCpuMs, `${label}: cpu <= ${budget.maxCpuMs} ms`);
    check(a.drawCalls <= budget.maxDrawCalls, `${label}: draw calls <= ${budget.maxDrawCalls}`);
    check(a.triangles <= budget.maxTriangles, `${label}: triangles <= ${budget.maxTriangles}`);
    return d;
  };

  await page.goto(`${URL}?debug`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__house?.status !== 'starting', { timeout: 20000 });
  const state = await page.evaluate(() => ({
    status: window.__house.status,
    renderer: window.__house.renderer,
    physics: window.__house.physics,
    error: window.__house.error,
  }));
  console.log('smoke:', JSON.stringify(state));
  check(state.status === 'ready', 'app reaches ready state');

  // Let first-frame shader compilation finish before counting.
  await sleep(2000);
  const f0 = await page.evaluate(() => window.__house.frames());
  await sleep(2000);
  const f1 = await page.evaluate(() => window.__house.frames());
  console.log(`smoke: ${f1 - f0} frames in 2 s (headless; not a performance figure)`);
  check(f1 - f0 > 10, 'frames are rendering');

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
    await perf('House corridor', BUDGET.house);
    await page.keyboard.press('Backquote');
    await sleep(400);
    check(
      await page.evaluate(() => window.__house.diagnosticsVisible()),
      'diagnostics overlay opens',
    );
    await shot('2b-diagnostics');
    await page.keyboard.press('Backquote');
    await sleep(13000);
    await page.keyboard.up('KeyW');
    const atDoor = await page.evaluate(() => window.__house.feet());
    console.log(`smoke: stopped at z=${atDoor.z.toFixed(2)}`);
    check(await page.evaluate(() => window.__house.inReach()), 'door is in reach after walking');
    await shot('3-door');

    await page.keyboard.press('KeyE');
    await sleep(700);
    await shot('4-door-opening');
    await sleep(550);
    const state = await page.evaluate(() => window.__house.doorState());
    check(state === 'OPEN', `door opens with E (state ${state})`);
    await shot('5-haze');

    const phase = (p) =>
      page.waitForFunction((want) => window.__house.phase() === want, { timeout: 20000 }, p);
    const journey = () => page.evaluate(() => window.__house.journey());

    /** From inside a world: walk back through the frame and wait to be in the House again. */
    const returnHome = async (label) => {
      await page.keyboard.down('KeyS');
      await phase('to-house');
      await page.keyboard.up('KeyS');
      await phase('house');
      await sleep(1700); // haze lifts
      const j = await journey();
      check(
        j.location.kind === 'HOUSE' && j.location.roomId === 'corridor',
        `${label}: back in the House corridor`,
      );
      return page.evaluate(() => window.__house.gpuMemory());
    };

    // Trip 1: arrive in the world.
    await phase('world');
    await sleep(1700);
    let j = await journey();
    check(
      j.location.kind === 'WORLD' && j.location.worldId === j.worldId,
      'trip 1: journey is in the world',
    );
    await shot('6-trip1-world');
    const memory1 = await returnHome('trip 1');
    await shot('7-trip1-home');

    // Trip 2: from the corridor back to the door, through it, and home again.
    await page.keyboard.down('KeyW');
    await sleep(9000);
    await page.keyboard.up('KeyW');
    check(
      await page.evaluate(() => window.__house.inReach()),
      'trip 2: door in reach from the corridor',
    );
    await page.keyboard.press('KeyE');
    await phase('world');
    await sleep(1700);
    const memory2 = await returnHome('trip 2');

    j = await journey();
    const types = j.history.map((e) => e.type).join(',');
    console.log(`smoke: history ${types}`);
    const worlds = j.history.filter((e) => e.type === 'WORLD_ENTERED').map((e) => e.worldId);
    check(j.history.length === 10, 'journey history has both round trips');
    check(
      worlds.length === 2 && worlds[0] !== worlds[1],
      'the same door led to two different worlds',
    );
    console.log(
      `smoke: GPU memory after trip 1 ${JSON.stringify(memory1)}, after trip 2 ${JSON.stringify(memory2)}`,
    );
    check(
      memory2.geometries === memory1.geometries && memory2.textures === memory1.textures,
      'AT-11: GPU memory does not grow across round trips',
    );
  } else {
    check(false, 'pointer lock granted');
  }

  // Forest, via the developer reproduction route.
  await page.goto(`${URL}?world=smoke-forest`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__house?.status !== 'starting', { timeout: 20000 });
  const world = await page.evaluate(() => window.__house.world());
  console.log('smoke: world', JSON.stringify(world));
  check(world !== null && world.trees >= 400 && world.trees <= 900, 'forest generated in browser');
  await page.mouse.click(640, 360);
  await sleep(1300);
  await shot('6-forest-arrival');
  const f0pos = await page.evaluate(() => window.__house.feet());
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await sleep(2000);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  const f1pos = await page.evaluate(() => window.__house.feet());
  const walked = Math.hypot(f1pos.x - f0pos.x, f1pos.z - f0pos.z);
  console.log(`smoke: forest moved ${walked.toFixed(2)} m sprinting ~2 s`);
  check(walked > 3, 'can move through the forest');
  await sleep(1500); // fill the frame-time window with forest frames
  await perf('forest', BUDGET.forest);
  // Turn round to look back towards the frame.
  for (let i = 0; i < 20; i++) await page.mouse.move(640 + (i + 1) * 70, 360);
  await sleep(300);
  await shot('7-forest-looking-back');

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
