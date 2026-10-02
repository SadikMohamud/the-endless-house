import { DEFAULT_HOUSE_DNA } from './domain';
import { DEFAULT_BUDGET, generateForest } from './gen/forest';
import { planWorld } from './gen/planner';
import { seedsFromWorldSeed } from './gen/seeds';
import { loadPhysics, type Rapier } from './platform/physics';
import { Engine } from './runtime/engine';
import type { Player } from './runtime/player';
import { Input } from './runtime/input';
import type { Stage } from './runtime/stage';
import { ForestStage } from './stages/forest-stage';
import { HouseStage } from './stages/house-stage';

/** Read-only runtime state for automated checks. Phase 8 replaces this with proper diagnostics. */
interface HouseState {
  status: 'starting' | 'ready' | 'error';
  renderer?: string;
  physics?: string;
  error?: string;
  frames: () => number;
  feet: () => { x: number; y: number; z: number } | null;
  locked: () => boolean;
  inReach: () => boolean;
  doorState: () => string | null;
  world: () => {
    seed: string;
    generatorVersion: string;
    physicsProfile: string;
    lighting: string;
    trees: number;
    clearings: number;
  } | null;
}

declare global {
  interface Window {
    __house?: HouseState;
  }
}

const app = document.getElementById('app')!;
const start = document.getElementById('start')!;
const dot = document.getElementById('dot')!;
const glyph = document.getElementById('glyph')!;

/**
 * Developer reproduction route (spec §53): `?world=<seed>` opens the forest for that world seed
 * directly. Phase 7 makes the House door the normal way in.
 */
function forestFromSeed(rapier: Rapier, worldSeed: string): ForestStage {
  const reality = planWorld(seedsFromWorldSeed(worldSeed));
  const forest = generateForest({
    worldId: 'dev-world',
    journeyId: 'dev-journey',
    reality,
    frame: { width: DEFAULT_HOUSE_DNA.doorWidth, height: DEFAULT_HOUSE_DNA.doorHeight },
    budget: DEFAULT_BUDGET,
  });
  return new ForestStage(rapier, reality, forest, DEFAULT_HOUSE_DNA);
}

async function boot(): Promise<void> {
  const rapier = await loadPhysics();
  const input = new Input(app);
  const engine = new Engine(app, input);
  await engine.init();

  const setFocus = (on: boolean) => {
    dot.classList.toggle('focus', on);
    glyph.classList.toggle('focus', on);
  };

  const worldSeed = new URLSearchParams(location.search).get('world');
  const stage: Stage & { player: Player } = worldSeed
    ? forestFromSeed(rapier, worldSeed)
    : new HouseStage(rapier, DEFAULT_HOUSE_DNA, 'house-seed-1', { onFocusChange: setFocus });
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
    inReach: () => (stage instanceof HouseStage ? stage.inReach : false),
    doorState: () => (stage instanceof HouseStage ? stage.doorState : null),
    world: () =>
      stage instanceof ForestStage
        ? {
            seed: stage.reality.seed,
            generatorVersion: stage.reality.generatorVersion,
            physicsProfile: stage.reality.physicsProfile.id,
            lighting: stage.reality.lightingProfile.id,
            trees: stage.forest.stats.treeCount,
            clearings: stage.forest.stats.clearingCount,
          }
        : null,
  };
}

window.__house = {
  status: 'starting',
  frames: () => 0,
  feet: () => null,
  locked: () => false,
  inReach: () => false,
  doorState: () => null,
  world: () => null,
};
boot().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  window.__house = { ...window.__house!, status: 'error', error: message };
  console.error(err);
});
