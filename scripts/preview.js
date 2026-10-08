#!/usr/bin/env node
// Prueba una carga desde la terminal, sin servidor ni base de datos:
//   node scripts/preview.js etf|acc|rs|list archivo.xlsx [--json salida.json]
import fs from 'node:fs';
import { readWorkbook } from '../src/import/xlsx.js';
import { parseUniverseWorkbook, parseRsWorkbook } from '../src/import/signals.js';
import { parseWatchlistWorkbook } from '../src/import/watchlist.js';

const [kind, file, flag, out] = process.argv.slice(2);
if (!['etf', 'acc', 'rs', 'list'].includes(kind) || !file) {
  console.error('Uso: node scripts/preview.js etf|acc|rs|list archivo.xlsx [--json salida.json]');
  process.exit(1);
}
try {
  const sheets = await readWorkbook(fs.readFileSync(file));
  const res = kind === 'rs' ? parseRsWorkbook(sheets)
    : kind === 'list' ? parseWatchlistWorkbook(sheets)
      : parseUniverseWorkbook(sheets, { kind });
  console.log(`Fecha de los datos: ${res.date}`);
  console.log(JSON.stringify(res.stats, null, 2));
  if (res.warnings.length) console.log('\nAvisos:\n- ' + res.warnings.join('\n- '));
  if (flag === '--json' && out) { fs.writeFileSync(out, JSON.stringify(res)); console.log(`\nGuardado en ${out}`); }
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  if (e.details) console.error(JSON.stringify(e.details, null, 2));
  process.exit(2);
}
