import crypto from 'node:crypto';
import { config } from './config.js';

let key;
const getKey = () => (key ??= crypto.hkdfSync('sha256', config.sessionSecret, 'setups-cym', 'token-encryption', 32));

/** Cifra un texto (AES-256-GCM). Se usa para el token de renovación de Patreon. */
export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(getKey()), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(blob) {
  const [v, iv, tag, ct] = String(blob).split('.');
  if (v !== 'v1') throw new Error('Formato de token no válido');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(getKey()), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Firma HMAC para cookies de corta duración (estado de OAuth). */
export function sign(value) {
  const mac = crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
  return `${value}.${mac}`;
}

export function unsign(signed) {
  const i = String(signed ?? '').lastIndexOf('.');
  if (i < 0) return null;
  const value = signed.slice(0, i);
  return safeEqual(sign(value), signed) ? value : null;
}
