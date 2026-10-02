# The House server

The House runs entirely in the browser by default. The server is optional: it exists so that
journeys and private worlds can be owned by someone other than the browser that claims them, which
is required before any multi-user release (AT-12).

## When it is used

The client talks to a server only if it was built with `VITE_API_URL` set. If that server cannot be
reached within 3 seconds at start-up, the House opens anyway with the journey kept locally, and the
diagnostics overlay says so (`journey local (server unreachable: …)`).

```
npm run server                 # API on http://localhost:8787, in-memory store
HOUSE_DB=house.db npm run server   # same, persisted to SQLite
npm run smoke:remote           # builds the client against it and walks two full journeys
```

| Variable | Meaning |
| --- | --- |
| `HOUSE_SECRET` | Token signing secret, at least 32 characters. Required when `NODE_ENV=production`; otherwise a random one is generated per run. **Never commit it or put it in the client.** |
| `HOUSE_DB` | SQLite file. Unset means in-memory. |
| `HOUSE_ORIGINS` | Comma-separated browser origins allowed by CORS (default `http://localhost:5173`). |
| `PORT` | Default 8787. |

## What the server owns

- **Sessions.** `POST /api/session` creates an anonymous visitor (no account, no personal data)
  and returns an HMAC-signed token that expires (7 days by default) and can be revoked
  (`DELETE /api/session`).
- **Journeys.** The server picks the journey seed and runs the same `JourneyEngine` as the client,
  so the rules exist once. Every transition is validated server-side; illegal ones return 409.
- **Private worlds.** Opening a door stores the world (id, owner, seeds). Only the owner can read
  it. The browser receives the seeds of worlds it opened itself, and never the journey seed.
- **Door hints.** The light colour under a door is computed on the server; only the colour is sent.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness (no auth) |
| POST | `/api/session` | New anonymous session (no auth) |
| DELETE | `/api/session` | Revoke the current session |
| POST | `/api/journeys` | Start a journey |
| GET | `/api/journeys/:id` | Own journey, without its seed |
| GET | `/api/journeys/:id/doors/:door/hint?roomId=` | Light colour only |
| POST | `/api/journeys/:id/rooms` | `{roomId}`: moved between House rooms |
| POST | `/api/journeys/:id/doors/:door/open` | `{roomId}`: returns `{worldId, seeds}` |
| POST | `/api/journeys/:id/worlds/:world/enter` | Arrived in the world |
| POST | `/api/journeys/:id/abort` | `{roomId}`: generation failed, back to the House |
| POST | `/api/journeys/:id/leave` | `{doorId}`: through the way out |
| POST | `/api/journeys/:id/house` | `{roomId}`: arrived back in the House |
| GET | `/api/worlds/:id` | Own private world's seeds |

## Security model

| Threat | Defence | Test |
| --- | --- | --- |
| Reading another visitor's world or journey | Ownership checked on every route; non-owned returns the same 404 as non-existent | `tests/server.test.ts` (AT-12) |
| Probing whether an id exists | Identical response for "someone else's" and "missing" | same |
| Guessing ids | Random 128-bit ids; world ids are a one-way hash and reveal nothing about seeds | same |
| Tampered or forged tokens | HMAC-SHA256, constant-time verification, secret never leaves the server | same |
| Token claims pointing at another session | Session record must match the token's visitor id | same |
| Stale or replayed credentials | Tokens expire; revoked sessions are refused | same |
| Malformed or over-specified input | Strict Zod schemas on every body and id; extra fields rejected | same |
| SQL injection | Parameterised statements only | same (injection-shaped ids) |
| Corrupted stored data | Rows re-validated with Zod when read | `SqliteStore` |
| Cross-origin abuse from browsers | CORS allow-list | `server configuration` tests |
| Secret in the client bundle | Only `VITE_API_URL` is exposed to the client | build config |

### Known gaps (before a public multi-user release)

- **No rate limiting.** Anyone can create sessions and journeys freely. Add per-IP limits at the
  host or in middleware before going public.
- **No data expiry.** Expired sessions and old journeys are never deleted. Add a cleanup job.
- **Last write wins.** Two simultaneous requests for one journey can race. A single visitor's
  client queues its calls, so this needs a misbehaving client; add optimistic versioning if it
  matters.
- **WebSockets** do not exist yet; their authorisation must be designed with Phase 23.
- The developer routes `?world=` and `?debug` still work in production builds. They expose nothing
  from the server, only what the browser already has.

## Hosting: not chosen yet

The spec says not to commit to a provider before comparing requirements, and not to guess costs.
Choosing one needs an account, so it is a decision for the project owner. The code is
provider-neutral: Hono uses web-standard `Request`/`Response`, tokens use Web Crypto, and storage is
behind the `Store` interface.

| Option | Fit | Work needed | How it is priced |
| --- | --- | --- | --- |
| **Static site + Cloudflare Workers + D1** | Strong: Hono and Web Crypto run natively; D1 is SQLite-compatible; scales to zero | A `D1Store` (close to `SqliteStore`) and a Worker entry point | Free tier, then per request and per database row read/written |
| **Vercel (static) + Vercel Functions + a hosted SQL database** (Turso/libSQL or Neon Postgres) | Good: Hono has a Vercel adapter; you already use Vercel | A store for the chosen database, a function entry point | Free hobby tier, then per invocation and duration; database billed separately |
| **One small always-on container** (Fly.io, Railway, Render) with SQLite on a volume | Simplest: the current `npm run server` runs unchanged | A Dockerfile and a volume | Fixed monthly instance cost even when idle; the spec warns against unnecessary always-on infrastructure |

**Recommendation:** Cloudflare Workers with D1, because cost follows usage and the code needs the
least adaptation of the scale-to-zero options. Vercel is the alternative if keeping everything on
your existing Vercel account matters more. Measure real request and storage numbers on whichever is
chosen before estimating a monthly bill.

Remember the commit-email rule for Vercel deployments: commits must be authored as the GitHub
account's email.
