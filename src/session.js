import { config } from './config.js';
import { query } from './db.js';
import { randomToken, sha256, safeEqual, sign, unsign } from './crypto.js';

const COOKIE = config.isProd ? '__Host-sid' : 'sid';
const OAUTH_COOKIE = config.isProd ? '__Host-oauth' : 'oauth';

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* cookie malformada */ }
  }
  return out;
}

const baseCookie = () => ({ httpOnly: true, secure: config.isProd, sameSite: 'lax', path: '/' });

export async function createSession(res, userId) {
  const token = randomToken(32);
  const csrf = randomToken(16);
  const maxAge = config.sessionDays * 24 * 3600;
  await query(
    `INSERT INTO sessions (id_hash, user_id, csrf, expires_at)
     VALUES ($1,$2,$3, now() + make_interval(secs => $4))`,
    [sha256(token), userId, csrf, maxAge],
  );
  res.cookie(COOKIE, token, { ...baseCookie(), maxAge: maxAge * 1000 });
  return { csrf };
}

export async function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) await query('DELETE FROM sessions WHERE id_hash = $1', [sha256(token)]);
  res.clearCookie(COOKIE, baseCookie());
}

/** Carga la sesión (si existe) en req.session y req.user. No rechaza a nadie. */
export async function loadSession(req, _res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const { rows } = await query(
        `SELECT s.id_hash, s.csrf, s.last_seen, u.*
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id_hash = $1 AND s.expires_at > now()`,
        [sha256(token)],
      );
      if (rows.length) {
        const { id_hash: idHash, csrf, last_seen: lastSeen, ...user } = rows[0];
        req.user = user;
        req.session = { idHash, csrf };
        if (Date.now() - new Date(lastSeen).getTime() > 3600 * 1000) {
          query('UPDATE sessions SET last_seen = now() WHERE id_hash = $1', [idHash]).catch(() => {});
        }
      }
    }
    next();
  } catch (e) { next(e); }
}

export function purgeExpiredSessions() {
  return query('DELETE FROM sessions WHERE expires_at < now()');
}

/** Protección CSRF: las peticiones que cambian algo deben llevar el token de la sesión. */
export function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.session) return res.status(401).json({ error: 'login_required' });
  const origin = req.get('origin');
  if (origin && origin !== config.baseUrl) return res.status(403).json({ error: 'origin_not_allowed' });
  if (!safeEqual(req.get('x-csrf-token'), req.session.csrf)) return res.status(403).json({ error: 'csrf' });
  next();
}

// Estado del inicio de sesión con Patreon: cookie firmada de 10 minutos.
export function setOauthState(res, state, returnTo = '/') {
  res.cookie(OAUTH_COOKIE, sign(`${state}|${returnTo}`), { ...baseCookie(), maxAge: 10 * 60 * 1000 });
}

export function takeOauthState(req, res) {
  const raw = parseCookies(req.headers.cookie)[OAUTH_COOKIE];
  res.clearCookie(OAUTH_COOKIE, baseCookie());
  const v = unsign(raw);
  if (!v) return null;
  const [state, returnTo] = v.split('|');
  return { state, returnTo: returnTo || '/' };
}
