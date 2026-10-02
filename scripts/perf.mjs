// Frame-rate benchmark in a real (headed) Chrome window. Headless Chrome throttles its frame
// rate, so fps budgets are only checked here. Usage: npm run build && npm run perf
// PERF_HEADLESS=1 also measures headless, for comparison only.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:4173/';
const BUDGET = { minFps: 55, maxP95Ms: 25, maxCpuMs: 8 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'],
  { stdio: 'ignore' },
);
await sleep(1500);

let failed = false;
const modes = process.env.PERF_HEADLESS ? [false, true] : [false];
for (const headless of modes) {
  const browser = await puppeteer.launch({
    executablePath:
      process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless,
    args: ['--enable-unsafe-webgpu', '--use-angle=d3d11', '--window-size=1280,720'],
    defaultViewport: { width: 1280, height: 720 },
  });
  const page = await browser.newPage();
  for (const [scene, path] of [
    ['House', '?debug'],
    ['forest', '?world=smoke-forest&debug'],
  ]) {
    await page.goto(BASE + path, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__house?.status === 'ready', { timeout: 20000 });
    const adapter = await page.evaluate(async () => {
      const a = await navigator.gpu?.requestAdapter();
      return a ? `${a.info.vendor} ${a.info.architecture}` : 'no WebGPU adapter';
    });
    await page.mouse.click(640, 360);
    await page.keyboard.down('KeyW');
    await sleep(5000);
    const d = await page.evaluate(() => window.__house.diagnostics());
    await page.keyboard.up('KeyW');
    const ok =
      headless ||
      (d.fps >= BUDGET.minFps && d.frameP95Ms <= BUDGET.maxP95Ms && d.cpuMs <= BUDGET.maxCpuMs);
    if (!ok) failed = true;
    console.log(
      `perf: ${ok ? 'ok  ' : 'FAIL'} ${headless ? 'headless' : 'headed'} ${scene.padEnd(6)} ` +
        `${d.fps.toFixed(1)} fps, mean ${d.frameMs.toFixed(1)} ms, p95 ${d.frameP95Ms.toFixed(1)} ms, ` +
        `cpu ${d.cpuMs.toFixed(2)} ms, ${d.loadedAssets.drawCalls} draws, ${d.renderer} on ${adapter}` +
        (headless ? ' (headless: not budgeted)' : ''),
    );
  }
  await browser.close();
}
server.kill();
console.log(failed ? 'perf: FAIL' : 'perf: PASS');
process.exit(failed ? 1 : 0);
