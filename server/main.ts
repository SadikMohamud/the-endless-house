// Local server: `npm run server`. Configuration comes from the environment only.
//   HOUSE_SECRET     at least 32 characters; required when NODE_ENV=production
//   HOUSE_DB         SQLite file path (default: in-memory, lost on restart)
//   HOUSE_ORIGINS    comma-separated browser origins allowed to call the API
//   PORT             default 8787
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { SqliteStore } from './sqlite-store';
import { MemoryStore } from './store';

const production = process.env.NODE_ENV === 'production';
let secret = process.env.HOUSE_SECRET ?? '';
if (!secret) {
  if (production) {
    console.error('HOUSE_SECRET must be set in production.');
    process.exit(1);
  }
  secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  console.warn('HOUSE_SECRET not set: using a random secret; sessions end when the server stops.');
}

const store = process.env.HOUSE_DB ? new SqliteStore(process.env.HOUSE_DB) : new MemoryStore();
const allowedOrigins = (process.env.HOUSE_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: createApp({ store, secret, allowedOrigins }).fetch, port }, () => {
  console.log(
    `House server on http://localhost:${port} (${process.env.HOUSE_DB ? `SQLite ${process.env.HOUSE_DB}` : 'in-memory'})`,
  );
});
