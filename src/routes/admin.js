import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import { config } from '../config.js';
import * as store from '../store.js';
import { readWorkbook } from '../import/xlsx.js';
import { parseUniverseWorkbook, parseRsWorkbook, ImportError } from '../import/signals.js';
import { parseWatchlistWorkbook, normalizeGroup } from '../import/watchlist.js';
import { getSetting, setSetting, cleanLinks } from '../settings.js';
import { audit, recomputeAll, refreshAccess, campaignId } from '../users.js';
import { levelFromTitle } from '../access.js';
import { requireUser, requireAdmin } from './api.js';

const router = Router();
router.use(requireUser, requireAdmin);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});
const uploadLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
const actor = (req) => req.user.email || req.user.patreon_id;
const bad = (res, msg, status = 400) => res.status(status).json({ error: msg });

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (e) { next(e); }
};

// ---------- Cargas de datos ----------

router.get('/datasets', wrap(async (_req, res) => { res.json(await store.overview()); }));

router.post('/uploads', uploadLimiter, upload.single('file'), wrap(async (req, res) => {
  const kind = req.body?.kind;
  if (!store.KINDS.includes(kind)) return bad(res, 'Tipo de carga no válido.');
  if (!req.file) return bad(res, 'Elige un archivo Excel (.xlsx).');
  const buf = req.file.buffer;
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    return bad(res, 'El archivo no es un Excel .xlsx. Guárdalo como «Libro de Excel (.xlsx)» y vuelve a subirlo.', 422);
  }
  try {
    const sheets = await readWorkbook(buf);
    const current = await store.getPublished(kind);
    let parsed;
    if (kind === 'rs') parsed = parseRsWorkbook(sheets);
    else if (kind === 'list') {
      parsed = parseWatchlistWorkbook(sheets);
      // Si el archivo no trae una de las hojas, se conserva la lista actual de esa hoja.
      if (!parsed.present.acc && current) parsed.data.acc = current.data.acc;
      if (!parsed.present.etf && current) parsed.data.etf = current.data.etf;
      parsed.date ??= new Date().toISOString().slice(0, 10);
    } else parsed = parseUniverseWorkbook(sheets, { kind });

    if (current?.date && parsed.date) {
      if (parsed.date < current.date) parsed.warnings.push(`La fecha de este Excel (${parsed.date}) es anterior a la publicada (${current.date}). ¿Es el archivo correcto?`);
      else if (parsed.date === current.date && kind !== 'list') parsed.warnings.push(`Ya hay datos publicados con la misma fecha (${current.date}); se sustituirán al publicar.`);
    }
    const draft = await store.saveDraft(kind, parsed, { filename: req.file.originalname, actor: actor(req) });
    await audit(actor(req), 'upload', { kind, id: draft.id, filename: req.file.originalname, date: parsed.date });
    res.json({
      draft,
      diff: store.diffData(kind, current?.data, parsed.data),
      current: current ? { id: current.id, date: current.date } : null,
    });
  } catch (e) {
    if (e instanceof ImportError) return res.status(422).json({ error: e.message, details: e.details });
    throw e;
  }
}));

router.get('/versions/:id', wrap(async (req, res) => {
  const v = await store.getVersion(Number(req.params.id));
  if (!v) return bad(res, 'Esa versión no existe.', 404);
  const current = await store.getPublished(v.kind);
  const { data, ...meta } = v;
  res.json({ version: meta, diff: store.diffData(v.kind, current?.data, data), current: current ? { id: current.id, date: current.date } : null });
}));

router.post('/versions/:id/publish', wrap(async (req, res) => {
  const v = await store.publish(Number(req.params.id));
  await audit(actor(req), 'publish', { kind: v.kind, id: v.id, date: v.date });
  res.json({ published: v });
}));

router.delete('/versions/:id', wrap(async (req, res) => {
  const ok = await store.discardDraft(Number(req.params.id));
  if (!ok) return bad(res, 'Solo se pueden descartar borradores sin publicar.', 404);
  res.json({ ok: true });
}));

// ---------- Lista de seguimiento: añadir o quitar un valor suelto ----------

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-$^]{0,9}$/;

router.post('/watchlist/item', wrap(async (req, res) => {
  const kind = req.body?.kind;
  const s = String(req.body?.symbol ?? '').trim().toUpperCase();
  const n = String(req.body?.name ?? '').trim().slice(0, 120);
  if (!['acc', 'etf'].includes(kind)) return bad(res, 'Elige si es una acción o un ETF.');
  if (!SYMBOL_RE.test(s)) return bad(res, 'El símbolo no es válido (letras, números, punto o guion).');
  if (!n) return bad(res, 'Escribe el nombre.');
  const g = kind === 'etf'
    ? normalizeGroup(String(req.body?.sector ?? '').trim().slice(0, 80))
    : String(req.body?.sector ?? '').trim().slice(0, 60) || null;
  const i = kind === 'acc' ? (String(req.body?.industry ?? '').trim().slice(0, 80) || null) : null;
  const hb = !!req.body?.hb;
  let existed = false;
  const v = await store.editList((data) => {
    const idx = data[kind].findIndex((x) => x.s === s);
    const item = { s, n, g: g || null, i, hb };
    if (idx >= 0) { data[kind][idx] = item; existed = true; } else data[kind].push(item);
  }, { actor: actor(req), note: `edición manual: ${existed ? 'cambio' : 'alta'} ${s}` });
  await audit(actor(req), 'watchlist_add', { kind, symbol: s });
  res.json({ ok: true, replaced: existed, published: v });
}));

