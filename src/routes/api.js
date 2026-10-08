import { Router } from 'express';
import { config } from '../config.js';
import { LEVEL_NAMES } from '../access.js';
import { buildBootstrap } from '../bootstrap.js';
import { getSetting } from '../settings.js';
import { recheckIfStale } from '../users.js';
import { destroySession } from '../session.js';

const router = Router();
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

/** Exige sesión y, si toca, vuelve a comprobar con Patreon que la suscripción sigue activa. */
export async function requireUser(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: 'login_required' });
    const fresh = await recheckIfStale(req.user);
    if (!fresh) {
      await destroySession(req, res);
      return res.status(401).json({ error: 'login_required', reason: 'patreon_revoked' });
    }
    req.user = { ...req.user, ...fresh };
    next();
  } catch (e) { next(e); }
}

export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'forbidden' });
  next();
}

router.get('/me', async (req, res, next) => {
  try {
    const base = { patreonUrl: config.patreon.pageUrl, devLogin: config.devLogin };
    if (!req.user) return res.json({ user: null, ...base });
    const fresh = await recheckIfStale(req.user);
    if (!fresh) { await destroySession(req, res); return res.json({ user: null, ...base }); }
    res.json({
      ...base,
      user: {
        name: fresh.name,
        level: fresh.tier,
        levelName: LEVEL_NAMES[fresh.tier],
        isAdmin: !!fresh.is_admin,
        source: fresh.tier_source,
      },
      csrf: req.session.csrf,
      guideOpen: !!(await getSetting('guide_open')),
    });
  } catch (e) { next(e); }
});

router.get('/bootstrap', requireUser, async (req, res, next) => {
  try {
    const data = await buildBootstrap(req.user.tier);
    data.guideOpen = !!(await getSetting('guide_open'));
    res.json(data);
  } catch (e) { next(e); }
});

export default router;
