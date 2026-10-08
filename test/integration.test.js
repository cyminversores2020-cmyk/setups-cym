// Prueba de extremo a extremo contra una base de datos PostgreSQL de PRUEBA (se vacía y se rellena sola).
// Se salta si no hay TEST_DATABASE_URL. Ejemplo:
//   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/setups_test npm test
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

const URL_DB = process.env.TEST_DATABASE_URL;
const skip = URL_DB ? false : 'Define TEST_DATABASE_URL para ejecutar las pruebas con base de datos.';

let server, base, db;

before(async () => {
  if (skip) return;
  Object.assign(process.env, {
    DATABASE_URL: URL_DB, SESSION_SECRET: 'prueba-prueba-prueba-prueba-prueba-12345',
    NODE_ENV: 'test', DEV_LOGIN: 'true', PATREON_CLIENT_ID: 'id', ADMIN_EMAILS: 'admin@example.test',
  });
  db = await import('../src/db.js');
  const { migrate } = await import('../src/migrations.js');
  await migrate();
  for (const t of ['sessions', 'users', 'dataset_versions', 'guests', 'audit']) await db.query(`DELETE FROM ${t}`);
  const store = await import('../src/store.js');
  const { seedWatchlist } = await import('../src/seed.js');
  const row = (s) => ({ s, n: s + ' Inc', g: ['Technology'], p: 10, c: 1, rs: [1, 1, 1, 1] });
  const pub = async (kind, data) => { const d = await store.saveDraft(kind, { date: '2026-10-03', data, stats: {}, warnings: [] }, { filename: 't', actor: 't' }); await store.publish(d.id); };
  const set = (r) => ({ ind: [r], brk: [], reb: [], per: [], short: { ind: [{ s: r.s, g: null }], brk: [], reb: [] } });
  await pub('etf', set(row('SPY')));
  await pub('acc', set(row('AAPL')));
  await pub('rs', { all: [row('NVDA')], top: [row('NVDA')], short: { ind: [], brk: [], reb: [] } });
  await seedWatchlist();
  const { createApp } = await import('../server.js');
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (skip) return;
  await new Promise((r) => server.close(r));
  await db.closePool();
});

async function login(level) {
  const r = await fetch(`${base}/auth/dev?level=${level}`, { redirect: 'manual' });
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const me = await (await fetch(`${base}/api/me`, { headers: { cookie } })).json();
  return { cookie, csrf: me.csrf, me };
}
const get = (path, s) => fetch(base + path, { headers: s ? { cookie: s.cookie } : {} });
const send = (method, path, s, body, headers = {}) => fetch(base + path, {
  method, headers: { cookie: s.cookie, 'content-type': 'application/json', 'x-csrf-token': s.csrf, ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});

test('sin sesión no hay datos', { skip }, async () => {
  assert.equal((await get('/api/bootstrap')).status, 401);
  assert.equal((await get('/api/admin/datasets')).status, 401);
  const me = await (await get('/api/me')).json();
  assert.equal(me.user, null);
});

test('cada nivel recibe solo lo que le corresponde', { skip }, async () => {
  const keys = async (lvl) => { const d = await (await get('/api/bootstrap', await login(lvl))).json(); return d; };
  const d0 = await keys(0);
  assert.equal(d0.u.etf, null); assert.equal(d0.u.acc, null); assert.equal(d0.rs, null); assert.equal(d0.list, null); assert.equal(d0.links, null);
  const d1 = await keys(1);
  assert.ok(d1.u.etf); assert.equal(d1.u.acc, null); assert.equal(d1.rs, null); assert.ok(d1.list); assert.equal(d1.links, null);
  assert.equal(d1.locked.acc, 2);
  assert.ok(!JSON.stringify(d1.u).includes('AAPL'), 'los setups de acciones no deben viajar al nivel 1');
  const d2 = await keys(2);
  assert.ok(d2.u.acc); assert.ok(d2.rs); assert.equal(d2.links, null);
  const d3 = await keys(3);
  assert.ok(Array.isArray(d3.links));
});

test('el panel de administración solo es para administradores', { skip }, async () => {
  const s3 = await login(3);
  assert.equal((await get('/api/admin/datasets', s3)).status, 403);
  assert.equal((await send('POST', '/api/admin/guests', s3, { email: 'a@b.com', level: 1 })).status, 403);
  const s4 = await login(4);
  assert.equal((await get('/api/admin/datasets', s4)).status, 200);
});

test('las peticiones que cambian datos exigen CSRF y origen correcto', { skip }, async () => {
  const s4 = await login(4);
  const body = { email: 'x@example.com', level: 1 };
  assert.equal((await send('POST', '/api/admin/guests', s4, body, { 'x-csrf-token': 'falso' })).status, 403);
  assert.equal((await send('POST', '/api/admin/guests', s4, body, { origin: 'https://malo.example' })).status, 403);
  assert.equal((await send('POST', '/api/admin/guests', s4, body)).status, 200);
});

test('invitado: sube de nivel por email y lo pierde al quitarlo', { skip }, async () => {
  const s4 = await login(4);
  const s1 = await login(1);
  await db.query("UPDATE users SET email = 'invitado@example.com' WHERE patreon_id = 'dev-1'");
  const lvl = async () => (await (await get('/api/bootstrap', s1)).json()).level;
  assert.equal(await lvl(), 1);
  assert.equal((await send('POST', '/api/admin/guests', s4, { email: 'invitado@example.com', level: 2 })).status, 200);
  assert.equal(await lvl(), 2);
  assert.equal((await send('DELETE', '/api/admin/guests/invitado%40example.com', s4)).status, 200);
  assert.equal(await lvl(), 0, 'sin Patreon ni invitación se queda sin acceso');
});

test('añadir y quitar un valor de la lista', { skip }, async () => {
  const s4 = await login(4);
  const add = await send('POST', '/api/admin/watchlist/item', s4, { kind: 'acc', symbol: 'zzzz', name: 'Prueba SA', sector: 'Technology', industry: 'Software' });
  assert.equal(add.status, 200);
  const list = (await (await get('/api/bootstrap', s4)).json()).list.acc;
  assert.ok(list.some((x) => x.s === 'ZZZZ'));
  assert.equal((await send('POST', '/api/admin/watchlist/item', s4, { kind: 'acc', symbol: 'no valido!', name: 'x' })).status, 400);
  assert.equal((await send('DELETE', '/api/admin/watchlist/acc/ZZZZ', s4)).status, 200);
  assert.equal((await send('DELETE', '/api/admin/watchlist/acc/ZZZZ', s4)).status, 404);
});

test('los enlaces de Recursos solo admiten https', { skip }, async () => {
  const s4 = await login(4);
  const bad = await send('PUT', '/api/admin/settings', s4, { links: [{ t: 'x', d: '', u: 'javascript:alert(1)' }] });
  assert.equal(bad.status, 400);
  const ok = await send('PUT', '/api/admin/settings', s4, { links: [{ t: 'Discord', d: 'd', u: 'https://discord.gg/abc' }] });
  assert.equal(ok.status, 200);
  const d3 = await (await get('/api/bootstrap', await login(3))).json();
  assert.equal(d3.links[0].u, 'https://discord.gg/abc');
});

test('cabeceras de seguridad y la web se sirve', { skip }, async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await get('/healthz')).status, 200);
});
