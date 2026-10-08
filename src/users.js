import { config } from './config.js';
import { query, tx } from './db.js';
import { encrypt, decrypt } from './crypto.js';
import { effectiveAccess, isAdminUser } from './access.js';
import { getSetting, setSetting } from './settings.js';
import * as patreon from './patreon.js';

export async function campaignId() {
  return config.patreon.campaignId || (await getSetting('campaign_id')) || '';
}

async function guestFor(email) {
  if (!email) return null;
  const { rows } = await query('SELECT level, expires_at FROM guests WHERE email = $1', [String(email).toLowerCase()]);
  return rows[0] || null;
}

/** Nivel efectivo de una fila de `users` con lo que se sabe ahora mismo. */
export async function computeAccess(user) {
  return effectiveAccess({
    entitlement: user.entitlement,
    guest: await guestFor(user.email),
    isAdmin: isAdminUser({ patreonId: user.patreon_id, email: user.email }, config),
    campaignId: await campaignId(),
    tierMap: await getSetting('tier_map'),
  });
}

/** Recalcula y guarda nivel/administrador de un usuario. Devuelve la fila actualizada. */
export async function refreshAccess(user) {
  const a = await computeAccess(user);
  const isAdmin = a.level === 4;
  const { rows } = await query(
    'UPDATE users SET tier = $2, tier_source = $3, is_admin = $4 WHERE id = $1 RETURNING *',
    [user.id, a.level, a.source, isAdmin],
  );
  return rows[0];
}

export async function recomputeAll() {
  const { rows } = await query('SELECT * FROM users');
  let changed = 0;
  for (const u of rows) {
    const before = `${u.tier}|${u.tier_source}`;
    const after = await refreshAccess(u);
    if (before !== `${after.tier}|${after.tier_source}`) changed++;
  }
  return { users: rows.length, changed };
}

async function rememberTiers(identity, cid) {
  for (const m of identity.memberships) {
    if (!m.campaignId) continue;
    // Si ya sabemos cuál es nuestra campaña, solo guardamos sus tiers.
    if (cid && String(m.campaignId) !== String(cid)) continue;
    for (const t of m.tiers) {
      await query(
        `INSERT INTO seen_tiers (campaign_id, tier_id, title, amount_cents, last_seen)
         VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (campaign_id, tier_id) DO UPDATE
           SET title = EXCLUDED.title, amount_cents = EXCLUDED.amount_cents, last_seen = now()`,
        [m.campaignId, t.id, t.title, t.amountCents],
      );
    }
  }
}

/** Inicio de sesión: crea o actualiza a la persona con lo que dice Patreon. */
export async function upsertFromLogin(identity, refreshTokenPlain) {
  const admin = isAdminUser({ patreonId: identity.id, email: identity.email }, config);
  let cid = await campaignId();
  // La campaña se aprende sola cuando entra la persona que la crea.
  if (!cid && admin && identity.ownedCampaignId) {
    await setSetting('campaign_id', identity.ownedCampaignId);
    cid = identity.ownedCampaignId;
    await audit(identity.email || identity.id, 'campaign_detected', { campaignId: cid });
  }
  await rememberTiers(identity, cid);
  const entitlement = { memberships: identity.memberships };
  const { rows } = await query(
    `INSERT INTO users (patreon_id, name, email, entitlement, refresh_token, checked_at, last_login)
     VALUES ($1,$2,$3,$4,$5,now(),now())
     ON CONFLICT (patreon_id) DO UPDATE SET
       name = EXCLUDED.name, email = EXCLUDED.email, entitlement = EXCLUDED.entitlement,
       refresh_token = COALESCE(EXCLUDED.refresh_token, users.refresh_token),
       checked_at = now(), last_login = now()
     RETURNING *`,
    [identity.id, identity.name, identity.email, JSON.stringify(entitlement),
      refreshTokenPlain ? encrypt(refreshTokenPlain) : null],
  );
  return refreshAccess(rows[0]);
}

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000);

/**
 * Vuelve a preguntar a Patreon si la suscripción sigue activa (como mucho cada
 * `recheckHours`). Devuelve la fila de usuario actualizada o null si ya no hay acceso
 * verificable (token revocado): hay que volver a iniciar sesión.
 */
export async function recheckIfStale(user) {
  if (user.checked_at && new Date(user.checked_at) > hoursAgo(config.recheckHours)) return user;
  if (!user.refresh_token) return user.checked_at && new Date(user.checked_at) > hoursAgo(config.graceHours) ? user : null;
  // Un solo recheck a la vez por persona (los tokens de Patreon rotan).
  const lock = await query(
    `UPDATE users SET check_lock_until = now() + interval '45 seconds'
     WHERE id = $1 AND (check_lock_until IS NULL OR check_lock_until < now()) RETURNING id`,
    [user.id],
  );
  if (!lock.rowCount) return user;
  try {
    const tok = await patreon.refreshToken(decrypt(user.refresh_token));
    const identity = await patreon.fetchIdentity(tok.accessToken);
    await rememberTiers(identity, await campaignId());
    const { rows } = await query(
      `UPDATE users SET entitlement = $2, name = $3, email = COALESCE($4, email),
              refresh_token = COALESCE($5, refresh_token), checked_at = now(), check_lock_until = NULL
       WHERE id = $1 RETURNING *`,
      [user.id, JSON.stringify({ memberships: identity.memberships }), identity.name, identity.email,
        tok.refreshToken ? encrypt(tok.refreshToken) : null],
    );
    return refreshAccess(rows[0]);
  } catch (e) {
    if (e.kind === 'auth') {
      // La persona ha revocado el acceso de la app (o el token caducó del todo).
      await query('UPDATE users SET refresh_token = NULL, check_lock_until = NULL WHERE id = $1', [user.id]);
      await query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
      return null;
    }
    console.error(`[patreon] no se pudo revalidar al usuario ${user.id}: ${e.message}`);
    await query('UPDATE users SET check_lock_until = NULL WHERE id = $1', [user.id]);
    // Patreon no responde: se mantiene el nivel un tiempo (graceHours) y luego se retira.
    if (user.checked_at && new Date(user.checked_at) > hoursAgo(config.graceHours)) return user;
    const { rows } = await query("UPDATE users SET tier = 0, tier_source = 'none' WHERE id = $1 AND NOT is_admin RETURNING *", [user.id]);
    return rows[0] || user;
  }
}

/** Cambio avisado por Patreon (webhook): actualiza la campaña de esa persona. */
export async function applyWebhookMember(m) {
  const { rows } = await query('SELECT * FROM users WHERE patreon_id = $1', [m.userId]);
  if (!rows.length) return { updated: false, reason: 'usuario desconocido' };
  const user = rows[0];
  const memberships = (user.entitlement?.memberships || []).filter((x) => String(x.campaignId) !== m.campaignId);
  memberships.push({ campaignId: m.campaignId, patronStatus: m.patronStatus, tiers: m.tiers });
  const upd = await query(
    'UPDATE users SET entitlement = $2 WHERE id = $1 RETURNING *',
    [user.id, JSON.stringify({ memberships })],
  );
  const after = await refreshAccess(upd.rows[0]);
  if (after.tier === 0) await query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
  return { updated: true, tier: after.tier };
}

export async function audit(actor, action, detail = null) {
  try {
    await query('INSERT INTO audit (actor, action, detail) VALUES ($1,$2,$3)', [actor, action, detail ? JSON.stringify(detail) : null]);
  } catch (e) { console.error('[audit]', e.message); }
}

export { tx };
