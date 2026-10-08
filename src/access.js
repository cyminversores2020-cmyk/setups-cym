import { norm } from './import/clean.js';

export const LEVELS = { none: 0, esencial: 1, intermedio: 2, superior: 3, admin: 4 };
export const LEVEL_NAMES = {
  0: 'Sin suscripción activa',
  1: 'Estrategia Esencial',
  2: 'Estrategia Intermedia',
  3: 'Estrategia Superior',
  4: 'Administrador',
};

// Nivel mínimo para ver cada conjunto de datos. Se comprueba siempre en el servidor.
export const NEED = { etf: 1, acc: 2, rs: 2, list: 1, links: 3, guide: 1 };

export const canSee = (what, level) => level >= NEED[what];

/** Nivel por el nombre del tier de Patreon (por si no hay una asignación manual). */
export function levelFromTitle(title) {
  const n = norm(title);
  if (/SUPERIOR/.test(n)) return 3;
  if (/INTERMED/.test(n)) return 2;
  if (/ESENCIAL/.test(n)) return 1;
  return 0;
}

export function levelForTier(tier, tierMap = {}) {
  const manual = tierMap?.[String(tier.id)];
  if (Number.isInteger(manual) && manual >= 0 && manual <= 3) return manual;
  return levelFromTitle(tier.title);
}

const BAD_STATUS = new Set(['declined_patron', 'former_patron']);

/**
 * Nivel que da Patreon: el más alto entre los tiers a los que tiene derecho en NUESTRA campaña.
 * Pagos fallidos, bajas o suscripciones sin tier activo -> 0.
 * entitlement = { memberships: [{ campaignId, patronStatus, tiers: [{id, title, amountCents}] }] }
 */
export function patreonLevel(entitlement, { campaignId, tierMap }) {
  if (!entitlement?.memberships || !campaignId) return 0;
  let best = 0;
  for (const m of entitlement.memberships) {
    if (String(m.campaignId) !== String(campaignId)) continue;
    if (BAD_STATUS.has(m.patronStatus)) continue;
    for (const t of m.tiers || []) best = Math.max(best, levelForTier(t, tierMap));
  }
  return best;
}

/**
 * Nivel efectivo: administrador > invitado/Patreon (el más alto de los dos).
 * guest = { level, expires_at } o null.
 */
export function effectiveAccess({ entitlement, guest, isAdmin, campaignId, tierMap, now = new Date() }) {
  if (isAdmin) return { level: LEVELS.admin, source: 'admin' };
  const fromPatreon = patreonLevel(entitlement, { campaignId, tierMap });
  const guestOk = guest && (!guest.expires_at || new Date(guest.expires_at) > now);
  const fromGuest = guestOk ? guest.level : 0;
  if (fromGuest > fromPatreon) return { level: fromGuest, source: 'guest' };
  if (fromPatreon > 0) return { level: fromPatreon, source: 'patreon' };
  return { level: 0, source: 'none' };
}

export function isAdminUser({ patreonId, email }, config) {
  if (patreonId && config.adminPatreonIds.includes(String(patreonId))) return true;
  if (email && config.adminEmails.includes(String(email).toLowerCase())) return true;
  return false;
}
