import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { levelFromTitle, patreonLevel, effectiveAccess, canSee, NEED, isAdminUser } from '../src/access.js';

const tier = (id, title) => ({ id, title, amountCents: 500 });
const ent = (...ms) => ({ memberships: ms });
const mem = (campaignId, patronStatus, ...tiers) => ({ campaignId, patronStatus, tiers });

test('nivel por el nombre del tier', () => {
  assert.equal(levelFromTitle('Estrategia Superior'), 3);
  assert.equal(levelFromTitle('ESTRATEGIA INTERMEDIA'), 2);
  assert.equal(levelFromTitle('Estrategia Esencial'), 1);
  assert.equal(levelFromTitle('Gratis'), 0);
});

test('solo cuenta nuestra campaña y los pagos al día', () => {
  const opts = { campaignId: '10', tierMap: {} };
  assert.equal(patreonLevel(ent(mem('10', 'active_patron', tier('1', 'Esencial'))), opts), 1);
  assert.equal(patreonLevel(ent(mem('99', 'active_patron', tier('1', 'Superior'))), opts), 0);
  assert.equal(patreonLevel(ent(mem('10', 'declined_patron', tier('1', 'Superior'))), opts), 0);
  assert.equal(patreonLevel(ent(mem('10', 'former_patron', tier('1', 'Superior'))), opts), 0);
  assert.equal(patreonLevel(ent(mem('10', 'active_patron', tier('1', 'Esencial'), tier('2', 'Superior'))), opts), 3);
  assert.equal(patreonLevel(null, opts), 0);
  assert.equal(patreonLevel(ent(mem('10', 'active_patron', tier('1', 'Superior'))), { campaignId: '', tierMap: {} }), 0);
});

test('asignación manual de tier sobre el nombre', () => {
  const opts = { campaignId: '10', tierMap: { 7: 2 } };
  assert.equal(patreonLevel(ent(mem('10', 'active_patron', tier('7', 'Plan raro'))), opts), 2);
  assert.equal(patreonLevel(ent(mem('10', 'active_patron', tier('7', 'Estrategia Superior'))), opts), 2);
});

test('invitados, caducidad y administradores', () => {
  const base = { entitlement: null, campaignId: '10', tierMap: {} };
  const future = new Date(Date.now() + 86400e3);
  const past = new Date(Date.now() - 86400e3);
  assert.deepEqual(effectiveAccess({ ...base, guest: { level: 2, expires_at: future } }), { level: 2, source: 'guest' });
  assert.deepEqual(effectiveAccess({ ...base, guest: { level: 2, expires_at: past } }), { level: 0, source: 'none' });
  assert.deepEqual(effectiveAccess({ ...base, guest: { level: 3, expires_at: null } }), { level: 3, source: 'guest' });
  assert.deepEqual(effectiveAccess({ ...base, isAdmin: true }), { level: 4, source: 'admin' });
  const e = ent(mem('10', 'active_patron', tier('1', 'Superior')));
  assert.equal(effectiveAccess({ ...base, entitlement: e, guest: { level: 1 } }).source, 'patreon');
});

test('qué ve cada nivel', () => {
  assert.equal(canSee('etf', 1), true);
  assert.equal(canSee('acc', 1), false);
  assert.equal(canSee('acc', 2), true);
  assert.equal(canSee('rs', 1), false);
  assert.equal(canSee('rs', 2), true);
  assert.equal(canSee('links', 2), false);
  assert.equal(canSee('links', 3), true);
  assert.equal(canSee('etf', 0), false);
  assert.equal(NEED.list, 1);
});

test('administradores por email o id de Patreon', () => {
  const cfg = { adminEmails: ['a@b.com'], adminPatreonIds: ['42'] };
  assert.equal(isAdminUser({ email: 'A@B.com' }, cfg), true);
  assert.equal(isAdminUser({ patreonId: '42' }, cfg), true);
  assert.equal(isAdminUser({ email: 'x@y.com', patreonId: '1' }, cfg), false);
});
