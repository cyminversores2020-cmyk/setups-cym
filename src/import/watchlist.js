// Importador de la lista de seguimiento completa (acciones y ETFs).
//
// Estructura esperada (archivo de CyM, 2026-10-06): una hoja de acciones con símbolo,
// nombre, sector e industria, y una hoja de ETFs en bloques (Índices, Principales
// sectores, Otras áreas de interés, Mundo). Algunos símbolos llevan etiquetas como
// (D,HB): se separan del símbolo y HB se guarda como insignia.
//
// El lector es tolerante: busca la fila de títulos por su texto y, si no la encuentra,
// deduce las columnas. Si no entiende el archivo, dice qué ha visto.

import { text, norm, parseSymbol, isBlockTitle, isoDate } from './clean.js';
import { ImportError } from './signals.js';

const ETF_GROUPS = [
  [/^INDICES?$/, 'Indices'],
  [/^PRINCIPALES SECTORES$/, 'Principales sectores'],
  [/^OTRAS AREAS( DE INTERES)?( EN EL MERCADO)?$/, 'Otras areas de interes en el mercado'],
  [/^(MUNDO|WORLD)$/, 'World'],
];

const SECTOR_ES_EN = {
  FINANCIERO: 'Financial', SERVICIOS: 'Services', TECNOLOGIA: 'Technology', TRANSPORTE: 'Transportation',
  'CONSUMO DEFENSIVO': 'Consumer/Non-Cyclical', SALUD: 'Healthcare', 'BIENES DE CAPITAL': 'Capital Goods',
  'SERVICIOS PUBLICOS': 'Utilities', 'MATERIALES BASICOS': 'Basic Materials', 'CONSUMO CICLICO': 'Consumer Cyclical',
  ENERGIA: 'Energy',
};

export function normalizeGroup(raw) {
  const n = norm(raw);
  for (const [re, name] of ETF_GROUPS) if (re.test(n)) return name;
  return text(raw);
}

function normalizeSector(raw) {
  const s = text(raw);
  if (!s) return null;
  return SECTOR_ES_EN[norm(s)] || s;
}

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i] || [];
    const idx = r.findIndex((v) => /^(SIMBOLO|TICKER|SYMBOL)$/.test(norm(v)));
    if (idx >= 0) {
      const col = { symbol: idx };
      r.forEach((v, j) => {
        const n = norm(v);
        if (/^(NOMBRE|NAME|EMPRESA|COMPANIA)/.test(n)) col.name ??= j;
        else if (/^SECTOR/.test(n)) col.sector ??= j;
        else if (/^INDUSTR/.test(n)) col.industry ??= j;
        else if (/^(CATEGORIA|BLOQUE|GRUPO)/.test(n)) col.group ??= j;
      });
      return { row: i, col };
    }
  }
  return null;
}

function guessColumns(rows) {
  // Sin títulos: la primera fila con un símbolo seguido de texto marca las columnas.
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const r = rows[i] || [];
    for (let j = 0; j < r.length - 1; j++) {
      const sym = parseSymbol(r[j]);
      if (sym && text(r[j]) === text(r[j]).toUpperCase() && text(r[j + 1]) && typeof r[j + 1] === 'string' && !/^\d+$/.test(text(r[j]))) {
        return { row: i - 1, col: { symbol: j, name: j + 1, sector: j + 2, industry: j + 3 } };
      }
    }
  }
  return null;
}

export function parseWatchlistSheet(rows, { label, withIndustry }) {
  const hdr = findHeader(rows) || guessColumns(rows);
  if (!hdr) {
    const seen = rows.slice(0, 5).map((r) => (r || []).filter((v) => v != null).join(' | ')).filter(Boolean);
    throw new ImportError(`No reconozco el formato de la hoja «${label}» de la lista de seguimiento. Primeras filas: ${seen.join(' // ') || '(vacía)'}.`);
  }
  const { col } = hdr;
  const out = [];
  const seen = new Set();
  const warnings = [];
  let group = null;
  for (let i = hdr.row + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const cells = r.map((v, j) => [j, text(v)]).filter(([, v]) => v != null);
    if (!cells.length) continue;
    const symRaw = text(r[col.symbol]);
    const others = cells.filter(([j]) => j !== col.symbol && !/^\d+$/.test(String(r[j])));
    // Fila de título de bloque: un solo texto en la fila, que no es un símbolo.
    if (cells.length <= 2 && isBlockTitle(symRaw ?? cells.at(-1)[1]) && !others.length) { group = normalizeGroup(symRaw ?? cells.at(-1)[1]); continue; }
    if (!symRaw && cells.length === 1 && isBlockTitle(cells[0][1])) { group = normalizeGroup(cells[0][1]); continue; }
    const sym = parseSymbol(symRaw);
    if (!sym) { if (symRaw) warnings.push(`${label}: fila ${i + 1}: «${symRaw}» no es un símbolo válido, se ignora.`); continue; }
    if (seen.has(sym.symbol)) { warnings.push(`${label}: ${sym.symbol} está repetido, se deja la primera aparición.`); continue; }
    seen.add(sym.symbol);
    const item = {
      s: sym.symbol,
      n: text(r[col.name]) ?? sym.symbol,
      g: col.group != null ? normalizeGroup(r[col.group]) : null,
      i: null,
      hb: sym.hb,
    };
    if (withIndustry) {
      item.g = normalizeSector(r[col.sector]);
      item.i = text(r[col.industry]);
    } else if (!item.g) {
      item.g = group;
    }
    if (sym.tags.length) item.tags = sym.tags;
    out.push(item);
  }
  return { rows: out, warnings };
}

export function parseWatchlistWorkbook(sheets) {
  const accSheet = sheets.find((s) => /ACCION|STOCK/.test(norm(s.sheet)));
  const etfSheet = sheets.find((s) => /ETF/.test(norm(s.sheet)));
  if (!accSheet && !etfSheet) {
    throw new ImportError(`No encuentro las hojas de acciones y ETFs. Hojas del archivo: ${sheets.map((s) => s.sheet.trim()).join(', ')}.`);
  }
  const warnings = [];
  const data = { acc: [], etf: [] };
  if (accSheet) {
    const p = parseWatchlistSheet(accSheet.data, { label: accSheet.sheet.trim(), withIndustry: true });
    data.acc = p.rows; warnings.push(...p.warnings);
  } else warnings.push('El archivo no tiene hoja de acciones: se mantienen las acciones actuales.');
  if (etfSheet) {
    const p = parseWatchlistSheet(etfSheet.data, { label: etfSheet.sheet.trim(), withIndustry: false });
    data.etf = p.rows; warnings.push(...p.warnings);
  } else warnings.push('El archivo no tiene hoja de ETFs: se mantienen los ETFs actuales.');
  let date = null;
  for (const s of sheets) for (const r of s.data.slice(0, 15)) for (const v of r || []) date ??= isoDate(v);
  return {
    kind: 'list', date,
    data,
    present: { acc: !!accSheet, etf: !!etfSheet },
    stats: {
      acciones: data.acc.length,
      etfs: data.etf.length,
      bloques_etf: [...new Set(data.etf.map((x) => x.g))].filter(Boolean),
      con_hb: [...data.acc, ...data.etf].filter((x) => x.hb).length,
    },
    warnings,
  };
}
