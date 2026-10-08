import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUsText, num, pct, rsPoints, volume, parseSymbol, looksLikeSymbol, isBlockTitle, norm, Counters } from '../src/import/clean.js';

test('texto en formato americano', () => {
  assert.equal(parseUsText('10,009,277'), 10009277);
  assert.equal(parseUsText('4.44%'), 4.44);
  assert.equal(parseUsText('+5.393'), 5.393);
  assert.equal(parseUsText('-1,234.5'), -1234.5);
  assert.equal(parseUsText('#VALUE!'), null);
  assert.equal(parseUsText(''), null);
  assert.equal(parseUsText('abc'), null);
});

test('números genéricos y celdas vacías', () => {
  assert.equal(num(12.5), 12.5);
  assert.equal(num('12.5'), 12.5);
  assert.equal(num(null), null);
});

test('porcentaje nativo de Excel se multiplica por 100; el texto no', () => {
  const c = new Counters();
  assert.equal(pct(-0.0866, c), -8.66);
  assert.equal(pct('4.44%', c), 4.44);
  assert.equal(c.get('porcentaje_nativo'), 1);
});

test('fuerza relativa: los enteros llegan multiplicados por 1000', () => {
  const c = new Counters();
  assert.equal(rsPoints(5393, c), 5.393);
  assert.equal(rsPoints(-2855, c), -2.855);
  assert.equal(rsPoints(0, c), 0);
  assert.equal(rsPoints(5.393, c), 5.393);
  assert.equal(rsPoints('+4341', c), 4.341);
  assert.equal(rsPoints('+5.393', c), 5.393);
  assert.equal(c.get('rs_entero'), 3);
});

test('volumen: los decimales llegan divididos entre 1000', () => {
  const c = new Counters();
  assert.equal(volume(887.173, c), 887173);
  assert.equal(volume(46223217, c), 46223217);
  assert.equal(volume('10,009,277', c), 10009277);
  assert.equal(c.get('volumen_decimal'), 1);
});

test('símbolos con etiquetas', () => {
  assert.deepEqual(parseSymbol('AEHR(HB)'), { symbol: 'AEHR', hb: true, tags: [] });
  assert.deepEqual(parseSymbol('XYZ (D,HB)'), { symbol: 'XYZ', hb: true, tags: ['D'] });
  assert.deepEqual(parseSymbol('SPY'), { symbol: 'SPY', hb: false, tags: [] });
  assert.deepEqual(parseSymbol('$VIX.X'), { symbol: '$VIX.X', hb: false, tags: [] });
  assert.equal(parseSymbol('hola mundo'), null);
  assert.equal(parseSymbol(''), null);
});

test('símbolo frente a título de bloque', () => {
  assert.equal(looksLikeSymbol('QQQ'), true);
  assert.equal(looksLikeSymbol('World'), false);
  assert.equal(isBlockTitle('World'), true);
  assert.equal(isBlockTitle('SP 100 INDEX'), true);
  assert.equal(isBlockTitle('AIRLINES'), true);
  assert.equal(isBlockTitle('AAPL'), false);
});

test('norm quita acentos y símbolos raros', () => {
  assert.equal(norm('📋 GUÍA DE USO'), 'GUIA DE USO');
  assert.equal(norm('Símbolo'), 'SIMBOLO');
});
