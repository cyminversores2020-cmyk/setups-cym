// Importador de los Excel semanales de señales (ETFs y sectores, lista base de
// acciones y acciones con RS superior a SPY).
//
// La entrada son las hojas ya leídas: [{ sheet: 'nombre', data: [[celda, ...], ...] }].
// Así la lógica de limpieza se puede probar sin ficheros.

import {
  Counters, num, pct, rsPoints, volume, int, text, norm, parseSymbol,
  looksLikeSymbol, isBlockTitle, isoDate,
} from './clean.js';

// Posición (desde 0) de cada columna en las pestañas de datos.
export const COL = {
  symbol: 1, price: 2, chg: 3, d21: 4, d63: 5, ytd: 6, dsma: 7, smaTag: 8,
  vol: 9, volAvg: 10, macd: 12, macdAvg: 13, hist: 14, xd: 16,
  rsi: 19, up: 20, lo: 21, pch: 22, prevHigh: 23,
  rs10: 25, rs21: 29, rs42: 33, rs63: 37,
  smaOrder: 40, sma10: 41, sma50: 42, sma200: 43, atr: 44, slowK: 45, slowD: 46,
  bbUp: 49, bbLo: 50, bbMid: 51, pb: 52, dy: 53, name: 54,
};

// Texto que debe aparecer en la fila de títulos de cada columna (guarda contra Excel cambiados).
const HEADER_CHECKS = [
  [COL.symbol, /SIMBOLO/, 'Símbolo'],
  [COL.price, /LAST|PRECIO/, 'LAST Precio'],
  [COL.chg, /NET/, 'Net %chg'],
  [COL.d21, /21D/, '21d %'],
  [COL.d63, /63/, '63 d'],
  [COL.vol, /VOLUMEN/, 'VOLUMEN x 1000'],
  [COL.macd, /MACD/, 'MACD'],
  [COL.rsi - 2, /RSI/, 'RSI'],
  [COL.up, /PRICE CHANNEL|CANAL/, 'PRICE CHANNEL 20d'],
  [COL.rs10 - 1, /FUERZA RELATIVA 10/, 'FUERZA RELATIVA 10d'],
  [COL.rs21 - 1, /FUERZA RELATIVA 21/, 'FUERZA RELATIVA 21d'],
  [COL.rs42 - 1, /FUERZA RELATIVA 42/, 'FUERZA RELATIVA 42d'],
  [COL.rs63 - 1, /FUERZA RELATIVA 63/, 'FUERZA RELATIVA 63d'],
  [COL.smaOrder, /SMA/, 'ORDEN DE SMA 50 vs 200'],
  [COL.name, /NOMBRE/, 'Nombre'],
];

export const SHEETS = {
  universe: [
    { key: 'ind', match: 'INDICADORES', label: 'SECTORES INDICADORES' },
    { key: 'brk', match: 'BREAKOUT', label: 'SECTORES BREAKOUT' },
    { key: 'reb', match: 'REBOTE', label: 'SECTORES REBOTE' },
    { key: 'per', match: 'PERFORMANCE', label: 'SECTORES PERFORMANCE 21D Y 63D' },
  ],
  rs: [
    { key: 'all', match: 'LISTA COMPLETA', label: 'Lista completa RS sup SPY' },
    { key: 'top', match: '50 RS', label: '50 RS superior' },
  ],
};

export class ImportError extends Error {
  constructor(message, details) { super(message); this.details = details; }
}

function findSheet(sheets, match, exclude = []) {
  return sheets.find((s) => {
    const n = norm(s.sheet);
    return n.includes(match) && !exclude.some((x) => n.includes(x));
  });
}

function findListaCorta(sheets) {
  return sheets.find((s) => norm(s.sheet).startsWith('LISTA CORTA'));
}

function headerRowIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    if (/^SIMBOLO$/.test(norm(rows[i]?.[COL.symbol]))) return i;
  }
  return -1;
}

function findDate(rows, upTo) {
  for (let i = 0; i < upTo; i++) {
    for (const v of rows[i] || []) { const d = isoDate(v); if (d) return d; }
  }
  return null;
}

const isEmptyRow = (r) => !r || r.every((v) => v == null || v === '');

