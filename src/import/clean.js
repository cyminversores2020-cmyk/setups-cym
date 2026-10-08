// Limpieza de valores de los Excel.
//
// Origen del problema: la plataforma y el scanner entregan los números en formato
// americano (punto decimal, coma de miles) y el Excel se abre en español. Al abrirlo,
// algunas celdas se interpretan mal. Estas son las reglas (confirmadas por CyM):
//
//  1) Fuerza relativa: +5,393 llega como 5393 (entero). Los enteros se dividen entre
//     1000. Los textos con decimal (p. ej. "-0.670") ya están bien.
//  2) Volumen < 1 millón: 887,173 llega como 887.173 (decimal). Si es decimal se
//     multiplica por 1000. Los textos ("10,009,277") se leen quitando las comas.
//  3) Porcentajes: algunas celdas son porcentaje nativo de Excel (-0,0866 = -8,66 %).
//     Si es un número (no texto), se multiplica por 100. Los textos ("4.44%") se leen tal cual.
//  4) El resto de columnas llegan como texto en formato americano y se leen bien.

export class Counters {
  constructor() { this.c = {}; }
  add(key, n = 1) { this.c[key] = (this.c[key] || 0) + n; }
  get(key) { return this.c[key] || 0; }
  toJSON() { return { ...this.c }; }
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v, d) => { const f = 10 ** d; return Math.round(v * f) / f; };

/** Texto en formato americano -> número, o null si no es un número. */
export function parseUsText(s) {
  if (typeof s !== 'string') return null;
  let t = s.trim().replace(/ /g, '');
  if (!t || t === '-' || t === '–' || t.startsWith('#')) return null;
  t = t.replace(/,/g, '').replace(/%$/, '').replace(/^\+/, '');
  if (!/^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(t) && !/^-?\d+\.$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Número genérico (precio, MACD, RSI, medias...). */
export function num(v) {
  if (isNum(v)) return v;
  return parseUsText(v);
}

/** Porcentaje en puntos (4.44 = 4,44 %). Número nativo de Excel -> x100. */
export function pct(v, counters) {
  if (isNum(v)) {
    counters?.add('porcentaje_nativo');
    return round(v * 100, 4);
  }
  return parseUsText(v);
}

/** Fuerza relativa en puntos porcentuales. Enteros -> entre 1000. */
export function rsPoints(v, counters) {
  if (isNum(v)) {
    if (Number.isInteger(v) && v !== 0) {
      counters?.add('rs_entero');
      return v / 1000;
    }
    return v;
  }
  if (typeof v === 'string') {
    const t = v.trim().replace(/^\+/, '');
    if (/^-?\d+$/.test(t) && t !== '0') {
      // Texto sin decimales: lo que llegó fue un entero con los decimales perdidos.
      counters?.add('rs_entero');
      return Number(t) / 1000;
    }
    return parseUsText(v);
  }
  return null;
}

/** Volumen en acciones. Decimales -> x1000. Texto -> sin comas. */
export function volume(v, counters) {
  if (isNum(v)) {
    if (!Number.isInteger(v)) {
      counters?.add('volumen_decimal');
      return Math.round(v * 1000);
    }
    return v;
  }
  return parseUsText(v);
}

export function int(v) {
  const n = num(v);
  return n == null ? null : Math.round(n);
}

export function text(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Quita acentos y pasa a mayúsculas, para comparar nombres de pestañas. */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ,.&/-]/g, ' ')
    .replace(/\s+/g, ' ').trim().toUpperCase();
}

const TICKER = /^[$^]?[A-Z0-9][A-Z0-9.\-&]*$/;

/** "AEHR(HB)" -> {symbol:"AEHR", hb:true, tags:[]}; "(D,HB)" también. */
export function parseSymbol(raw) {
  const s = text(raw);
  if (!s) return null;
  const m = /^([^()\s]+)\s*(?:\(([^)]*)\))?$/.exec(s.replace(/ /g, ' '));
  if (!m) return null;
  const symbol = m[1].toUpperCase();
  if (!TICKER.test(symbol)) return null;
  const labels = (m[2] || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
  return { symbol, hb: labels.includes('HB'), tags: labels.filter((x) => x !== 'HB') };
}

/** ¿Parece un símbolo (y no un título de bloque)? */
export function looksLikeSymbol(raw) {
  const s = text(raw);
  if (!s || s !== s.toUpperCase()) return false;
  const p = parseSymbol(s);
  return !!p && p.symbol.length <= 8;
}

/**
 * ¿Es el título de un bloque («SP 100 INDEX», «Indices», «AIRLINES»)? Los símbolos son
 * cortos, en mayúsculas y sin espacios; los títulos llevan minúsculas, espacios o son largos.
 */
export function isBlockTitle(raw) {
  const s = text(raw);
  if (!s) return false;
  return s !== s.toUpperCase() || /\s/.test(s) || s.length > 6;
}

/** Fecha de una celda (Excel la entrega a medianoche UTC) -> "YYYY-MM-DD". */
export function isoDate(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return null;
}