router.delete('/watchlist/:kind/:symbol', wrap(async (req, res) => {
  const { kind } = req.params;
  const s = String(req.params.symbol).toUpperCase();
  if (!['acc', 'etf'].includes(kind)) return bad(res, 'Tipo no válido.');
  let found = false;
  const v = await store.editList((data) => {
    const before = data[kind].length;
    data[kind] = data[kind].filter((x) => x.s !== s);
    found = data[kind].length < before;
  }, { actor: actor(req), note: `edición manual: baja ${s}` });
  if (!found) return bad(res, `${s} no está en la lista.`, 404);
  await audit(actor(req), 'watchlist_remove', { kind, symbol: s });
  res.json({ ok: true, published: v });
}));

// ---------- Invitados (acceso sin Patreon) ----------

router.get('/guests', wrap(async (_req, res) => {
  const { rows } = await query('SELECT email, level, note, expires_at, created_at FROM guests ORDER BY created_at DESC');
  res.json(rows);
}));

async function refreshByEmail(email) {
  const { rows } = await query('SELECT * FROM users WHERE lower(email) = $1', [email]);
  for (const u of rows) await refreshAccess(u);
}

router.post('/guests', wrap(async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const level = Number(req.body?.level);
  const note = String(req.body?.note ?? '').trim().slice(0, 200) || null;
  const exp = req.body?.expires ? new Date(req.body.expires) : null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 'Escribe el email de la cuenta de Patreon de esa persona.');
  if (![1, 2, 3].includes(level)) return bad(res, 'Elige un nivel (1, 2 o 3).');
  if (exp && Number.isNaN(exp.getTime())) return bad(res, 'La fecha de caducidad no es válida.');
  await query(
    `INSERT INTO guests (email, level, note, expires_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET level = EXCLUDED.level, note = EXCLUDED.note, expires_at = EXCLUDED.expires_at`,
    [email, level, note, exp],
  );
  await refreshByEmail(email);
  await audit(actor(req), 'guest_set', { email, level });
  res.json({ ok: true });
}));

router.delete('/guests/:email', wrap(async (req, res) => {
  const email = String(req.params.email).toLowerCase();
  await query('DELETE FROM guests WHERE email = $1', [email]);
  await refreshByEmail(email);
  await audit(actor(req), 'guest_remove', { email });
  res.json({ ok: true });
}));

// ---------- Personas que han entrado ----------

router.get('/users', wrap(async (req, res) => {
  const q = String(req.query.q ?? '').trim().toLowerCase();
  const { rows } = await query(
    `SELECT id, name, email, tier AS level, tier_source AS source, is_admin, last_login, created_at, checked_at
     FROM users WHERE $1 = '' OR lower(name) LIKE '%' || $1 || '%' OR lower(email) LIKE '%' || $1 || '%'
     ORDER BY last_login DESC NULLS LAST LIMIT 300`,
    [q],
  );
  res.json(rows);
}));

// ---------- Ajustes ----------

async function settingsView() {
  const cid = await campaignId();
  const tiers = (await query(
    'SELECT campaign_id, tier_id, title, amount_cents, last_seen FROM seen_tiers ORDER BY campaign_id, amount_cents NULLS LAST',
  )).rows;
  const tierMap = await getSetting('tier_map');
  return {
    links: await getSetting('links'),
    guideOpen: !!(await getSetting('guide_open')),
    campaignId: cid,
    campaignFromEnv: !!config.patreon.campaignId,
    tiers: tiers.map((t) => ({
      campaignId: t.campaign_id, id: t.tier_id, title: t.title, amountCents: t.amount_cents,
      auto: levelFromTitle(t.title), manual: tierMap[t.tier_id] ?? null,
      ours: !!cid && String(t.campaign_id) === String(cid),
    })),
    webhookConfigured: !!config.patreon.webhookSecret,
    webhookUrl: `${config.baseUrl}/webhooks/patreon`,
  };
}

router.get('/settings', wrap(async (_req, res) => { res.json(await settingsView()); }));

router.put('/settings', wrap(async (req, res) => {
  const b = req.body || {};
  let recompute = false;
  try {
    if ('links' in b) await setSetting('links', cleanLinks(b.links));
  } catch (e) { return bad(res, e.message); }
  if ('guideOpen' in b) { await setSetting('guide_open', !!b.guideOpen); }
  if ('campaignId' in b && !config.patreon.campaignId) {
    const v = String(b.campaignId ?? '').trim();
    if (v && !/^\d{1,20}$/.test(v)) return bad(res, 'El ID de campaña son solo números.');
    await setSetting('campaign_id', v);
    recompute = true;
  }
  if ('tierMap' in b) {
    const map = {};
    for (const [id, lvl] of Object.entries(b.tierMap || {})) {
      if (lvl === null || lvl === '' || lvl === undefined) continue;
      const n = Number(lvl);
      if (!/^\d{1,20}$/.test(id) || ![0, 1, 2, 3].includes(n)) return bad(res, 'Asignación de nivel no válida.');
      map[id] = n;
    }
    await setSetting('tier_map', map);
    recompute = true;
  }
  const out = recompute ? await recomputeAll() : null;
  await audit(actor(req), 'settings', { keys: Object.keys(b), recompute: out });
  res.json({ ok: true, recompute: out, settings: await settingsView() });
}));

router.get('/audit', wrap(async (_req, res) => {
  const { rows } = await query('SELECT at, actor, action, detail FROM audit ORDER BY id DESC LIMIT 60');
  res.json(rows);
}));

export default router;