function buildRow(r, counters, symInfo) {
  const o = {
    s: symInfo.symbol,
    n: cleanName(r[COL.name]),
    g: [],
    p: num(r[COL.price]),
    c: pct(r[COL.chg], counters),
    d21: pct(r[COL.d21], counters),
    d63: pct(r[COL.d63], counters),
    ytd: pct(r[COL.ytd], counters),
    dsma: num(r[COL.dsma]),
    vol: volume(r[COL.vol], counters),
    vavg: volume(r[COL.volAvg], counters),
    macd: num(r[COL.macd]),
    hist: num(r[COL.hist]),
    xd: int(r[COL.xd]),
    rsi: num(r[COL.rsi]),
    up: num(r[COL.up]),
    lo: num(r[COL.lo]),
    pch: pct(r[COL.pch], counters),
    rs: [
      rsPoints(r[COL.rs10], counters), rsPoints(r[COL.rs21], counters),
      rsPoints(r[COL.rs42], counters), rsPoints(r[COL.rs63], counters),
    ],
    sma: text(r[COL.smaOrder]),
    s50: num(r[COL.sma50]),
    s200: num(r[COL.sma200]),
    atr: num(r[COL.atr]),
    k: num(r[COL.slowK]),
    pb: pct(r[COL.pb], counters),
    dy: pct(r[COL.dy], counters),
    hb: symInfo.hb,
    // Campos extra (columnas configurables en escritorio)
    macdAvg: num(r[COL.macdAvg]),
    s10: num(r[COL.sma10]),
    kd: num(r[COL.slowD]),
    bbu: num(r[COL.bbUp]),
    bbl: num(r[COL.bbLo]),
    bbm: num(r[COL.bbMid]),
    ph: num(r[COL.prevHigh]),
  };
  if (symInfo.tags.length) o.tags = symInfo.tags;
  const tag = text(r[COL.smaTag]);
  if (tag) o.smaTag = tag;
  return o;
}

/**
 * Lee una pestaña de datos. Devuelve filas únicas por símbolo (un símbolo puede
 * repetirse en varios bloques/índices: se une y se guardan todos los bloques en `g`).
 */
export function parseDataSheet(rows, { label = 'hoja', withBlocks = true, counters = new Counters(), warnings = [] } = {}) {
  const h = headerRowIndex(rows);
  if (h < 0) {
    throw new ImportError(`En la pestaña «${label}» no encuentro la fila de títulos (columna «Simbolo»).`);
  }
  const titleRow = rows[h] || [];
  const bad = HEADER_CHECKS.filter(([i, re]) => !re.test(norm(titleRow[i])));
  if (bad.length) {
    const list = bad.map(([i, , exp]) => `columna ${colName(i)}: esperaba «${exp}», hay «${text(titleRow[i]) ?? 'vacío'}»`);
    throw new ImportError(`La pestaña «${label}» no tiene las columnas esperadas. ${list.join('; ')}.`, { columns: list });
  }
  const date = findDate(rows, h);
  const out = new Map();
  let block = null;
  let dupes = 0;
  let noData = 0;
  for (let i = h + 2; i < rows.length; i++) {
    const r = rows[i];
    if (isEmptyRow(r)) continue;
    const label1 = text(r[COL.symbol]);
    if (!label1) continue;
    const hasData = r[COL.price] != null && r[COL.price] !== '';
    if (!hasData) {
      const rest = r.some((v, j) => j !== COL.symbol && v != null && v !== '');
      if (!rest && isBlockTitle(label1)) { block = label1; continue; }
      noData++;
      continue;
    }
    const sym = parseSymbol(label1);
    if (!sym) { warnings.push(`${label}: fila ${i + 1}: símbolo no válido «${label1}», se ignora.`); continue; }
    const row = buildRow(r, counters, sym);
    if (row.p == null) { warnings.push(`${label}: ${sym.symbol} sin precio, se ignora.`); continue; }
    const prev = out.get(sym.symbol);
    if (prev) {
      dupes++;
      if (withBlocks && block && !prev.g.includes(block)) prev.g.push(block);
      if (sym.hb) prev.hb = true;
      if (prev.p && Math.abs(row.p / prev.p - 1) > 0.005) {
        warnings.push(`${label}: ${sym.symbol} aparece en varios bloques con precios distintos (${prev.p} y ${row.p}); se usa el primero.`);
      }
      continue;
    }
    if (withBlocks && block) row.g.push(block);
    out.set(sym.symbol, row);
  }
  const rowsOut = [...out.values()];
  for (const r of rowsOut) {
    if (r.vol != null && r.vol > 0 && r.vol < 1000 && (r.vavg ?? 0) >= 100000) {
      warnings.push(`${label}: ${r.s} tiene un volumen de ${r.vol} frente a un promedio de ${r.vavg}; puede ser una coma de miles mal leída. Revísalo.`);
    }
  }
  return { rows: rowsOut, date, duplicates: dupes, withoutData: noData };
}

