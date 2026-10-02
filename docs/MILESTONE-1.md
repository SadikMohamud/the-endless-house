# Milestone 1: One House, one door, one private world

Status as of 2 October 2026, commit after Phase 8.

## Acceptance tests

| Test | Status | Evidence |
|---|---|---|
| AT-01 Application starts | **Pass** | `npm run dev` serves the app (checked at Phase 1 and again at Phase 8). `npm run smoke` loads the production build in Chrome and reaches the `ready` state with no console or network errors. |
| AT-02 Genuine 3D House | **Pass** | `src/house/layout.ts` builds walls, floor, ceiling, openings and fittings as 3D boxes from House DNA; `tests/house.test.ts` validates the layout. Smoke screenshots show depth, lighting and shadows from a moving first-person camera. |
| AT-03 Movement and collision | **Pass** | `tests/player.test.ts` (wall stop, sliding, landing) and `tests/house.test.ts` (cannot leave the House in 8 directions or through the window) run against real Rapier collision. Smoke walks the full House in Chrome. |
| AT-04 Door interaction | **Pass** | Smoke presses E at the door in Chrome; the journey records `DOOR_OPENED` and moves to the world. The door is wired to `JourneyEngine.openDoor`, not a decorative animation. |
| AT-05 Procedural world generation | **Pass** | `tests/generation.test.ts`: terrain, 400 to 900 trees, 1 to 3 clearings, return frame, checked across 50 seeds. `tests/forest-physics.test.ts`: the ground collider matches the generated terrain (a mutation check proves the test catches a transposed heightfield). |
| AT-06 Seed reproducibility | **Pass** | Identical output for identical inputs, plus pinned fingerprints of the RNG and a `golden` forest. Engine-exact maths enforced by lint (see [DETERMINISM.md](DETERMINISM.md)). |
| AT-07 Seed variation | **Pass** | Distinct seeds differ in terrain heights, tree positions and clearings. |
| AT-08 Transition integrity | **Pass** | `tests/journey.test.ts`: round trips keep location and world references valid; illegal transitions throw without changing state. Smoke checks the journey history after two real round trips in Chrome. |
| AT-09 Physics profile | **Pass** | `tests/physics-profiles.test.ts`: the same 4 m/s jump measures apex 0.849 m / airtime 0.833 s under EARTH (theory 0.815 m / 0.815 s) and 3.07 m / 3.13 s under LOW_GRAVITY (theory 3.20 m / 3.20 s). |
| AT-10 AI independence | **Pass** | No AI exists in the codebase. `tests/journey.test.ts` generates a world with `fetch` stubbed to throw. |
| AT-11 Resource cleanup | **Pass** | `tests/cleanup.test.ts`: every geometry, material, light shadow map and instance buffer is disposed, and the physics world freed. Smoke: GPU memory identical after round trips 1 and 2 (70 geometries, 5 textures, 2 render targets). |
| AT-12 Private-world isolation | **Not applicable yet; blocking** | Milestone 1 is single-user with no backend, so there is nothing to isolate. **This test must pass before any multi-user private-world release** (Phase 9). |
| AT-13 Build and tests | **Pass** | `npm run check` (typecheck, lint, format, 95 unit tests, build, smoke) exits 0. A fresh clone passes `npm ci && npm run check`. |

## Performance budget

Test device: Intel Core 5 210H laptop, 16 GB RAM. Chrome renders on the **Intel integrated GPU**
(gen-12lp), not the RTX 5050, unless Windows is told otherwise. That makes it a sensible floor.

| Measure | Budget | House | Forest | Checked by |
|---|---|---|---|---|
| Frame rate (headed Chrome) | ≥ 55 fps | **Pending** (60.0 and 35.1 on battery) | **Pending** (33.2 and 30.0 on battery) | `npm run perf` |
| p95 frame time | ≤ 25 ms | **Pending** (17.2 on battery) | **Pending** | `npm run perf` |
| CPU per frame | ≤ 8 ms | 2.6 to 4.2 ms | 2.5 to 3.4 ms | smoke, perf |
| Draw calls | House ≤ 200, forest ≤ 40 | 78 to 93 | 9 | smoke |
| Triangles | House ≤ 200k, forest ≤ 1.5M | about 1.5k | about 69k | smoke |
| Generation time | none set | n/a | about 20 ms | unit test |

**Frame-rate measurements are not yet valid.** They were taken with the laptop on battery at 13%,
where Windows battery saver and Chrome's Energy Saver cap the frame rate (observed: a hard 30.0 fps
in both scenes, and the House alternating between 60 and 35 fps with no code change). The forest
must be re-measured with `npm run perf` on mains power before its fps budget can be called met.

Headless Chrome throttles its own frame rate, so `npm run smoke` never budgets fps; `npm run perf`
opens a real window for that.

## Manual verification

Verified in Chrome 154 (WebGPU and the WebGL2 fallback) through automated real-browser runs with
screenshots reviewed at each step: start screen, House, corridor, door prompt, door opening, haze,
forest arrival, frame, return to the corridor, diagnostics overlay.

**Still recommended:** a hands-on playthrough by a person with a real mouse, which automation does
not replace. Open `npm run dev`, click in, walk to the door, press E, find the frame, walk through
it. Press backtick for diagnostics.

## Known limitations

- Frame-rate budgets for both scenes await a mains-power measurement (above).
- Rapier's character controller occasionally shortens a step on flat ground: walking covers 95 to
  100% of the profile speed in distance; velocity is exact.
- Gravity must point straight down; directional gravity is rejected by validation until supported.
- Fog does not thicken at the world's edges; only the terrain rises.
- Flat materials, cone crowns, no undergrowth, no audio (all within the brief for Milestone 1).
- Single-user only: journeys live in browser memory and end when the tab closes.
- The developer route `?world=<seed>` and `?debug` work in production builds; review in Phase 9.
- Bundle is 5.2 MB (1.9 MB gzipped), mostly Rapier's embedded wasm and Three's WebGPU build.

## Gate

AT-01 to AT-11 and AT-13 pass. AT-12 is recorded as blocking the first multi-user release. The
remaining open items are the fps measurement on mains power and a human playthrough.
