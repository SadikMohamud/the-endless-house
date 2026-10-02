import { RealityConfiguration, type HouseDNA, type SeedSet } from '../domain';
import { DEFAULT_BUDGET, generateForest, type GeneratedForest } from '../gen/forest';
import { planWorld } from '../gen/planner';

/** Turns seeds into a world plan. The deterministic planner today; the AI Director may wrap it. */
export type WorldPlanner = (seeds: SeedSet) => RealityConfiguration;

export interface Destination {
  worldId: string;
  reality: RealityConfiguration;
  forest: GeneratedForest;
}

/**
 * The spec §15 pipeline: plan → schema validation → resource validation (inside the
 * generator) → generation. Throws if any stage fails; the caller falls back.
 */
export function buildDestination(
  seeds: SeedSet,
  ids: { worldId: string; journeyId: string },
  dna: HouseDNA,
  planner: WorldPlanner = planWorld,
): Destination {
  const reality = RealityConfiguration.parse(planner(seeds));
  if (reality.seed !== seeds.worldSeed) throw new Error('plan does not match the world seed');
  const forest = generateForest({
    worldId: ids.worldId,
    journeyId: ids.journeyId,
    reality,
    frame: { width: dna.doorWidth, height: dna.doorHeight },
    budget: DEFAULT_BUDGET,
  });
  return { worldId: ids.worldId, reality, forest };
}
