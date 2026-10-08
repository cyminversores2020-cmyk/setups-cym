// Cliente mínimo de la API v2 de Patreon (OAuth + identidad + membresías).
import { config, redirectUri } from './config.js';

const AUTH_URL = 'https://www.patreon.com/oauth2/authorize';
const TOKEN_URL = 'https://www.patreon.com/api/oauth2/token';
const IDENTITY_URL = 'https://www.patreon.com/api/oauth2/v2/identity';
const UA = 'setups-cym/1.0 (+https://cyminversores.com)';
const SCOPE = 'identity identity[email] identity.memberships';

export class PatreonError extends Error {
  // kind: 'auth' (token no válido o revocado) | 'network' | 'api'
  constructor(message, kind, status) { super(message); this.kind = kind; this.status = status; }
}

export function authorizeUrl(state) {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: config.patreon.clientId,
    redirect_uri: redirectUri(),
    scope: SCOPE,
    state,
  });
  return `${AUTH_URL}?${p}`;
}

async function request(url, init = {}) {
  let res;
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(12000),
    });
  } catch (e) {
    throw new PatreonError(`No se pudo contactar con Patreon: ${e.message}`, 'network');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const kind = res.status === 401 || res.status === 403 || body?.error === 'invalid_grant' ? 'auth' : 'api';
    throw new PatreonError(`Patreon respondió ${res.status}${body?.error ? ` (${body.error})` : ''}`, kind, res.status);
  }
  return body;
}

async function tokenRequest(params) {
  const body = new URLSearchParams({
    ...params,
    client_id: config.patreon.clientId,
    client_secret: config.patreon.clientSecret,
  });
  const t = await request(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!t?.access_token) throw new PatreonError('Patreon no devolvió un token de acceso', 'api');
  return { accessToken: t.access_token, refreshToken: t.refresh_token || null, expiresIn: t.expires_in };
}

export const exchangeCode = (code) =>
  tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });

export const refreshToken = (rt) => tokenRequest({ grant_type: 'refresh_token', refresh_token: rt });

const FIELDS = {
  'fields[user]': 'full_name,email,vanity',
  'fields[member]': 'patron_status,currently_entitled_amount_cents,last_charge_status',
  'fields[tier]': 'title,amount_cents,published',
};

/** Identidad de la persona y sus membresías (todas las campañas a las que pertenece). */
export async function fetchIdentity(accessToken) {
  const auth = { Authorization: `Bearer ${accessToken}` };
  const attempts = [
    'memberships.currently_entitled_tiers,memberships.campaign,campaign',
    'memberships.currently_entitled_tiers,memberships.campaign',
  ];
  let lastErr;
  for (const include of attempts) {
    try {
      const json = await request(`${IDENTITY_URL}?${new URLSearchParams({ include, ...FIELDS })}`, { headers: auth });
      return normalizeIdentity(json);
    } catch (e) {
      lastErr = e;
      if (e.kind !== 'api') throw e;
    }
  }
  throw lastErr;
}

export function normalizeIdentity(json) {
  const data = json?.data;
  if (!data?.id) throw new PatreonError('Respuesta de identidad no válida', 'api');
  const included = json.included || [];
  const tiers = new Map(included.filter((x) => x.type === 'tier').map((t) => [String(t.id), {
    id: String(t.id), title: t.attributes?.title ?? '', amountCents: t.attributes?.amount_cents ?? null,
  }]));
  const memberships = included.filter((x) => x.type === 'member').map((m) => ({
    campaignId: m.relationships?.campaign?.data?.id ? String(m.relationships.campaign.data.id) : null,
    patronStatus: m.attributes?.patron_status ?? null,
    tiers: (m.relationships?.currently_entitled_tiers?.data || [])
      .map((t) => tiers.get(String(t.id)) || { id: String(t.id), title: '', amountCents: null }),
  }));
  return {
    id: String(data.id),
    name: data.attributes?.full_name || data.attributes?.vanity || null,
    email: data.attributes?.email ? String(data.attributes.email).toLowerCase() : null,
    ownedCampaignId: data.relationships?.campaign?.data?.id ? String(data.relationships.campaign.data.id) : null,
    memberships,
  };
}

/**
 * Evento de webhook (members:*) -> { userId, campaignId, patronStatus, tiers, deleted }.
 * Los títulos de tier vienen en `included`; si faltan se completan con los ya vistos.
 */
export function parseWebhookMember(event, payload, knownTiers = new Map()) {
  const m = payload?.data;
  if (!m || m.type !== 'member') return null;
  const included = payload.included || [];
  const byId = new Map(included.filter((x) => x.type === 'tier').map((t) => [String(t.id), t]));
  const tiers = (m.relationships?.currently_entitled_tiers?.data || []).map((t) => {
    const full = byId.get(String(t.id));
    const known = knownTiers.get(String(t.id));
    return {
      id: String(t.id),
      title: full?.attributes?.title ?? known?.title ?? '',
      amountCents: full?.attributes?.amount_cents ?? known?.amountCents ?? null,
    };
  });
  const userId = m.relationships?.user?.data?.id;
  const campaignId = m.relationships?.campaign?.data?.id;
  if (!userId || !campaignId) return null;
  const deleted = /delete$/.test(String(event || ''));
  return {
    userId: String(userId),
    campaignId: String(campaignId),
    patronStatus: deleted ? 'former_patron' : (m.attributes?.patron_status ?? null),
    tiers: deleted ? [] : tiers,
    deleted,
  };
}
