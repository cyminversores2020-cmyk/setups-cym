import { getPool } from './db.js';

// Cada migración se aplica una sola vez, en orden. No se editan las ya publicadas:
// los cambios nuevos van en una migración nueva.
export const MIGRATIONS = [
  {
    id: 1,
    name: 'esquema inicial',
    sql: `
CREATE TABLE users (
  id               bigserial PRIMARY KEY,
  patreon_id       text NOT NULL UNIQUE,
  name             text,
  email            text,
  tier             int  NOT NULL DEFAULT 0,        -- 0 sin acceso, 1 Esencial, 2 Intermedio, 3 Superior
  tier_source      text NOT NULL DEFAULT 'none',   -- patreon | guest | none
  is_admin         boolean NOT NULL DEFAULT false,
  entitlement      jsonb,                          -- lo último que dijo Patreon sobre esta persona
  refresh_token    text,                           -- cifrado (AES-256-GCM)
  checked_at       timestamptz,
  check_lock_until timestamptz,
  last_login       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_email_idx ON users (lower(email));

CREATE TABLE sessions (
  id_hash    text PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE guests (
  email      text PRIMARY KEY,                     -- en minúsculas
  level      int  NOT NULL CHECK (level BETWEEN 1 AND 3),
  note       text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE seen_tiers (
  campaign_id  text NOT NULL,
  tier_id      text NOT NULL,
  title        text,
  amount_cents int,
  last_seen    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, tier_id)
);

CREATE TABLE dataset_versions (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('etf','acc','rs','list')),
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  data_date   date,
  filename    text,
  uploaded_by text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  stats       jsonb,
  warnings    jsonb,
  data        jsonb NOT NULL
);
CREATE INDEX dataset_versions_kind_idx ON dataset_versions (kind, status, uploaded_at DESC);
-- Solo puede haber una versión publicada por conjunto de datos.
CREATE UNIQUE INDEX dataset_versions_one_published ON dataset_versions (kind) WHERE status = 'published';

CREATE TABLE audit (
  id     bigserial PRIMARY KEY,
  at     timestamptz NOT NULL DEFAULT now(),
  actor  text,
  action text NOT NULL,
  detail jsonb
);
`,
  },
];

export async function migrate() {
  const client = await getPool().connect();
  try {
    // Un solo contenedor migra a la vez aunque arranquen varios.
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (id int PRIMARY KEY, name text, applied_at timestamptz NOT NULL DEFAULT now())');
    const { rows } = await client.query('SELECT id FROM schema_migrations');
    const done = new Set(rows.map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [m.id, m.name]);
        await client.query('COMMIT');
        console.log(`[db] migración ${m.id} aplicada: ${m.name}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(727274)'); } catch { /* ignore */ }
    client.release();
  }
}
