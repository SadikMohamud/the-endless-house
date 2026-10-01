import RAPIER from '@dimforge/rapier3d-compat';

export type Rapier = typeof RAPIER;

let ready: Promise<Rapier> | null = null;

/**
 * Initialises Rapier's WebAssembly module once and shares it.
 * The compat build embeds the wasm, so this works in the browser and in Node tests alike.
 */
export function loadPhysics(): Promise<Rapier> {
  ready ??= RAPIER.init().then(() => RAPIER);
  return ready;
}
