import pg from 'pg';
import { config } from './config.js';

// Las columnas DATE se devuelven como texto «YYYY-MM-DD» (sin conversiones de zona horaria).
pg.types.setTypeParser(1082, (v) => v);

let pool;

function connectionOptions() {
  let url = config.databaseUrl;
  let ssl = config.databaseSsl;
  try {
    const u = new URL(url);
    const mode = u.searchParams.get('sslmode');
    if (mode && mode !== 'disable') ssl = true;
    // pg interpreta sslmode por su cuenta; lo gestionamos nosotros.
    u.searchParams.delete('sslmode');
    url = u.toString();
  } catch { /* URL no estándar: se usa tal cual */ }
  return { connectionString: url, ssl: ssl ? { rejectUnauthorized: false } : undefined, max: 8, idleTimeoutMillis: 30000 };
}

export function getPool() {
  if (!pool) {
    pool = new pg.Pool(connectionOptions());
    pool.on('error', (e) => console.error('[db] error en conexión inactiva:', e.message));
  }
  return pool;
}

export const query = (text, params) => getPool().query(text, params);

/** Ejecuta fn dentro de una transacción. */
export async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ya cerrada */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) { await pool.end(); pool = undefined; }
}