// La plataforma marca con «NEW» los valores recién añadidos a una lista; no es parte del nombre.
function cleanName(v) {
  const t = text(v);
  return t ? t.replace(/\s+NEW$/, '') : null;
}

function colName(i) {
  let s = ''; let n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * Lista corta: tres columnas de símbolos (B, D, F). Una celda #VALUE! se ignora.
 * Los títulos de grupo (ETFs) llevan minúsculas o espacios; los símbolos no.
 */
export function parseShortList(rows, { warnings = [], grouped = false } = {}) {
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i] || [];
    if ([1, 3, 5].every((c) => /^SIMBOLO$/.test(norm(r[c])))) { h = i; break; }
  }
  if (h < 0) throw new ImportError('En la «Lista corta» no encuentro las tres columnas «Simbolo».');
  const date = findDate(rows, h);
  const cols = { ind: 1, brk: 3, reb: 5 };
  const out = { ind: [], brk: [], reb: [] };
  let dropped = 0;
  for (const [key, c] of Object.entries(cols)) {
    let group = null;
    const seen = new Set();
    for (let i = h + 1; i < rows.length; i++) {
      const raw = text(rows[i]?.[c]);
      if (!raw || raw.startsWith('#')) continue;
      const sym = parseSymbol(raw);
      if (sym && looksLikeSymbol(raw)) {
        if (seen.has(sym.symbol)) { dropped++; continue; }
        seen.add(sym.symbol);
        out[key].push(grouped ? { s: sym.symbol, g: group } : { s: sym.symbol, g: null });
      } else if (grouped) {
        group = raw;
      } else {
        warnings.push(`Lista corta: «${raw}» no parece un símbolo y se ignora.`);
      }
    }
  }
  return { short: out, date, duplicatesDropped: dropped };
}

/** ETFs y sectores / Lista base de acciones. */
export function parseUniverseWorkbook(sheets, { kind }) {
  if (kind !== 'etf' && kind !== 'acc') throw new ImportError('Tipo de carga no válido.');
  const counters = new Counters();
  const warnings = [];
  const missing = [];
  const result = { ind: [], brk: [], reb: [], per: [] };
  const perSheet = {};
  const dates = [];
  let duplicates = 0;
  for (const def of SHEETS.universe) {
    const sh = findSheet(sheets, def.match);
    if (!sh) { missing.push(def.label); continue; }
    const p = parseDataSheet(sh.data, { label: def.label, counters, warnings });
    result[def.key] = p.rows;
    perSheet[def.key] = p.rows.length;
    if (p.date) dates.push(p.date);
    duplicates += p.duplicates;
  }
  if (missing.length) {
    throw new ImportError(
      `Faltan pestañas en el Excel: ${missing.join(', ')}. Pestañas encontradas: ${sheets.map((s) => s.sheet.trim()).join(', ')}.`,
      { missing },
    );
  }
  const lc = findListaCorta(sheets);
  if (!lc) throw new ImportError('Falta la pestaña «Lista corta».');
  const sl = parseShortList(lc.data, { warnings, grouped: kind === 'etf' });
  if (sl.date) dates.push(sl.date);

  const date = pickDate(dates, warnings);
  checkKind(kind, result, warnings);
  // Cada símbolo de la lista corta debe existir en alguna pestaña de datos (aviso, no error).
  const known = new Set(Object.values(result).flat().map((r) => r.s));
  for (const k of ['ind', 'brk', 'reb']) {
    const unk = sl.short[k].filter((x) => !known.has(x.s)).map((x) => x.s);
    if (unk.length) warnings.push(`Lista corta (${k}): ${unk.join(', ')} no aparece en las pestañas de datos.`);
  }
  const total = Object.values(result).reduce((a, b) => a + b.length, 0);
  if (!total) throw new ImportError('El Excel no tiene ninguna fila de datos. ¿Es el archivo correcto?');

  return {
    kind, date,
    data: { ...result, short: sl.short },
    stats: {
      filas: perSheet,
      lista_corta: { ind: sl.short.ind.length, brk: sl.short.brk.length, reb: sl.short.reb.length },
      hb: Object.values(result).flat().filter((r) => r.hb).length,
      duplicados_unidos: duplicates,
      lista_corta_duplicados_quitados: sl.duplicatesDropped,
      conversiones: counters.toJSON(),
    },
    warnings,
  };
}

