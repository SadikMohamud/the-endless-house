# Determinism and reproduction

The House generates worlds from seeds. This document says how seeds are derived, what is
guaranteed to reproduce, and where reproduction stops.

## Seed derivation

All seeds are strings. Child seeds are derived with:

```
deriveSeed(parent, label) = hex(cyrb128(parent + "/" + label))   // 32 hex characters
```

| Seed | Derived from |
|---|---|
| `journeySeed` | Chosen when a journey starts (Phase 7) |
| `roomSeed` | `deriveSeed(houseSeed, "room:<roomId>")` |
| `worldSeed` | `deriveSeed(journeySeed, "door:<doorId>:<visit>")` |
| `visualSeed`, `physicsSeed`, `movementSeed`, `eventSeed`, `audioSeed` | `deriveSeed(worldSeed, "<subsystem>")` |

Consequences:

- The same door leads to a different world on a different journey (`journeySeed` differs) and on
  a second visit within one journey (`visit` differs).
- Subsystem seeds are independent: changing how lighting is chosen does not reshuffle physics.

Code: `src/gen/rng.ts`, `src/gen/seeds.ts`.

## Random numbers

`Rng` is sfc32 seeded from `cyrb128(seed)`, with the first 12 outputs discarded. Each consumer
creates its own `Rng` from its own seed and label (for example `${worldSeed}/forest`), so
consumers do not share a stream.

`Math.random()` is banned in `src/` by lint.

## What reproduces exactly

Given the same **world seed**, **reality configuration** and **generator version**:

- The planner (`planWorld`) returns an identical `RealityConfiguration`.
- The forest generator returns identical output: terrain heights, clearings, every tree, the
  return frame and the arrival point.

This holds across JavaScript engines and machines because generation uses only:

- 32-bit integer operations (`Math.imul`, shifts, `| 0`, `>>> 0`) for hashing and random numbers;
- `+ - * /`, `Math.floor`, `Math.min`, `Math.max`, `Math.abs`, `Math.sqrt` and `Math.round` on
  doubles, all of which IEEE 754 or the ECMAScript spec define exactly;
- `Float32Array` storage, whose rounding is exact.

It deliberately avoids `Math.sin`, `Math.cos`, `Math.atan2`, `Math.hypot`, `Math.pow` and `**`
inside generators, because the ECMAScript spec lets their results differ between engines in the
last bit. Directions are picked from a table of exact unit vectors instead of angles.

Tests pin this: `tests/generation.test.ts` snapshots the RNG output and a fingerprint of the
`golden` forest. **If a generator change alters that snapshot, bump the generator version** (for
example `forest@1.0.0` → `forest@1.1.0`) so old seeds are not silently reinterpreted.

## What does not reproduce exactly

- **Physics over time.** Rapier steps at a fixed 1/60 s, but the number of steps per rendered
  frame depends on frame timing, and the standard Rapier build does not promise identical
  floating-point results across platforms. A walk through a world is not replayable
  frame-for-frame. The world itself is.
- **Rendering.** Mesh building uses trigonometry (sun direction, frame rotation, normals). Pixels
  can differ between GPUs and between the WebGPU and WebGL2 back ends.
- **Journey seeds** come from the browser's secure random source when a journey starts, by design.

## Reproducing a world

In any build, open the app with `?world=<worldSeed>` to load the forest for that seed directly,
using the current generator version. Phase 8 adds an on-screen diagnostics overlay that shows the
active seed and generator version.
