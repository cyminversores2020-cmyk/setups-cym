// Conjuntos de datos publicados (etf, acc, rs, list) con historial para volver atrás.
import { query, tx } from './db.js';

export const KINDS = ['etf', 'acc', 'rs', 'list'];
export const KIND_LABELS = {
  etf: 'ETFs y sectores',
  acc: 'Lista base de acciones',
  rs: 'Acciones con RS superior a SPY',
  list: 'Listas de seguimiento',
};
const KEEP_HISTORY = 12;        // versiones anteriores que se conservan por conjunto
const DRAFT_DAYS = 7;           // los borradores sin publicar se borran a los 7 días

const meta = (r) => ({
  id: Number(r.id), kind: r.kind, status: r.status,
  date: r.data_date ?? null,
  filename: r.filename, uploadedBy: r.uploaded_by, uploadedAt: r.uploaded_at, publishedAt: r.published_at,
  stats: r.stats, warnings: r.warnings,
});

export async function saveDraft(kind, parsed, { filename, actor }) {
  const { rows } = await query(
    `INSERT INTO dataset_versions (kind, status, data_date, filename, uploaded_by, stats, warnings, data)
     VALUES ($1,'draft',$2,$3,$4,$5,$6,$7) RETURNING *`,
    [kind, parsed.date, filename || null, actor || null,
      JSON.stringify(parsed.stats ?? null), JSON.stringify(parsed.warnings ?? []), JSON.stringify(parsed.data)],
  );
  return meta(rows[0]);
}

export async function getVersion(id) {
  const { rows } = await query('SELECT * FROM dataset_versions WHERE id = $1', [id]);
  return rows[0] ? { ...meta(rows[0]), data: rows[0].data } : null;
}

/** Publica una versión (borrador o anterior). La que estaba publicada pasa al historial. */
export async function publish(id) {
  return tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM dataset_versions WHERE id = $1 FOR UPDATE', [id]);
    const v = rows[0];
    if (!v) { const e = new Error('Esa versión ya no existe.'); e.status = 404; throw e; }
    await c.query("UPDATE dataset_versions SET status = 'archived' WHERE kind = $1 AND status = 'published'", [v.kind]);
    const up = await c.query(
      "UPDATE dataset_versions SET status = 'published', published_at = now() WHERE id = $1 RETURNING *", [id],
    );
    // Limpieza: historial largo y borradores antiguos.
    await c.query(
      `DELETE FROM dataset_versions WHERE kind = $1 AND status = 'archived' AND id NOT IN (
         SELECT id FROM dataset_versions WHERE kind = $1 AND status = 'archived'
         ORDER BY published_at DESC NULLS LAST, id DESC LIMIT $2)`,
      [v.kind, KEEP_HISTORY],
    );
    await c.query(
      "DELETE FROM dataset_versions WHERE status = 'draft' AND uploaded_at < now() - make_interval(days => $1)",
      [DRAFT_DAYS],
    );
    return meta(up.rows[0]);
  });
}

export async function discardDraft(id) {
  const { rowCount } = await query("DELETE FROM dataset_versions WHERE id = $1 AND status = 'draft'", [id]);
  return rowCount > 0;
}

// Caché en memoria de los datos publicados, validada por id de versión (válido con varios contenedores).
const cache = new Map();

async function publishedIds() {
  const { rows } = await query("SELECT kind, id, data_date, published_at FROM dataset_versions WHERE status = 'published'");
  return new Map(rows.map((r) => [r.kind, r]));
}

/** { etf: {id, date, data}, acc: ..., rs: ..., list: ... } (solo los que están publicados). */
export async function getPublishedAll() {
  const ids = await publishedIds();
  const out = {};
  for (const [kind, r] of ids) {
    let hit = cache.get(kind);
    if (!hit || hit.id !== String(r.id)) {
      const v = await query('SELECT data FROM dataset_versions WHERE id = $1', [r.id]);
      hit = { id: String(r.id), data: v.rows[0].data };
      cache.set(kind, hit);
    }
    out[kind] = {
      id: Number(r.id),
      date: r.data_date ?? null,
      publishedAt: r.published_at,
      data: hit.data,
    };
  }
  return out;
}

export async function getPublished(kind) {
  return (await getPublishedAll())[kind] || null;
}

/** Estado de cada conjunto para el panel: publicada, borradores e historial. */
export async function overview() {
  const { rows } = await query(
    `SELECT id, kind, status, data_date, filename, uploaded_by, uploaded_at, published_at, stats, warnings
     FROM dataset_versions ORDER BY COALESCE(published_at, uploaded_at) DESC, id DESC`,
  );
  const out = {};
  for (const kind of KINDS) {
    const mine = rows.filter((r) => r.kind === kind).map(meta);
    out[kind] = {
      kind, label: KIND_LABELS[kind],
      published: mine.find((v) => v.status === 'published') || null,
      drafts: mine.filter((v) => v.status === 'draft'),
      history: mine.filter((v) => v.status === 'archived'),
    };
  }
  return out;
}

// ---------- Comparación con lo publicado (para la vista previa) ----------

const symbols = (arr) => new Set((arr || []).map((x) => x.s));
const setDiff = (a, b) => [...a].filter((x) => !b.has(x));

export function diffData(kind, current, next) {
  if (!current) return null;
  const out = {};
  if (kind === 'list') {
    for (const k of ['acc', 'etf']) {
      const a = symbols(current[k]); const b = symbols(next[k]);
      out[k] = { added: setDiff(b, a), removed: setDiff(a, b), total: [...b].length };
    }
    return out;
  }
  const sheets = kind === 'rs' ? ['all', 'top'] : ['ind', 'brk', 'reb', 'per'];
  for (const k of sheets) {
    out[k] = { before: (current[k] || []).length, after: (next[k] || []).length };
  }
  out.short = {};
  for (const k of ['ind', 'brk', 'reb']) {
    const a = symbols(current.short?.[k]); const b = symbols(next.short?.[k]);
    out.short[k] = { added: setDiff(b, a), removed: setDiff(a, b) };
  }
  return out;
}

/** Datos de la lista de seguimiento publicada con cambios manuales (añadir/quitar). */
export async function editList(mutator, { actor, note }) {
  const cur = await getPublished('list');
  const data = structuredClone(cur?.data || { acc: [], etf: [] });
  mutator(data);
  const draft = await saveDraft('list', {
    date: new Date().toISOString().slice(0, 10),
    data,
    stats: { acciones: data.acc.length, etfs: data.etf.length },
    warnings: [],
  }, { filename: note, actor });
  return publish(draft.id);
}
