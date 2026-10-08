import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt, sign, unsign, safeEqual, sha256 } from '../src/crypto.js';

test('el token cifrado se descifra y no se ve en claro', () => {
  const blob = encrypt('refresh-token-secreto');
  assert.ok(!blob.includes('secreto'));
  assert.equal(decrypt(blob), 'refresh-token-secreto');
  assert.notEqual(encrypt('x'), encrypt('x'));
});

test('un token manipulado no se descifra', () => {
  const parts = encrypt('hola').split('.');
  parts[3] = Buffer.from('otra-cosa').toString('base64url');
  assert.throws(() => decrypt(parts.join('.')));
  assert.throws(() => decrypt('v2.a.b.c'));
});

test('cookies firmadas', () => {
  const s = sign('valor');
  assert.equal(unsign(s), 'valor');
  assert.equal(unsign(s.replace('valor', 'otro')), null);
  assert.equal(unsign('basura'), null);
});

test('comparación segura y hash', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual(undefined, 'a'), false);
  assert.equal(sha256('a').length, 64);
});
