import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { randomToken } from '../crypto.js';
import * as patreon from '../patreon.js';
import { createSession, destroySession, setOauthState, takeOauthState, requireCsrf } from '../session.js';
import { upsertFromLogin, audit } from '../users.js';
import { query } from '../db.js';

const router = Router();
const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

const safeReturn = (p) => (typeof p === 'string' && /^\/[A-Za-z0-9#/_\-.?=&]*$/.test(p) && !p.startsWith('//') ? p : '/');
const fail = (res, code) => res.redirect(`/?login_error=${encodeURIComponent(code)}`);

router.get('/auth/patreon', limiter, (req, res) => {
  if (!config.patreon.clientId) return fail(res, 'config');
  const state = randomToken(24);
  setOauthState(res, state, safeReturn(req.query.next));
  res.redirect(patreon.authorizeUrl(state));
});

router.get('/auth/patreon/callback', limiter, async (req, res) => {
  const saved = takeOauthState(req, res);
  const { code, state, error } = req.query;
  if (error) return fail(res, error === 'access_denied' ? 'denied' : 'patreon');
  if (!saved || !state || saved.state !== state || typeof code !== 'string') return fail(res, 'state');
  try {
    const tok = await patreon.exchangeCode(code);
    const identity = await patreon.fetchIdentity(tok.accessToken);
    const user = await upsertFromLogin(identity, tok.refreshToken);
    await createSession(res, user.id);
    await audit(identity.email || identity.id, 'login', { tier: user.tier, source: user.tier_source });
    res.redirect(saved.returnTo);
  } catch (e) {
    console.error('[auth] fallo en el inicio de sesión:', e.message);
    fail(res, e.kind === 'network' ? 'network' : 'patreon');
  }
});

router.post('/auth/logout', requireCsrf, async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

// Solo para probar en local (DEV_LOGIN=true y fuera de producción).
if (config.devLogin) {
  router.get('/auth/dev', async (req, res) => {
    const level = Math.max(0, Math.min(4, Number(req.query.level ?? 3)));
    const id = `dev-${level}`;
    const { rows } = await query(
      `INSERT INTO users (patreon_id, name, email, tier, tier_source, is_admin, checked_at, last_login)
       VALUES ($1,$2,$3,$4,'dev',$5, now() + interval '100 years', now())
       ON CONFLICT (patreon_id) DO UPDATE SET tier = EXCLUDED.tier, is_admin = EXCLUDED.is_admin,
         checked_at = EXCLUDED.checked_at, last_login = now()
       RETURNING id`,
      [id, `Prueba nivel ${level}`, `${id}@example.test`, Math.min(level, 3), level === 4],
    );
    await createSession(res, rows[0].id);
    res.redirect('/');
  });
}

export default router;
