import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { config, assertConfig } from './src/config.js';
import { query, closePool } from './src/db.js';
import { migrate } from './src/migrations.js';
import { loadSession, requireCsrf, purgeExpiredSessions } from './src/session.js';
import { seedWatchlist } from './src/seed.js';
import authRoutes from './src/routes/auth.js';
import apiRoutes from './src/routes/api.js';
import adminRoutes from './src/routes/admin.js';
import webhookRoutes from './src/routes/webhook.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, 'public');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Scalingo termina HTTPS delante de la app

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"], // estilos en línea (barras de RSI); los scripts siguen cerrados
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        ...(config.isProd ? { 'upgrade-insecure-requests': [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));
  app.use(compression());

  app.get('/healthz', async (_req, res) => {
    try { await query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
  });

  // El webhook necesita el cuerpo sin tocar (para comprobar la firma): va antes del JSON.
  app.use(webhookRoutes);

  app.use(express.json({ limit: '300kb' }));
  app.use(loadSession);
  app.use(authRoutes);
  app.use('/api', requireCsrf, apiRoutes);
  app.use('/api/admin', requireCsrf, adminRoutes);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

  app.use(express.static(publicDir, {
    index: false,
    setHeaders(res, file) {
      if (/\.(woff2?|png|svg|ico)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      else res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.get(/^\/(?!api\/|auth\/|webhooks\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(`[error] ${req.method} ${req.path}:`, err);
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'El archivo es demasiado grande (máximo 15 MB).' });
    if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
      return res.status(status).json({ error: status >= 500 ? 'Error interno. Inténtalo de nuevo en un momento.' : err.message });
    }
    res.status(status).send('Error');
  });
  return app;
}

async function main() {
  assertConfig();
  await migrate();
  await seedWatchlist();
  const app = createApp();
  const server = app.listen(config.port, () => console.log(`[web] escuchando en el puerto ${config.port} (${config.baseUrl})`));
  const timer = setInterval(() => purgeExpiredSessions().catch(() => {}), 3600 * 1000);
  timer.unref();
  const stop = (sig) => {
    console.log(`[web] ${sig} recibido, cerrando`);
    server.close(() => closePool().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
