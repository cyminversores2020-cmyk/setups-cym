import { query } from './db.js';

const cache = new Map();
const TTL_MS = 5000;

export const DEFAULT_LINKS = [
  { t: 'Operaciones en vivo', d: 'Aviso cada vez que abrimos o cerramos una posición de la cartera de trading.', u: '' },
  { t: 'Reporte diario de stop-loss', d: 'Si una posición salta por stop, se notifica al final del día.', u: '' },
  { t: 'Plan de trading para acciones', d: 'Metodología completa: qué comprar, cuándo entrar y salir y cuánto invertir.', u: '' },
];

const DEFAULTS = {
  links: DEFAULT_LINKS,
  guide_open: false,   // ¿pueden ver la Guía las personas con cuenta de Patreon pero sin suscripción de pago?
  tier_map: {},        // { "<id de tier de Patreon>": 0..3 } (si no, se deduce del nombre)
  campaign_id: '',
};

export async function getSetting(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const { rows } = await query('SELECT value FROM settings WHERE key = $1', [key]);
  const value = rows.length ? rows[0].value : DEFAULTS[key];
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function setSetting(key, value) {
  await query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, JSON.stringify(value)],
  );
  cache.set(key, { at: Date.now(), value });
}

export const clearSettingsCache = () => cache.clear();

/** Un enlace de Recursos solo puede ser https:// (nunca javascript: ni data:). */
export function cleanLinks(input) {
  if (!Array.isArray(input)) throw new Error('Los enlaces deben ser una lista.');
  return input.slice(0, 12).map((l, i) => {
    const t = String(l?.t ?? '').trim().slice(0, 120);
    const d = String(l?.d ?? '').trim().slice(0, 300);
    let u = String(l?.u ?? '').trim();
    if (u) {
      let parsed;
      try { parsed = new URL(u); } catch { throw new Error(`El enlace «${t || i + 1}» no es una dirección válida.`); }
      if (parsed.protocol !== 'https:') throw new Error(`El enlace «${t || i + 1}» debe empezar por https://`);
      u = parsed.toString();
    }
    if (!t) throw new Error(`El enlace ${i + 1} necesita un título.`);
    return { t, d, u };
  });
}
