import {
  MOVEMENT_PROFILES,
  PHYSICS_PROFILES,
  RealityConfiguration,
  type LightingProfile,
  type SeedSet,
} from '../domain';
import { Rng } from './rng';

export const FOREST_GENERATOR_VERSION = 'forest@1.0.0';

/** Physics profile odds for the forest. Ordinary first: most worlds feel like Earth. */
const PHYSICS_WEIGHTS = { EARTH: 0.7, LOW_GRAVITY: 0.3 } as const;
const LIGHTING_WEIGHTS = { OVERCAST: 0.6, LOW_SUN: 0.4 } as const;

/**
 * The deterministic planner: seeds in, validated RealityConfiguration out.
 * The AI Director (Phase 19) must produce the same validated shape.
 */
export function planWorld(seeds: SeedSet): RealityConfiguration {
  const physicsRng = new Rng(seeds.physicsSeed);
  const visualRng = new Rng(seeds.visualSeed);

  const physicsId = physicsRng.weighted(PHYSICS_WEIGHTS);
  const lightingId = visualRng.weighted(LIGHTING_WEIGHTS);

  const lightingProfile: LightingProfile =
    lightingId === 'OVERCAST'
      ? {
          id: 'OVERCAST',
          sunElevation: round(visualRng.range(35, 65)),
          sunAzimuth: round(visualRng.range(0, 360)),
          sunColour: '#E4E8E6',
          sunIntensity: round(visualRng.range(0.8, 1.2)),
          ambientIntensity: round(visualRng.range(0.9, 1.2)),
        }
      : {
          id: 'LOW_SUN',
          sunElevation: round(visualRng.range(6, 18)),
          sunAzimuth: round(visualRng.range(0, 360)),
          sunColour: '#F2D3A6',
          sunIntensity: round(visualRng.range(1.6, 2.4)),
          ambientIntensity: round(visualRng.range(0.6, 0.85)),
        };

  const fogFar = round(visualRng.range(60, 80));
  const fogNear = round(visualRng.range(8, 22));

  return RealityConfiguration.parse({
    worldType: 'FOREST',
    visualProfile: { id: 'NATURAL' },
    physicsProfile: PHYSICS_PROFILES[physicsId],
    movementProfile: MOVEMENT_PROFILES.STANDARD,
    timeProfile: { id: 'NORMAL' },
    environmentProfile: { fogColour: '#B9C4C0', fogNear, fogFar },
    materialProfile: {
      id: 'FOREST_NATURAL',
      palette: { trunk: '#3A332C', foliage: '#2F4A36', ground: '#4B4A3A' },
    },
    lightingProfile,
    audioProfile: { id: 'SILENT' },
    dangerProfile: { id: 'NONE' },
    rarityProfile: { tier: 'COMMON' },
    seed: seeds.worldSeed,
    generatorVersion: FOREST_GENERATOR_VERSION,
  });
}

/** Two decimals: keeps plans readable in diagnostics and exact in JSON. */
const round = (n: number) => Math.round(n * 100) / 100;
