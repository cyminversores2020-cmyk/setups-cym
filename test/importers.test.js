import test from 'node:test';
import assert from 'node:assert/strict';
import { parseShortList } from '../src/import/signals.js';
import { parseWatchlistSheet, parseWatchlistWorkbook, normalizeGroup } from '../src/import/watchlist.js';

test('lista corta de acciones: ignora #VALUE! y quita repetidos', () => {
  const rows = [
    [], ['OBS:', null, null, null, null, null], [null, 'Simbolo', null, 'Simbolo', null, 'Simbolo'],
    [null, 'AAPL', null, 'MSFT', null, 'AAPL(HB)'],
    [null, 'AAPL', null, '#VALUE!', null, null],
    [null, 'NVDA', null, 'MSFT', null, null],
  ];
  const warnings = [];
  const r = parseShortList(rows, { warnings });
  assert.deepEqual(r.short.ind.map((x) => x.s), ['AAPL', 'NVDA']);
  assert.deepEqual(r.short.brk.map((x) => x.s), ['MSFT']);
  assert.deepEqual(r.short.reb.map((x) => x.s), ['AAPL']);
  assert.equal(r.duplicatesDropped, 2);
});

test('lista corta de ETFs: conserva el grupo', () => {
  const rows = [
    [null, 'Simbolo', null, 'Simbolo', null, 'Simbolo'],
    [null, 'Indices', null, 'Indices', null, null],
    [null, 'SPY', null, 'QQQ', null, null],
    [null, 'World', null, null, null, null],
    [null, 'EWJ', null, null, null, null],
  ];
  const r = parseShortList(rows, { grouped: true });
  assert.deepEqual(r.short.ind, [{ s: 'SPY', g: 'Indices' }, { s: 'EWJ', g: 'World' }]);
  assert.deepEqual(r.short.brk, [{ s: 'QQQ', g: 'Indices' }]);
});

test('lista de seguimiento de acciones con cabecera', () => {
  const rows = [
    ['Símbolo', 'Nombre', 'Sector', 'Industria'],
    ['AXON', 'Axon Enterprise Inc', 'Bienes de capital', 'Aerospace & Defense'],
    ['AEHR(HB)', 'Aehr Test Systems', 'Technology', 'Semiconductors'],
    ['AXON', 'Repetida', 'Technology', 'X'],
  ];
  const r = parseWatchlistSheet(rows, { label: 'Acciones', withIndustry: true });
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0], { s: 'AXON', n: 'Axon Enterprise Inc', g: 'Capital Goods', i: 'Aerospace & Defense', hb: false });
  assert.equal(r.rows[1].hb, true);
  assert.ok(r.warnings.some((w) => /repetido/.test(w)));
});

test('lista de seguimiento de ETFs con títulos de bloque', () => {
  const rows = [
    ['Símbolo', 'Nombre'],
    ['Indices'],
    ['SPY', 'State Street SPDR S&P 500 ETF'],
    ['Principales sectores'],
    ['XLK', 'S&P Sel Tech Spdr Fd'],
    ['World'],
    ['EWJ', 'iShs MSCI Japan ETF'],
  ];
  const r = parseWatchlistSheet(rows, { label: 'ETFs', withIndustry: false });
  assert.deepEqual(r.rows.map((x) => [x.s, x.g]), [['SPY', 'Indices'], ['XLK', 'Principales sectores'], ['EWJ', 'World']]);
});

test('el libro necesita al menos una hoja reconocible', () => {
  assert.throws(() => parseWatchlistWorkbook([{ sheet: 'Otra', data: [] }]), /No encuentro las hojas/);
  const r = parseWatchlistWorkbook([{ sheet: 'Acciones', data: [['Símbolo', 'Nombre', 'Sector', 'Industria'], ['AAPL', 'Apple Inc', 'Technology', 'Computers']] }]);
  assert.equal(r.present.acc, true);
  assert.equal(r.present.etf, false);
  assert.equal(r.data.acc.length, 1);
});

test('nombres de grupo de ETFs', () => {
  assert.equal(normalizeGroup('indices'), 'Indices');
});
