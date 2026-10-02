# The Endless House

An experimental procedural 3D environment. One House. Many doors. No guarantee of what happens next.

Status: **Milestone 1 complete** (one House, one door, one private procedural world). See
[docs/MILESTONE-1.md](docs/MILESTONE-1.md) for acceptance-test evidence and open items.

## Playing

`npm run dev`, open http://localhost:5173, click to enter.

| Input         | Action                                                               |
| ------------- | -------------------------------------------------------------------- |
| Mouse         | Look                                                                 |
| W A S D       | Move                                                                 |
| E             | Open the door (when the dot brightens)                               |
| Space / Shift | Jump / move faster (worlds only)                                     |
| Esc           | Release the pointer                                                  |
| ` (backtick)  | Diagnostics overlay (development builds, or any build with `?debug`) |

## Stack

- Vite + TypeScript (strict)
- Three.js (`three/webgpu`: WebGPU, with automatic WebGL2 fallback)
- Rapier physics (`@dimforge/rapier3d-compat`, wasm embedded)
- Zod for every domain record and world plan
- Vitest for unit tests, puppeteer-core for browser checks

No backend, database or AI service is required: everything runs in the browser. An optional House
server (`server/`, Hono) makes journeys and private worlds server-owned; see
[docs/BACKEND.md](docs/BACKEND.md).

## Commands

Requires Node 22 or later and npm.

| Command                           | Purpose                                                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install`                     | Install dependencies                                                                                                                               |
| `npm run dev`                     | Development server at http://localhost:5173                                                                                                        |
| `npm run build`                   | Typecheck and production build to `dist/`                                                                                                          |
| `npm run preview`                 | Serve the production build at http://localhost:4173                                                                                                |
| `npm test`                        | Unit tests (Vitest)                                                                                                                                |
| `npm run typecheck`               | TypeScript only                                                                                                                                    |
| `npm run lint`                    | ESLint                                                                                                                                             |
| `npm run format` / `format:check` | Prettier                                                                                                                                           |
| `npm run smoke`                   | Headless Chrome walk-through of the built app: two full journeys, budgets, no errors (run `build` first; set `CHROME_PATH` if Chrome is elsewhere) |
| `npm run perf`                    | Frame-rate benchmark in a real Chrome window (run `build` first; use mains power)                                                                  |
| `npm run server`                  | House server on http://localhost:8787 (see docs/BACKEND.md)                                                                                        |
| `npm run smoke:remote`            | Full walk-through against a real local House server                                                                                                |
| `npm run check`                   | Typecheck, lint, format, tests, build and smoke, in order                                                                                          |

## Layout

| Path          | Contents                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `src/domain`  | Zod schemas: House, Room, Door, World, Journey, SeedSet, RealityConfiguration, profiles        |
| `src/gen`     | Seeded RNG, seed derivation, deterministic planner, forest generator (engine-exact maths only) |
| `src/house`   | House layout from DNA, door swing, interaction ray                                             |
| `src/journey` | Journey state machine, destination pipeline, the browser experience flow                       |
| `src/runtime` | Engine loop, input, first-person player on Rapier, disposal, frame stats                       |
| `src/stages`  | House and forest stages (rendering + physics)                                                  |
| `src/world`   | Forest colliders and frame crossing                                                            |
| `src/ui`      | Diagnostics overlay                                                                            |
| `server`      | Optional House server: sessions, server-owned journeys and private worlds                      |

## Rules

- No `Math.random()` in `src/`; no trig, `pow`, `hypot` or `**` in `src/gen`. Lint enforces both.
- If a generator's pinned fingerprint changes, bump its generator version.
- This repository is public. Never commit secrets or `.env` files.

## Documents

- [Experience brief](docs/EXPERIENCE_BRIEF.md): what the House should feel like.
- [Determinism](docs/DETERMINISM.md): seed derivation, what reproduces and what does not.
- [Milestone 1](docs/MILESTONE-1.md): acceptance tests, performance budget, known limitations.
- [Backend](docs/BACKEND.md): the House server, security model, hosting options.

## Reproducing a world

Open `http://localhost:5173/?world=<seed>` to load the forest for any world seed directly.