/** Acciones con RS superior a SPY. */
export function parseRsWorkbook(sheets) {
  const counters = new Counters();
  const warnings = [];
  const out = {};
  const dates = [];
  const missing = [];
  let duplicates = 0;
  for (const def of SHEETS.rs) {
    const sh = findSheet(sheets, def.match);
    if (!sh) { missing.push(def.label); continue; }
    const p = parseDataSheet(sh.data, { label: def.label, withBlocks: false, counters, warnings });
    out[def.key] = p.rows;
    if (p.date) dates.push(p.date);
    duplicates += p.duplicates;
  }
  if (missing.length) {
    throw new ImportError(
      `Faltan pestañas en el Excel: ${missing.join(', ')}. Pestañas encontradas: ${sheets.map((s) => s.sheet.trim()).join(', ')}.`,
      { missing },
    );
  }
  const lc = findListaCorta(sheets);
  let short = { ind: [], brk: [], reb: [] };
  let dropped = 0;
  if (lc) {
    const sl = parseShortList(lc.data, { warnings });
    short = sl.short; dropped = sl.duplicatesDropped;
    if (sl.date) dates.push(sl.date);
  } else {
    warnings.push('No hay pestaña «Lista corta» en el Excel de RS.');
  }
  const date = pickDate(dates, warnings);
  if (!out.all.length) throw new ImportError('La pestaña «Lista completa RS sup SPY» no tiene filas de datos.');
  return {
    kind: 'rs', date,
    data: { all: out.all, top: out.top, short },
    stats: {
      filas: { all: out.all.length, top: out.top.length },
      lista_corta: { ind: short.ind.length, brk: short.brk.length, reb: short.reb.length },
      hb: [...out.all, ...out.top].filter((r) => r.hb).length,
      duplicados_unidos: duplicates,
      lista_corta_duplicados_quitados: dropped,
      conversiones: counters.toJSON(),
    },
    warnings,
  };
}

function pickDate(dates, warnings) {
  const uniq = [...new Set(dates)];
  if (!uniq.length) throw new ImportError('No encuentro la fecha de los datos en el Excel (celda con fecha bajo «OBS:»).');
  if (uniq.length > 1) warnings.push(`Las pestañas tienen fechas distintas (${uniq.sort().join(', ')}). Se usa la más reciente.`);
  return uniq.sort().at(-1);
}

// Aviso si parece que se ha subido el Excel de otro tipo (ETFs frente a acciones).
function checkKind(kind, result, warnings) {
  const groups = new Set(Object.values(result).flat().flatMap((r) => r.g));
  const etfLike = ['Indices', 'World', 'Principales sectores'].some((g) => groups.has(g));
  const accLike = [...groups].some((g) => /INDEX|ARISTOCRATS/.test(String(g).toUpperCase()));
  if (kind === 'acc' && etfLike && !accLike) {
    warnings.push('Este Excel parece de ETFs y sectores, no de la lista base de acciones. Comprueba que has elegido la carga correcta.');
  }
  if (kind === 'etf' && accLike && !etfLike) {
    warnings.push('Este Excel parece de la lista base de acciones, no de ETFs y sectores. Comprueba que has elegido la carga correcta.');
  }
}
