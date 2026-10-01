import { loadPhysics } from './platform/physics';
import { Engine } from './runtime/engine';
import { Input } from './runtime/input';
import { TestRoomStage } from './stages/test-room';

/** Read-only runtime state for automated checks. Phase 8 replaces this with proper diagnostics. */
interface HouseState {
  status: 'starting' | 'ready' | 'error';
  renderer?: string;
  physics?: string;
  error?: string;
  frames: () => number;
  feet: () => { x: number; y: number; z: number } | null;
  locked: () => boolean;
}

declare global {
  interface Window {
    __house?: HouseState;
  }
}

const app = document.getElementById('app')!;
const start = document.getElementById('start')!;

async function boot(): Promise<void> {
  const rapier = await loadPhysics();
  const input = new Input(app);
  const engine = new Engine(app, input);
  await engine.init();

  const stage = new TestRoomStage(rapier);
  engine.setStage(stage);
  engine.start();

  // The start screen forwards clicks to the canvas, which requests pointer lock.
  start.addEventListener('click', () => app.click());
  input.onLockChanged((locked) => start.classList.toggle('hidden', locked));

  window.__house = {
    status: 'ready',
    renderer: engine.backend,
    physics: `rapier ${rapier.version()}`,
    frames: () => engine.frames,
    feet: () => stage.player.feet,
    locked: () => input.isLocked,
  };
}

window.__house = { status: 'starting', frames: () => 0, feet: () => null, locked: () => false };
boot().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  window.__house = { ...window.__house!, status: 'error', error: message };
  console.error(err);
});
