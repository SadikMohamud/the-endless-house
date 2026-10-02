# The Endless House

An experimental procedural 3D environment. One House. Many doors. No guarantee of what happens next.

Status: **Milestone 1, Phase 1 (foundation).** The page currently runs a foundation check only, not the experience.

## Stack

- Vite + TypeScript (strict)
- Three.js (`three/webgpu`: WebGPU, with automatic WebGL2 fallback)
- Rapier physics (`@dimforge/rapier3d-compat`, wasm embedded)
- Vitest for unit tests, puppeteer-core for a headless browser smoke test

No backend, database or AI service is required.

## Commands

Requires Node 22 or later and npm.

| Command                           | Purpose                                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm install`                     | Install dependencies                                                                                 |
| `npm run dev`                     | Development server at http://localhost:5173                                                          |
| `npm run build`                   | Typecheck and production build to `dist/`                                                            |
| `npm run preview`                 | Serve the production build at http://localhost:4173                                                  |
| `npm test`                        | Unit tests (Vitest)                                                                                  |
| `npm run typecheck`               | TypeScript only                                                                                      |
| `npm run lint`                    | ESLint                                                                                               |
| `npm run format` / `format:check` | Prettier                                                                                             |
| `npm run smoke`                   | Headless Chrome check of the built app (run `build` first; set `CHROME_PATH` if Chrome is elsewhere) |
| `npm run check`                   | All of the above in order                                                                            |

## Rules

- No `Math.random()` in `src/`. Lint enforces this; generation uses the seeded generator.
- This repository is public. Never commit secrets or `.env` files.

## Documents

- [Experience brief](docs/EXPERIENCE_BRIEF.md): what the House should feel like.
- [Determinism](docs/DETERMINISM.md): seed derivation, what reproduces and what does not.

## Reproducing a world

Open `http://localhost:5173/?world=<seed>` to load the forest for any world seed directly.
