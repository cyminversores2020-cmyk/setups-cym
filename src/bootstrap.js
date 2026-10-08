import { config } from './config.js';
import { NEED, LEVEL_NAMES, canSee } from './access.js';
import { getPublishedAll } from './store.js';
import { getSetting } from './settings.js';

const uniqueWithSetup = (d) => new Set(['ind', 'brk', 'reb', 'per'].flatMap((k) => (d[k] || []).map((r) => r.s))).size;

/**
 * Todo lo que la persona puede ver, en una sola respuesta. Los conjuntos de datos a los
 * que no llega su nivel NO se envían: solo un aviso con el nivel necesario y un número
 * orientativo (cuántas acciones hay esta semana).
 */
export async function buildBootstrap(level) {
  const pub = await getPublishedAll();
  const out = {
    level,
    levelName: LEVEL_NAMES[level],
    need: NEED,
    patreonUrl: config.patreon.pageUrl,
    dates: {}, u: { etf: null, acc: null }, rs: null, list: null, links: null,
    locked: {}, teaser: {}, empty: {},
  };
  for (const kind of ['etf', 'acc']) {
    const p = pub[kind];
    if (!p) { out.empty[kind] = true; continue; }
    out.dates[kind] = p.date;
    if (canSee(kind, level)) out.u[kind] = p.data;
    else { out.locked[kind] = NEED[kind]; out.teaser[kind] = uniqueWithSetup(p.data); }
  }
  if (!pub.rs) out.empty.rs = true;
  else {
    out.dates.rs = pub.rs.date;
    if (canSee('rs', level)) out.rs = pub.rs.data;
    else { out.locked.rs = NEED.rs; out.teaser.rs = pub.rs.data.all.length; }
  }
  if (!pub.list) out.empty.list = true;
  else {
    out.dates.list = pub.list.date;
    if (canSee('list', level)) out.list = pub.list.data;
    else out.locked.list = NEED.list;
  }
  if (canSee('links', level)) out.links = await getSetting('links');
  else out.locked.links = NEED.links;
  return out;
}
