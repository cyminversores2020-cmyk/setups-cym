import crypto from 'node:crypto';
import express, { Router } from 'express';
import { config } from '../config.js';
import { safeEqual } from '../crypto.js';
import { parseWebhookMember } from '../patreon.js';
import { applyWebhookMember, campaignId } from '../users.js';
import { query } from '../db.js';

const router = Router();

// Patreon firma el cuerpo con HMAC-MD5 y el secreto del webhook (cabecera X-Patreon-Signature).
export function verifySignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;
  const mac = crypto.createHmac('md5', secret).update(rawBody).digest('hex');
  return safeEqual(mac, String(signature).trim().toLowerCase());
}

router.post('/webhooks/patreon', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  if (!config.patreon.webhookSecret) return res.status(404).end();
  if (!Buffer.isBuffer(req.body) || !verifySignature(req.body, req.get('x-patreon-signature'), config.patreon.webhookSecret)) {
    return res.status(401).json({ error: 'firma no válida' });
  }
  try {
    const event = req.get('x-patreon-event') || '';
    const payload = JSON.parse(req.body.toString('utf8'));
    const known = new Map((await query('SELECT tier_id, title, amount_cents FROM seen_tiers')).rows
      .map((r) => [r.tier_id, { title: r.title, amountCents: r.amount_cents }]));
    const m = parseWebhookMember(event, payload, known);
    const cid = await campaignId();
    if (!m || (cid && m.campaignId !== String(cid))) return res.json({ ok: true, ignored: true });
    const out = await applyWebhookMember(m);
    res.json({ ok: true, ...out });
  } catch (e) {
    console.error('[webhook] error:', e.message);
    res.status(500).json({ error: 'error interno' });
  }
});

export default router;
