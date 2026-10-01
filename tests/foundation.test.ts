import { describe, expect, it } from 'vitest';
import { loadPhysics } from '../src/platform/physics';

describe('foundation: physics runtime', () => {
  it('initialises Rapier under Node', async () => {
    const rapier = await loadPhysics();
    expect(rapier.version()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('applies the configured gravity to a dynamic body', async () => {
    const rapier = await loadPhysics();
    const world = new rapier.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;
    const body = world.createRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(0, 10, 0));
    world.createCollider(rapier.ColliderDesc.ball(0.5), body);

    for (let i = 0; i < 60; i++) world.step();

    // Free fall for 1 s: about 4.9 m, minus a little from semi-implicit Euler stepping.
    const fallen = 10 - body.translation().y;
    expect(fallen).toBeGreaterThan(4.7);
    expect(fallen).toBeLessThan(5.1);
    world.free();
  });
});
