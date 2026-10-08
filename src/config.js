// Configuración por variables de entorno. Ningún secreto va en el repositorio.
const env = process.env;

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const port = Number(env.PORT || 3000);
const isProd = env.NODE_ENV === 'production';

export const config = {
  isProd,
  port,
  baseUrl: (env.BASE_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  databaseUrl: env.DATABASE_URL || env.SCALINGO_POSTGRESQL_URL || '',
  databaseSsl: /^(1|true|yes)$/i.test(env.DATABASE_SSL || ''),
  sessionSecret: env.SESSION_SECRET || '',
  sessionDays: Number(env.SESSION_DAYS || 30),
  recheckHours: Number(env.RECHECK_HOURS || 12),
  // Si Patreon no responde, se mantiene el nivel anterior este tiempo como máximo.
  graceHours: Number(env.PATREON_GRACE_HOURS || 48),
  patreon: {
    clientId: env.PATREON_CLIENT_ID || '',
    clientSecret: env.PATREON_CLIENT_SECRET || '',
    campaignId: env.PATREON_CAMPAIGN_ID || '',
    webhookSecret: env.PATREON_WEBHOOK_SECRET || '',
    // URL pública de la página de Patreon (para el botón «Ver niveles»).
    pageUrl: env.PATREON_PAGE_URL || 'https://www.patreon.com/',
  },
  adminEmails: list(env.ADMIN_EMAILS).map((s) => s.toLowerCase()),
  adminPatreonIds: list(env.ADMIN_PATREON_IDS),
  // Solo para probar en local sin Patreon. Nunca se activa en producción.
  devLogin: !isProd && /^(1|true|yes)$/i.test(env.DEV_LOGIN || ''),
  seedWatchlist: !/^(0|false|no)$/i.test(env.SEED_WATCHLIST || 'true'),
};

export function assertConfig() {
  const problems = [];
  if (!config.databaseUrl) problems.push('Falta DATABASE_URL (o SCALINGO_POSTGRESQL_URL).');
  if (!config.sessionSecret || config.sessionSecret.length < 32) {
    problems.push('SESSION_SECRET debe tener al menos 32 caracteres.');
  }
  if (isProd) {
    if (!config.baseUrl.startsWith('https://')) problems.push('BASE_URL debe empezar por https:// en producción.');
    if (!config.patreon.clientId) problems.push('Falta PATREON_CLIENT_ID.');
    if (!config.patreon.clientSecret) problems.push('Falta PATREON_CLIENT_SECRET.');
    if (!config.adminEmails.length && !config.adminPatreonIds.length) {
      problems.push('Define ADMIN_EMAILS o ADMIN_PATREON_IDS para poder entrar al panel de administración.');
    }
  }
  if (problems.length) {
    throw new Error('Configuración incompleta:\n- ' + problems.join('\n- '));
  }
}

export const redirectUri = () => `${config.baseUrl}/auth/patreon/callback`;
