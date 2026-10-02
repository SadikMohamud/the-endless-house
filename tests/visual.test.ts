import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { DEFAULT_HOUSE_DNA, VisualProfileId } from '../src/domain';
import { generateForest, DEFAULT_BUDGET } from '../src/gen/forest';
import { planWorld, VISUAL_WEIGHTS } from '../src/gen/planner';
import { seedsFromWorldSeed } from '../src/gen/seeds';
import { buildDestination } from '../src/journey/destination';
import { loadPhysics } from '../src/platform/physics';
import { ForestStage } from '../src/stages/forest-stage';
import { VISUAL_STYLES } from '../src/visual/styles';

describe('visual styles', () => {
  it('covers every visual profile id', () => {
    expect(Object.keys(VISUAL_STYLES).sort()).toEqual([...VisualProfileId.options].sort());
  });

  it('builds the expected kind of material', () => {
    const kinds = Object.fromEntries(
      VisualProfileId.options.map((id) => [id, VISUAL_STYLES[id].material('#3A332C')]),
    );
    expect((kinds.NATURAL as THREE.MeshStandardMaterial).isMeshStandardMaterial).toBe(true);
    expect((kinds.LOW_POLY as THREE.MeshStandardMaterial).flatShading).toBe(true);
    expect((kinds.TWO_BIT as THREE.MeshToonMaterial).isMeshToonMaterial).toBe(true);
    expect((kinds.WIREFRAME as THREE.MeshBasicMaterial).wireframe).toBe(true);
    const mono = (kinds.MONOCHROME as THREE.MeshStandardMaterial).color;
    expect(mono.r).toBeCloseTo(mono.g, 6);
    expect(mono.g).toBeCloseTo(mono.b, 6);
  });

  it('desaturates the sky in monochrome and keeps it in natural', () => {
    expect(VISUAL_STYLES.NATURAL.atmosphere('#B9C4C0')).toBe('#B9C4C0');
    const c = new THREE.Color(VISUAL_STYLES.MONOCHROME.atmosphere('#B9C4C0'));
    expect(c.r).toBeCloseTo(c.g, 6);
  });
});

describe('planner visual profiles', () => {
  it('picks styles at the planned odds, ordinary first', () => {
    const N = 2000;
    const counts: Record<string, number> = {};
    for (let i = 0; i < N; i++) {
      const id = planWorld(seedsFromWorldSeed(`style-${i}`)).visualProfile.id;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    for (const [id, weight] of Object.entries(VISUAL_WEIGHTS)) {
      const share = (counts[id] ?? 0) / N;
      expect(share, id).toBeGreaterThan(weight * 0.75);
      expect(share, id).toBeLessThan(weight * 1.25);
    }
  });

  it('pins lighting and fog for a seed', () => {
    // Snapshot taken at forest@1.1.0. When 1.1.0 was introduced, its lighting, fog and physics
    // were checked equal to forest@1.0.0's across 500 seeds: styles use their own random stream.
    const plan = planWorld(seedsFromWorldSeed('golden'));
    expect(plan.generatorVersion).toBe('forest@1.1.0');
    expect(plan.lightingProfile).toMatchSnapshot();
    expect(plan.environmentProfile).toMatchSnapshot();
  });
});

describe('style never changes structure (still genuinely 3D)', () => {
  it('generates the same world whatever the style', () => {
    const reality = planWorld(seedsFromWorldSeed('structure'));
    const make = (id: VisualProfileId) =>
      generateForest({
        worldId: 'w',
        journeyId: 'j',
        reality: { ...reality, visualProfile: { id } },
        frame: { width: 1, height: 2.4 },
        budget: DEFAULT_BUDGET,
      });
    const natural = make('NATURAL');
    for (const id of VisualProfileId.options) {
      const f = make(id);
      expect(f.trees).toEqual(natural.trees);
      expect(Array.from(f.terrain.heights)).toEqual(Array.from(natural.terrain.heights));
    }
  });

  it('every style builds a forest stage with real geometry, and releases it', async () => {
    const rapier = await loadPhysics();
    const d = buildDestination(
      seedsFromWorldSeed('styles'),
      { worldId: 'w', journeyId: 'j' },
      DEFAULT_HOUSE_DNA,
    );
    for (const id of VisualProfileId.options) {
      const stage = new ForestStage(
        rapier,
        { ...d.reality, visualProfile: { id } },
        d.forest,
        DEFAULT_HOUSE_DNA,
      );
      let triangles = 0;
      stage.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const index = m.geometry.index;
        const count = index ? index.count : m.geometry.attributes.position!.count;
        const instances = (o as THREE.InstancedMesh).isInstancedMesh
          ? (o as THREE.InstancedMesh).count
          : 1;
        triangles += (count / 3) * instances;
      });
      expect(triangles, id).toBeGreaterThan(10_000);
      stage.dispose();
      expect(stage.scene.children, id).toHaveLength(0);
    }
  });
});
