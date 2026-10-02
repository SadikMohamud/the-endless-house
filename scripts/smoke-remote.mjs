// End-to-end with the House server: builds the client against a local server, starts the
// server, and runs the full smoke walk-through expecting server-held journeys.
// Usage: npm run smoke:remote
import { spawn, spawnSync } from 'node:child_process';

const API = 'http://localhost:8787';
const OUT = 'dist-remote';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const build = spawnSync(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'build', '--outDir', OUT, '--emptyOutDir'],
  { stdio: 'inherit', env: { ...process.env, VITE_API_URL: API } },
);
if (build.status !== 0) process.exit(build.status ?? 1);

const server = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/main.ts'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, HOUSE_ORIGINS: 'http://localhost:4173', PORT: '8787' },
});
server.stdout.on('data', (d) => process.stdout.write(`server: ${d}`));
server.stderr.on('data', (d) => process.stdout.write(`server: ${d}`));

let up = false;
for (let i = 0; i < 50 && !up; i++) {
  try {
    up = (await fetch(`${API}/api/health`)).ok;
  } catch {
    await sleep(200);
  }
}
if (!up) {
  console.error('smoke:remote: server did not start');
  server.kill();
  process.exit(1);
}

const smoke = spawnSync(process.execPath, ['scripts/smoke.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, SMOKE_OUT_DIR: OUT, SMOKE_EXPECT_JOURNEY: 'server' },
});
server.kill();
process.exit(smoke.status ?? 1);
