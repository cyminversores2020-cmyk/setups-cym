import fs from 'node:fs';
import { config } from './config.js';
import { getPublished, saveDraft, publish } from './store.js';

/** Si todavía no hay lista de seguimiento publicada, carga la que se recibió el 2026-10-06. */
export async function seedWatchlist() {
  if (!config.seedWatchlist) return false;
  if (await getPublished('list')) return false;
  const file = new URL('../data/seed-watchlist.json', import.meta.url);
  if (!fs.existsSync(file)) return false;
  const seed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const draft = await saveDraft('list', {
    date: seed.date,
    data: seed.data,
    stats: { acciones: seed.data.acc.length, etfs: seed.data.etf.length },
    warnings: [],
  }, { filename: 'lista inicial (archivo recibido el 2026-10-06)', actor: 'sistema' });
  await publish(draft.id);
  console.log(`[seed] lista de seguimiento inicial publicada (${seed.data.acc.length} acciones, ${seed.data.etf.length} ETFs)`);
  return true;
}
