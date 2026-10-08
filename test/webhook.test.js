import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifySignature } from '../src/routes/webhook.js';
import { parseWebhookMember } from '../src/patreon.js';

const body = Buffer.from('{"data":{}}');
const mac = crypto.createHmac('md5', 'secreto').update(body).digest('hex');

test('firma del webhook', () => {
  assert.equal(verifySignature(body, mac, 'secreto'), true);
  assert.equal(verifySignature(body, mac.toUpperCase(), 'secreto'), true);
  assert.equal(verifySignature(body, mac, 'otro'), false);
  assert.equal(verifySignature(Buffer.from('{"data":{"x":1}}'), mac, 'secreto'), false);
  assert.equal(verifySignature(body, '', 'secreto'), false);
  assert.equal(verifySignature(body, mac, ''), false);
});

const payload = (status = 'active_patron') => ({
  data: {
    type: 'member', attributes: { patron_status: status },
    relationships: {
      user: { data: { id: '5' } }, campaign: { data: { id: '10' } },
      currently_entitled_tiers: { data: [{ id: '77' }] },
    },
  },
  included: [{ type: 'tier', id: '77', attributes: { title: 'Estrategia Superior', amount_cents: 2000 } }],
});

test('evento de alta o cambio de nivel', () => {
  const m = parseWebhookMember('members:pledge:update', payload());
  assert.deepEqual(m, { userId: '5', campaignId: '10', patronStatus: 'active_patron', deleted: false, tiers: [{ id: '77', title: 'Estrategia Superior', amountCents: 2000 }] });
});

test('evento de baja quita el nivel', () => {
  const m = parseWebhookMember('members:pledge:delete', payload());
  assert.equal(m.deleted, true);
  assert.equal(m.patronStatus, 'former_patron');
  assert.deepEqual(m.tiers, []);
});

test('el título que falta se completa con los tiers ya vistos', () => {
  const p = payload(); p.included = [];
  const m = parseWebhookMember('members:update', p, new Map([['77', { title: 'Estrategia Intermedia', amountCents: 1000 }]]));
  assert.equal(m.tiers[0].title, 'Estrategia Intermedia');
});

test('payload incompleto se ignora', () => {
  assert.equal(parseWebhookMember('members:update', { data: { type: 'member', relationships: {} } }), null);
  assert.equal(parseWebhookMember('members:update', {}), null);
});
