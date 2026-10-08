import { api, setCsrf, ApiError } from '/api.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- constantes de texto ---------- */
const PAGES = [['guia', 'Guía de uso'], ['corta', 'Lista corta'], ['ind', 'Indicadores'], ['brk', 'Breakout'], ['reb', 'Rebote'], ['per', 'Performance 21d/63d'], ['rs', 'Top fuerza relativa'], ['listas', 'Listas de seguimiento'], ['recursos', 'Recursos'], ['admin', 'Administración']];
const LEVEL_NAMES = { 0: 'Sin suscripción activa', 1: 'Estrategia Esencial', 2: 'Estrategia Intermedia', 3: 'Estrategia Superior', 4: 'Administrador' };
const GN = { 'Indices': 'Índices', 'Principales sectores': 'Principales sectores', 'Otras areas de interes en el mercado': 'Otras áreas de interés', 'World': 'Mundo',
  'SP 100 INDEX': 'S&P 100', 'DIVIDEND ARISTOCRATS': 'Dividend Aristocrats', 'NASDAQ 100 INDEX': 'Nasdaq 100', 'DJI IND INDEX': 'Dow Jones',
  'CASINO &GAMING': 'Casinos y juego', 'RESTAURANTS': 'Restaurantes', 'AIRLINES': 'Aerolíneas', 'INSURANCE - ACCIDENT AND HEALTH': 'Seguros: accidentes y salud',
  'INSURANCE - LIFE': 'Seguros: vida', 'INSURANCE - MISCELANEOUS': 'Seguros: varios', 'INSURANCE - PROP. & CASUALTY': 'Seguros: propiedad y daños', 'WATER TRANSPORTATION': 'Transporte marítimo' };
const SEC = { 'Financial': 'Financiero', 'Services': 'Servicios', 'Technology': 'Tecnología', 'Transportation': 'Transporte', 'Consumer/Non-Cyclical': 'Consumo defensivo', 'Healthcare': 'Salud', 'Capital Goods': 'Bienes de capital', 'Utilities': 'Servicios públicos', 'Basic Materials': 'Materiales básicos', 'Consumer Cyclical': 'Consumo cíclico', 'Energy': 'Energía' };
const gn = (g) => GN[g] || SEC[g] || g;
const TVMAP = { '$VIX.X': 'CBOE:VIX', '$NDX.X': 'NASDAQ:NDX', '$SPX.X': 'SP:SPX', '$DJI.X': 'DJ:DJI' };
const tvUrl = (s) => 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(TVMAP[s] || s.replace(/^\$/, '').replace(/\.X$/, '')) + '&interval=D';
const tvBtn = (s) => `<a class="btn" style="margin-top:12px" href="${tvUrl(s)}" target="_blank" rel="noopener">Ver gráfico diario en TradingView</a>`;
const HBT = 'Hard to Borrow: no se puede abrir corto directamente en la plataforma; hay que negociar la tarifa con el broker';
const fmtDate = (d) => { if (!d) return '–'; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${y}`; };

/* ---------- estado ---------- */
let ME = null;        // { name, level, levelName, isAdmin }
let D = null;         // lo que devuelve /api/bootstrap
let ENV = { patreonUrl: '', devLogin: false };
let loadedAt = 0;
const S = { lf: { acc: { q: '', g: '', i: '', sg: false }, etf: { q: '', g: '', i: '', sg: false } }, page: 'guia', uni: 'acc', rsv: 'top', f: {}, sort: {} };
const PAGE_IDS = PAGES.map((p) => p[0]);
try { const h = location.hash.slice(1); if (PAGE_IDS.includes(h)) S.page = h; } catch { /* sin hash */ }

/* ---------- formato ---------- */
const nf = (v, d = 2) => v == null ? '–' : v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }).replace('-', '−');
const pct = (v, d = 2) => v == null ? '–' : (v > 0 ? '+' : '') + nf(v, d) + ' %';
const cls = (v) => v == null ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '';
const big = (v) => v == null ? '–' : v >= 1e6 ? nf(v / 1e6, 1) + ' M' : v >= 1e3 ? nf(v / 1e3, 0) + ' k' : nf(v, 0);
const dist = (r) => r.s50 ? ((r.p / r.s50 - 1) * 100) : null;
const vr = (r) => r.vavg ? r.vol / r.vavg : null;
const pp = (v) => v == null ? '–' : (v > 0 ? '+' : '') + nf(v, 2);
const rsPos = (r) => (r.rs || []).filter((x) => x != null && x > 0).length;
const rsRow = (r) => {
  if (!r.rs || r.rs.every((x) => x == null)) return '';
  const n = rsPos(r);
  return `<div class="r4"><div class="r4h"><span>RS vs SPY · pp</span><span class="dots" title="${n} de 4 plazos con RS positiva">${'●'.repeat(n)}${'○'.repeat(4 - n)}</span></div><div class="r4g">${[10, 21, 42, 63].map((d, i) => `<div class="st"><small>${d}d</small><b class="${cls(r.rs[i])}">${pp(r.rs[i])}</b></div>`).join('')}</div></div>`;
};
const rsiBar = (v) => v == null ? '' : `<span class="rsi"><i style="left:${Math.max(0, Math.min(100, v))}%"></i></span>`;

/* ---------- acceso (la web solo refleja lo que el servidor ya ha decidido) ---------- */
const level = () => ME?.isAdmin ? 4 : (D?.level ?? ME?.level ?? 0);
// Qué conjunto de datos necesita cada página
const kindOf = (page, u) => ({ guia: 'guide', rs: 'rs', listas: 'list', recursos: 'links' })[page] || u;
const allowedKind = (kind) => {
  if (kind === 'guide') return level() >= (D?.need?.guide ?? 1) || !!D?.guideOpen;
  return !D?.locked?.[kind] && level() >= (D?.need?.[kind] ?? 99);
};
const allowed = (page, u) => allowedKind(kindOf(page, u));
const needName = (kind) => LEVEL_NAMES[D?.need?.[kind] ?? 3];
const isEmpty = (kind) => !!D?.empty?.[kind];
const U = (u) => D?.u?.[u] || null;
const hasSetups = (u) => !!U(u);

/* ---------- acceso a datos ---------- */
const KEYS = ['ind', 'brk', 'reb', 'per'];
const LN = { ind: 'Indicadores', brk: 'Breakout', reb: 'Rebote', per: 'Performance' };
const rowsOf = (page, u) => page === 'rs' ? (S.rsv === 'top' ? D.rs.top : D.rs.all) : U(u)[page];
function find(sym, u) {
  if (U(u)) for (const k of KEYS) { const r = U(u)[k].find((x) => x.s === sym); if (r) return r; }
  if (u === 'acc' && D.rs) { for (const r of D.rs.all.concat(D.rs.top)) if (r.s === sym) return r; }
  return null;
}
function lists(sym, u) {
  const a = [];
  if (U(u)) for (const k of KEYS) if (U(u)[k].some((x) => x.s === sym)) a.push(LN[k]);
  if (u === 'acc' && D.rs?.all.some((x) => x.s === sym)) a.push('RS superior a SPY');
  return a;
}

/* ---------- etiquetas por página ---------- */
function tags(page, r) {
  const t = [];
  if (r.hb) t.push(`<span class="tag gold" title="${HBT}">HB</span>`);
  if (page === 'ind' || page === 'rs') { if (r.xd != null && r.xd <= 3) t.push(`<span class="tag up">MACD hace ${nf(r.xd, 0)} d</span>`); }
  if (page === 'brk') { if (r.pch >= 100) t.push('<span class="tag up">Rompió</span>'); else if (r.pch >= 90) t.push('<span class="tag gold">Vigilancia</span>'); }
  if (page === 'reb') { t.push(r.sma === '50>200' ? '<span class="tag up">SMA50 &gt; 200</span>' : '<span class="tag">SMA50 &lt; 200</span>'); }
  if (page === 'per') { if (r.d63 > 0 && r.d21 < 0) t.push('<span class="tag gold">Corrección</span>'); }
  return t.join('');
}

/* ---------- filtros ---------- */
const CHIPS = {
  ind: [['x3', 'Cruce MACD reciente (≤ 3 días)', (r) => r.xd != null && r.xd <= 3], ['rz', 'RSI entre 50 y 70', (r) => r.rsi >= 50 && r.rsi <= 70]],
  brk: [['rom', 'Ya rompió (≥ 100 %)', (r) => r.pch >= 100], ['vig', 'Vigilancia (90–100 %)', (r) => r.pch >= 90 && r.pch < 100]],
  reb: [['gc', 'SMA50 > SMA200', (r) => r.sma === '50>200'], ['rz', 'RSI entre 50 y 70', (r) => r.rsi >= 50 && r.rsi <= 70]],
  per: [['cor', 'Corrección: 63d positivo y 21d negativo', (r) => r.d63 > 0 && r.d21 < 0]],
  rs: [['x3', 'Cruce MACD reciente (≤ 3 días)', (r) => r.xd != null && r.xd <= 3], ['rz', 'RSI entre 50 y 70', (r) => r.rsi >= 50 && r.rsi <= 70]],
};
const RSC = [['rs4', 'RS positiva en los 4 plazos', (r) => rsPos(r) === 4], ['rs2', 'RS positiva a 10 y 21 días', (r) => !!r.rs && r.rs[0] > 0 && r.rs[1] > 0]];
for (const k in CHIPS) CHIPS[k] = CHIPS[k].concat(RSC);
const SORTS = [['def', 'Orden del Excel'], ['rs21', 'RS vs SPY a 21 días'], ['rs63', 'RS vs SPY a 63 días'], ['rs10', 'RS vs SPY a 10 días'], ['rs42', 'RS vs SPY a 42 días'], ['rsn', 'Plazos con RS positiva'], ['d63', 'Rentabilidad 63d'], ['d21', 'Rentabilidad 21d'], ['c', 'Variación del día'], ['rsi', 'RSI'], ['pch', 'Posición en canal 20d'], ['hist', 'Histograma MACD'], ['s', 'Símbolo (A–Z)']];
const val = (r, k) => k === 'dist' ? dist(r) : k === 'vr' ? vr(r) : k === 'rsn' ? rsPos(r) : /^rs(10|21|42|63)$/.test(k) ? (r.rs || [])[['rs10', 'rs21', 'rs42', 'rs63'].indexOf(k)] : r[k];
const fk = (page, u) => page + '|' + (page === 'rs' ? S.rsv : u);
function getF(page, u) { const k = fk(page, u); return S.f[k] || (S.f[k] = { q: '', g: '', chips: [] }); }
function getSort(page, u) { const k = fk(page, u); return S.sort[k] || (S.sort[k] = page === 'per' ? { k: 'd63', d: -1 } : { k: 'def', d: -1 }); }
function apply(page, u) {
  const f = getF(page, u), so = getSort(page, u);
  let rows = rowsOf(page, u).slice();
  const q = f.q.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.s.toLowerCase().includes(q) || (r.n || '').toLowerCase().includes(q));
  if (f.g) rows = rows.filter((r) => r.g && r.g.includes(f.g));
  for (const c of (CHIPS[page] || [])) if (f.chips.includes(c[0])) rows = rows.filter(c[2]);
  if (so.k !== 'def') {
    rows.sort((a, b) => {
      if (so.k === 's') return so.d * (a.s < b.s ? -1 : a.s > b.s ? 1 : 0);
      const x = val(a, so.k), y = val(b, so.k);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      let c = so.d * (y - x) * -1;
      if (c === 0 && page === 'per' && so.k === 'd63') c = (b.d21 - a.d21);
      return c;
    });
  }
  return rows;
}

/* ---------- iconos ---------- */
const LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

/* ---------- vistas ---------- */
function patreonBtn(label = 'Ver niveles en Patreon') {
  return ENV.patreonUrl ? `<a class="btn" href="${esc(ENV.patreonUrl)}" target="_blank" rel="noopener">${label}</a>` : '';
}
function lockCard(kind) {
  let teaser = '';
  if (kind === 'rs' && D.teaser?.rs != null) teaser = `${D.teaser.rs} acciones con fuerza relativa superior al SPY esta semana`;
  else if (kind === 'acc' && D.teaser?.acc != null) teaser = `${D.teaser.acc} acciones con algún setup activo esta semana`;
  return `<div class="card lock">${LOCK}<h3>Disponible en ${esc(needName(kind))}</h3>
  <p>${teaser ? esc(teaser) + '. ' : ''}Tu nivel actual es ${esc(LEVEL_NAMES[level()])}. Este contenido se desbloquea al pasar de nivel en Patreon.</p>${patreonBtn()}</div>`;
}
function emptyCard() {
  return `<div class="empty">Todavía no hay datos publicados en esta sección.${ME?.isAdmin ? ' Súbelos desde Administración.' : ' Vuelve a mirar en un rato.'}</div>`;
}
function head(title, desc, meta) { return `<div class="pagehead"><div><h2>${title}</h2>${desc ? `<p>${desc}</p>` : ''}</div><div class="meta">${meta || ''}</div></div>`; }
const dsDate = (k) => fmtDate(D.dates?.[k]);
function uniSeg() {
  const nA = D.list?.acc?.length, nE = D.list?.etf?.length;
  const info = S.uni === 'acc' ? (nA != null ? `Base de ${nA} acciones · 2 actualizaciones por semana` : '2 actualizaciones por semana') : (nE != null ? `Lista de ${nE} ETFs · actualización semanal` : 'Actualización semanal');
  return `<div class="uni"><div class="seg" role="group" aria-label="Universo">
   <button data-uni="acc" aria-pressed="${S.uni === 'acc'}">Acciones</button>
   <button data-uni="etf" aria-pressed="${S.uni === 'etf'}">ETFs</button></div>
   <span class="meta">${info}</span></div>`;
}

function vGuia() {
  return head('Guía de uso', 'Cómo se leen los setups de esta web y qué pestaña mirar según lo que busques.', 'Actualización semanal') + `
  <div class="grid g3">
   <section class="card setup"><span class="badge">Setup 1</span><h3>Indicadores: MACD + RSI + SMA 50</h3>
    <p style="margin:0;color:var(--muted)">Confirmación técnica triple: hay impulso positivo, fuerza compradora y tendencia alcista a la vez.</p>
    <dl class="kv"><div><dt>MACD (8, 17, 9)</dt><dd>Histograma positivo: el momentum es alcista.</dd></div>
     <div><dt>RSI (14) &gt; 50</dt><dd>Fuerza en el impulso. Entre 50 y 70 es la zona ideal de entrada.</dd></div>
     <div><dt>SMA 50 diaria</dt><dd>Precio por encima de la media de 50 días: tendencia alcista de medio plazo.</dd></div></dl>
    <div class="where"><b>Setup activo:</b> se cumplen los tres a la vez. Lista corta: setup activado en los últimos 3 días. Pestaña Indicadores: setups más antiguos, que se pueden combinar con Breakout o Rebote.</div></section>
   <section class="card setup"><span class="badge">Setup 2</span><h3>Breakout: ruptura del máximo de 20 días</h3>
    <p style="margin:0;color:var(--muted)">Basado en el sistema Turtle de Richard Dennis. Si el precio supera el máximo de los últimos 20 días, la tendencia alcista tiene alta probabilidad de continuar.</p>
    <dl class="kv"><div><dt>Qué buscar</dt><dd>Precio por encima de la banda superior del canal de 20 días. Solo acción del precio.</dd></div>
     <div><dt>Vigilancia</dt><dd>Valores entre el 90 % y el 100 % del canal: están a punto de romper.</dd></div></dl>
    <div class="where"><b>Lista corta:</b> ya superaron el máximo de 20 días. <b>Pestaña Breakout:</b> todos los que están cerca del canal superior o lo han superado.</div></section>
   <section class="card setup"><span class="badge">Setup 3</span><h3>Rebote: vela de fuerza en tendencia alcista</h3>
    <p style="margin:0;color:var(--muted)">Captura el inicio de un nuevo impulso: fuerza en el día actual con la tendencia de fondo todavía positiva.</p>
    <dl class="kv"><div><dt>Precio</dt><dd>El cierre actual supera el máximo del día anterior.</dd></div>
     <div><dt>Medio plazo</dt><dd>Precio por encima de la SMA 50.</dd></div>
     <div><dt>Extra</dt><dd>SMA 50 por encima de SMA 200: tendencia de largo plazo confirmada y setup de más calidad.</dd></div>
     <div><dt>RSI (14) &gt; 50</dt><dd>Entre 50 y 70 es la zona ideal.</dd></div></dl>
    <div class="where"><b>Lista corta:</b> rebote confirmado con SMA 50 &gt; SMA 200. <b>Pestaña Rebote:</b> incluye también casos con la SMA 50 por debajo de la 200.</div></section>
   <section class="card setup"><span class="badge">Filtro adicional</span><h3>Performance a 21 y 63 días</h3>
    <p style="margin:0;color:var(--muted)">Todos los valores ordenados por rentabilidad a 63 días y, después, a 21 días. Se buscan los que tienen rentabilidad positiva a 63 días y atraviesan una corrección a 21 días. Las correcciones menores dentro de una tendencia alcista pueden ser oportunidades de entrada.</p>
    <div class="where">En la pestaña Performance, el filtro «Corrección» aplica justo esa condición.</div></section>
  </div>
  <section class="sec"><h3>Qué pestaña ver según lo que buscas</h3>
   <div class="card" style="padding:6px 14px;overflow-x:auto"><table class="quick"><thead><tr><th>Si quieres…</th><th>Usa</th><th>Setup</th></tr></thead><tbody>
    <tr><td>Setups activados en los últimos 3 días</td><td>Lista corta</td><td>Cualquier setup</td></tr>
    <tr><td>Ver todos los valores alcistas por indicadores</td><td>Indicadores</td><td>MACD + RSI + SMA 50</td></tr>
    <tr><td>Ver los que están en breakout o cerca</td><td>Breakout</td><td>Canal de 20 días</td></tr>
    <tr><td>Ver los que tienen un rebote activo</td><td>Rebote</td><td>Vela de fuerza</td></tr>
    <tr><td>Valores fuertes a 63d con corrección a 21d</td><td>Performance 21d/63d</td><td>Oportunidad de rebote</td></tr>
    <tr><td>Acciones que superan al S&amp;P 500</td><td>Top fuerza relativa</td><td>RS vs SPY</td></tr>
   </tbody></table></div></section>
  <section class="sec"><h3>Fuerza relativa frente al SPY</h3><div class="card" style="display:grid;gap:8px"><div>La fuerza relativa (RS) compara la rentabilidad de la acción o del ETF con la del SPY en 10, 21, 42 y 63 días. Se muestra en puntos porcentuales: un valor <b class="up">positivo</b> significa que rinde mejor que el SPY y uno <b class="dn">negativo</b>, que el SPY rinde mejor.</div><div>Sirve para elegir las más fuertes entre las más fuertes. Los puntos <span class="dots">●●●●</span> indican en cuántos de los cuatro plazos la RS es positiva. En los filtros puedes quedarte con las que lo son en los cuatro plazos.</div></div></section>
  <section class="sec"><h3>Etiquetas</h3><div class="card"><span class="tag gold">HB</span> <b>Hard to Borrow.</b> Son acciones en las que no se puede abrir un corto directamente en la plataforma. Antes hay que llamar al broker para negociar la tarifa.</div></section>`;
}

const chipsRow = (list, cur) => list.map(([id, l]) => `<button class="chip" data-chip="${id}" aria-pressed="${cur.includes(id)}">${l}</button>`).join('');
function filtersUI(page, u) {
  const f = getF(page, u), so = getSort(page, u);
  const groups = [...new Set(rowsOf(page, u).flatMap((r) => r.g || []))];
  const n = (f.q ? 1 : 0) + (f.g ? 1 : 0) + f.chips.length;
  return `<details class="filters" ${n ? 'open' : ''}><summary>Filtros y orden <span id="fcount"></span></summary><div class="fbody">
   <div class="frow">
    <label class="f">Buscar<input id="fq" type="search" placeholder="Símbolo o nombre" value="${esc(f.q)}" autocomplete="off"></label>
    ${groups.length ? `<label class="f">${u === 'etf' && page !== 'rs' ? 'Categoría' : 'Índice o sector'}<select id="fg"><option value="">Todos</option>${groups.map((g) => `<option value="${esc(g)}" ${f.g === g ? 'selected' : ''}>${esc(gn(g))}</option>`).join('')}</select></label>` : ''}
    <label class="f">Ordenar por<select id="fs">${SORTS.map(([k, l]) => `<option value="${k}" ${so.k === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
   </div>
   <div class="chips">${chipsRow(CHIPS[page] || [], f.chips)}</div>
   <button class="reset" id="freset">Quitar filtros</button></div></details>`;
}
const rowTitle = (r) => r.n ? esc(r.n) : '';
function card(page, r) {
  return `<button class="row" data-sym="${esc(r.s)}"><div class="r1"><span class="sym">${esc(r.s)} ${tags(page, r)}</span><span class="px">${nf(r.p)}</span></div>
  <div class="r2"><span class="nm">${rowTitle(r)}${r.g && r.g.length ? ' · ' + esc(r.g.map(gn).slice(0, 2).join(', ')) : ''}</span><span class="chg ${cls(r.c)}">${pct(r.c)}</span></div>
  <div class="r3"><div class="st"><small>21d</small><b class="${cls(r.d21)}">${pct(r.d21, 1)}</b></div><div class="st"><small>63d</small><b class="${cls(r.d63)}">${pct(r.d63, 1)}</b></div>
  <div class="st"><small>RSI</small><div class="rsiv"><b>${nf(r.rsi, 0)}</b></div>${rsiBar(r.rsi)}</div></div>${rsRow(r)}</button>`;
}
const COLS = [['s', 'Símbolo', 'l'], ['n', 'Nombre', 'l'], ['p', 'Precio'], ['c', 'Día'], ['d21', '21d'], ['d63', '63d'], ['rs10', 'RS 10d'], ['rs21', 'RS 21d'], ['rs42', 'RS 42d'], ['rs63', 'RS 63d'], ['ytd', 'YTD'], ['rsi', 'RSI'], ['hist', 'MACD hist.'], ['pch', 'Canal 20d'], ['dist', 'vs SMA50'], ['vr', 'Vol/prom.']];
function tableHTML(page, rows, u) {
  const so = getSort(page, u);
  const th = COLS.map(([k, l, a]) => `<th class="${a || ''}" data-sort="${k === 'n' ? 's' : k}" ${so.k === k ? `aria-sort="${so.d < 0 ? 'descending' : 'ascending'}"` : ''}>${l}${so.k === k ? (so.d < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('');
  const body = rows.map((r) => `<tr data-sym="${esc(r.s)}"><td><span class="sym">${esc(r.s)} ${tags(page, r)}</span></td><td class="l nmc" title="${esc(r.n)}">${esc(r.n)}</td>
   <td class="mono">${nf(r.p)}</td><td class="mono ${cls(r.c)}">${pct(r.c)}</td><td class="mono ${cls(r.d21)}">${pct(r.d21, 1)}</td><td class="mono ${cls(r.d63)}">${pct(r.d63, 1)}</td>${[0, 1, 2, 3].map((i) => `<td class="mono ${cls((r.rs || [])[i])}">${pp((r.rs || [])[i])}</td>`).join('')}<td class="mono ${cls(r.ytd)}">${pct(r.ytd, 1)}</td>
   <td class="mono">${nf(r.rsi, 0)}</td><td class="mono ${cls(r.hist)}">${nf(r.hist)}</td><td class="mono">${r.pch == null ? '–' : nf(r.pch, 0) + ' %'}</td><td class="mono ${cls(dist(r))}">${pct(dist(r), 1)}</td><td class="mono">${vr(r) == null ? '–' : nf(vr(r), 1) + '×'}</td></tr>`).join('');
  return `<div class="tw"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}
const DESC = { ind: 'Valores con MACD, RSI y SMA 50 alineados. Setups más antiguos que los de la lista corta.', brk: 'Valores que han superado el máximo de 20 días o están entre el 90 % y el 100 % del canal.',
  reb: 'Valores con vela de fuerza sobre la SMA 50. Incluye casos con la SMA 50 por debajo de la 200.', per: 'Ordenado por rentabilidad a 63 días y luego a 21 días. Busca tendencia positiva con corrección reciente.',
  rs: 'Acciones que muestran más fuerza que el S&P 500 en 5, 10, 21, 42 y 63 días.' };
function vData(page) {
  const u = page === 'rs' ? 'acc' : S.uni;
  const kind = page === 'rs' ? 'rs' : u;
  const title = page === 'rs' ? 'Top fuerza relativa vs SPY' : LN[page];
  let h = head(title, DESC[page], D.dates?.[kind] ? `Datos del ${dsDate(kind)}` : '');
  if (page !== 'rs') h += uniSeg();
  if (!allowedKind(kind)) return h + lockCard(kind);
  if (isEmpty(kind)) return h + emptyCard();
  if (page === 'rs') h += `<div class="uni"><div class="seg" role="group" aria-label="Lista"><button data-rsv="top" aria-pressed="${S.rsv === 'top'}">Top 50</button><button data-rsv="all" aria-pressed="${S.rsv === 'all'}">Lista completa (${D.rs.all.length})</button></div></div>`;
  const rows = apply(page, u), total = rowsOf(page, u).length;
  h += filtersUI(page, u);
  h += `<div class="meta" id="rcount" style="margin:0 2px 8px">${rows.length} de ${total} valores</div><div id="results">${resultsHTML(page, rows, u)}</div>`;
  return h;
}
function resultsHTML(page, rows, u) {
  if (!rows.length) return '<div class="empty">Ningún valor cumple estos filtros. Prueba a quitar alguno.</div>';
  return `<div class="list">${rows.map((r) => card(page, r)).join('')}</div>` + tableHTML(page, rows, u);
}

function vCorta() {
  const u = S.uni;
  let h = head('Lista corta', 'Los valores con un setup activo ahora mismo, separados por tipo de setup. Toca un símbolo para ver el detalle.', D.dates?.[u] ? `Datos del ${dsDate(u)}` : '') + uniSeg();
  if (!allowedKind(u)) return h + lockCard(u);
  if (isEmpty(u)) return h + emptyCard();
  const sh = U(u).short;
  const all = {};
  ['ind', 'brk', 'reb'].forEach((k) => sh[k].forEach((x) => { all[x.s] = (all[x.s] || 0) + 1; }));
  const tri = Object.keys(all).filter((s) => all[s] === 3);
  const duo = Object.keys(all).filter((s) => all[s] === 2);
  const chip = (x, badge) => `<button class="sc" data-sym="${esc(x)}">${esc(x)}${badge ? `<em>${badge}</em>` : ''}</button>`;
  if (tri.length || duo.length) h += `<div class="card conf"><h3>Confluencia: aparecen en más de una lista</h3>${tri.length ? `<div class="sublab">En los tres setups</div>${tri.map((s) => chip(s)).join('')}` : ''}${duo.length ? `<div class="sublab">En dos setups</div>${duo.map((s) => chip(s)).join('')}` : ''}</div>`;
  const col = (k, t, d) => {
    const items = sh[k]; let body = '';
    if (u === 'etf') { let last = null; items.forEach((x) => { if (x.g !== last) { body += `<div class="sublab">${esc(gn(x.g) || '')}</div>`; last = x.g; } body += chip(x.s, all[x.s] > 1 ? all[x.s] : ''); }); }
    else body = items.map((x) => chip(x.s, all[x.s] > 1 ? all[x.s] : '')).join('');
    return `<section class="card sl"><h3>${t}<span class="tag">${items.length}</span></h3><p>${d}</p>${body}</section>`;
  };
  h += `<div class="grid g3">${col('ind', 'Indicadores', 'MACD, RSI y SMA 50 alineados en los últimos 3 días.')}${col('brk', 'Breakout', 'Ya superaron el máximo de 20 días.')}${col('reb', 'Rebote', 'Vela de fuerza con SMA 50 por encima de SMA 200.')}</div>
  <p class="meta" style="margin-top:10px">El número dorado indica en cuántas listas aparece el valor.</p>`;
  return h;
}

function listaRows(u) {
  const f = S.lf[u], q = f.q.trim().toLowerCase();
  return D.list[u].filter((r) => (!q || r.s.toLowerCase().includes(q) || (r.n || '').toLowerCase().includes(q)) && (!f.g || r.g === f.g) && (!f.i || r.i === f.i) && (!f.sg || lists(r.s, u).length > 0));
}
function vListas() {
  const u = S.uni, f = S.lf[u];
  let h = head('Listas de seguimiento', u === 'acc' ? 'Todas las acciones que seguimos, con su sector e industria. Las que tienen un setup activo esta semana llevan sus etiquetas.' : 'Todos los ETFs que seguimos: índices, sectores, áreas de interés y países.', D.dates?.list ? `Actualizada el ${dsDate('list')}` : '') + uniSeg();
  if (!allowedKind('list')) return h + lockCard('list');
  if (isEmpty('list') || !D.list) return h + emptyCard();
  const tot = D.list[u].length;
  const gs = [...new Set(D.list[u].map((r) => r.g).filter(Boolean))];
  const is = u === 'acc' ? [...new Set(D.list.acc.filter((r) => !f.g || r.g === f.g).map((r) => r.i).filter(Boolean))].sort() : [];
  const showSetups = hasSetups(u);
  h += `<div class="filters"><div class="fbody" style="padding-top:14px"><div class="frow">
   <label class="f">Buscar<input id="lq" type="search" placeholder="Símbolo o nombre" value="${esc(f.q)}" autocomplete="off"></label>
   <label class="f">${u === 'acc' ? 'Sector' : 'Categoría'}<select id="lg"><option value="">Todos</option>${gs.map((g) => `<option value="${esc(g)}" ${f.g === g ? 'selected' : ''}>${esc(gn(g))}</option>`).join('')}</select></label>
   ${u === 'acc' ? `<label class="f">Industria<select id="li"><option value="">Todas</option>${is.map((g) => `<option value="${esc(g)}" ${f.i === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></label>` : ''}
   </div>${showSetups ? `<div class="chips"><button class="chip" data-lchip aria-pressed="${f.sg}">Solo con setup esta semana</button></div>` : ''}</div></div>
  <div class="meta" style="margin:0 2px 8px" id="lcount">${listaRows(u).length} de ${tot} ${u === 'acc' ? 'acciones' : 'ETFs'}</div><div id="lres">${listasRows(listaRows(u), u)}</div>`;
  if (!showSetups) h += `<p class="meta" style="margin-top:10px">Los setups de la semana de ${u === 'acc' ? 'acciones' : 'ETFs'} se ven en ${esc(needName(u))} o superior.</p>`;
  return h;
}
function listasRows(rows, u) {
  if (!rows.length) return '<div class="empty">Ningún valor coincide con estos filtros.</div>';
  const adm = !!ME?.isAdmin, showSetups = hasSetups(u);
  return `<div class="tw" style="display:block"><table class="ltab"><thead><tr><th class="l" style="cursor:default">Símbolo</th><th class="l" style="cursor:default">Nombre</th>${showSetups ? '<th class="l" style="cursor:default">Setups esta semana</th>' : ''}${adm ? '<th style="cursor:default"></th>' : ''}</tr></thead><tbody>${rows.map((r) => {
    const ls = lists(r.s, u);
    return `<tr data-sym="${esc(r.s)}"><td><span class="sym">${esc(r.s)} ${r.hb ? `<span class="tag gold" title="${HBT}">HB</span>` : ''}</span></td>
   <td class="l" style="white-space:normal;min-width:180px">${esc(r.n)}<div class="nm" style="white-space:normal">${esc(gn(r.g) || '')}${r.i ? ' · ' + esc(r.i) : ''}</div></td>
   ${showSetups ? `<td class="l" style="white-space:normal">${ls.length ? ls.map((x) => `<span class="tag gold" style="margin:0 4px 4px 0">${x}</span>`).join('') : '<span class="meta">–</span>'}</td>` : ''}
   ${adm ? `<td><button class="chip" data-del="${u}|${esc(r.s)}">Quitar</button></td>` : ''}</tr>`;
  }).join('')}</tbody></table></div>`;
}

function vRecursos() {
  let h = head('Recursos de Estrategia Superior', 'Accesos directos a las operaciones en vivo, al reporte de stop-loss y al plan de trading.');
  if (!allowedKind('links')) return h + lockCard('links');
  const links = D.links || [];
  h += `<div class="grid g3">${links.map((l) => `<section class="card setup"><h3>${esc(l.t)}</h3><p style="margin:0;color:var(--muted)">${esc(l.d)}</p>
   ${l.u ? `<a class="btn" href="${esc(l.u)}" target="_blank" rel="noopener noreferrer">Abrir</a>` : '<button class="btn" disabled>Enlace pendiente de configurar</button>'}</section>`).join('')}</div>`;
  if (ME?.isAdmin) h += '<p class="meta" style="margin-top:12px">Los enlaces se configuran en Administración → Recursos.</p>';
  return h;
}

function vSinSuscripcion() {
  return `<div class="loginwrap"><div class="card login">${LOCK}<h2>Tu cuenta de Patreon no tiene una suscripción activa</h2>
   <p>Has entrado como <b>${esc(ME.name || 'suscriptor')}</b>, pero no encontramos una suscripción de pago activa en CyM Inversores. Si acabas de suscribirte o de cambiar de nivel, espera unos minutos y vuelve a entrar.</p>
   <div class="row2">${patreonBtn('Ver niveles en Patreon')}<button class="btn ghost" data-act="hardreload">Volver a comprobar</button></div>
   <p class="meta">¿Entras con otra cuenta de Patreon? Cierra sesión y vuelve a entrar con la cuenta suscrita.</p></div></div>`;
}

/* ---------- ficha ---------- */
function drawer(sym) {
  const u = S.page === 'rs' ? 'acc' : S.uni;
  const r = find(sym, u);
  const ov = $('#ov');
  if (!r) {
    const li = (D.list?.[u] || []).find((x) => x.s === sym);
    ov.hidden = false;
    ov.innerHTML = `<div class="ov" data-close><div class="sheet" role="dialog" aria-modal="true" aria-label="Detalle de ${esc(sym)}"><div class="sh-head"><div><h3>${esc(sym)} ${li && li.hb ? `<span class="tag gold" title="${HBT}">HB</span>` : ''}</h3><div style="color:var(--muted)">${esc(li ? li.n : '')}</div></div><button class="x" data-close aria-label="Cerrar">×</button></div>${li ? `<div class="inl">${li.g ? `<span class="tag">${esc(gn(li.g))}</span>` : ''}${li.i ? `<span class="tag">${esc(li.i)}</span>` : ''}</div>` : ''}<p style="color:var(--muted)">${hasSetups(u) ? 'Está en la lista de seguimiento, pero no tiene ningún setup activo esta semana, así que no hay datos en esta carga.' : 'Está en la lista de seguimiento. Los datos de setups de este universo se ven en un nivel superior.'}</p>${tvBtn(sym)}</div></div>`;
    ov.querySelector('.x')?.focus();
    return;
  }
  const ls = lists(sym, u);
  const m = (a, b, c) => `<div><small>${a}</small><b class="${c || ''}">${b}</b></div>`;
  const pos = r.pch == null ? '–' : nf(r.pch, 0) + ' %';
  ov.hidden = false;
  ov.innerHTML = `<div class="ov" data-close><div class="sheet" role="dialog" aria-modal="true" aria-label="Detalle de ${esc(sym)}">
  <div class="sh-head"><div><h3>${esc(sym)} ${r.hb ? `<span class="tag gold" title="${HBT}">HB</span>` : ''}</h3><div style="color:var(--muted)">${esc(r.n)}</div></div><button class="x" data-close aria-label="Cerrar">×</button></div>
  <div class="bigpx"><b>${nf(r.p)}</b><span class="mono ${cls(r.c)}">${pct(r.c)} hoy</span></div>
  ${tvBtn(sym)}
  <div class="inl" style="margin-top:12px">${(r.g || []).map((g) => `<span class="tag">${esc(gn(g))}</span>`).join('')}</div>
  ${r.hb ? '<div class="blk"><div class="where"><b>HB (Hard to Borrow).</b> No se puede abrir corto directamente en la plataforma. Hay que llamar al broker para negociar la tarifa antes.</div></div>' : ''}
  <div class="blk"><h4>Aparece en</h4><div class="inl">${ls.length ? ls.map((x) => `<span class="tag gold">${x}</span>`).join('') : '<span class="tag">Sin setups</span>'}</div></div>
  <div class="blk"><h4>Rentabilidad</h4><div class="mg">${m('21 días', pct(r.d21, 1), cls(r.d21))}${m('63 días', pct(r.d63, 1), cls(r.d63))}${m('En el año', pct(r.ytd, 1), cls(r.ytd))}${m('Dividendo', r.dy == null ? '–' : nf(r.dy) + ' %')}</div></div>
  <div class="blk"><h4>Fuerza relativa vs SPY · ${rsPos(r)} de 4 plazos positivos</h4><div class="mg">${m('10 días', pp(r.rs?.[0]) + ' pp', cls(r.rs?.[0]))}${m('21 días', pp(r.rs?.[1]) + ' pp', cls(r.rs?.[1]))}${m('42 días', pp(r.rs?.[2]) + ' pp', cls(r.rs?.[2]))}${m('63 días', pp(r.rs?.[3]) + ' pp', cls(r.rs?.[3]))}</div><p class="meta" style="margin:6px 0 0">Rentabilidad menos la del SPY, en puntos porcentuales. Positivo: rinde más que el SPY.</p></div>
  <div class="blk"><h4>Tendencia</h4><div class="mg">${m('Distancia a SMA 50', pct(dist(r), 1), cls(dist(r)))}${m('SMA 50', nf(r.s50))}${m('SMA 200', nf(r.s200))}${m('Orden SMA', r.sma === '50>200' ? 'SMA 50 &gt; 200' : 'SMA 50 &lt; 200')}</div></div>
  <div class="blk"><h4>Momentum</h4><div class="mg">${m('RSI (14)', nf(r.rsi, 0))}${m('MACD', nf(r.macd))}${m('Histograma MACD', nf(r.hist), cls(r.hist))}${m('Días desde cruce MACD', r.xd == null ? '–' : nf(r.xd, 0))}${m('Estocástico lento', nf(r.k, 0))}</div></div>
  <div class="blk"><h4>Canal de 20 días</h4><div class="mg">${m('Banda superior', nf(r.up))}${m('Banda inferior', nf(r.lo))}${m('Posición en el canal', pos)}${m('Bollinger %B', r.pb == null ? '–' : nf(r.pb, 0) + ' %')}</div></div>
  <div class="blk"><h4>Volumen y volatilidad</h4><div class="mg">${m('Volumen', big(r.vol))}${m('Volumen medio', big(r.vavg))}${m('Volumen / medio', vr(r) == null ? '–' : nf(vr(r), 1) + '×')}${m('ATR', nf(r.atr))}</div></div>
  </div></div>`;
  ov.querySelector('.x')?.focus();
}
function closeDrawer() { const ov = $('#ov'); ov.hidden = true; ov.innerHTML = ''; }

/* ---------- pantalla de acceso ---------- */
const LOGIN_ERRORS = {
  denied: 'Has cancelado el acceso en Patreon. Si quieres entrar, vuelve a pulsar el botón y acepta los permisos.',
  state: 'La sesión de acceso ha caducado o no es válida. Vuelve a pulsar el botón para entrar.',
  patreon: 'Patreon no ha podido confirmar tu cuenta ahora mismo. Inténtalo de nuevo en unos minutos.',
  network: 'No hemos podido conectar con Patreon. Inténtalo de nuevo en unos minutos.',
  config: 'El acceso con Patreon todavía no está configurado en el servidor.',
};
function renderLogin(errCode) {
  $('#navwrap').hidden = true; $('#userbar').hidden = true; $('#stamp').hidden = true;
  const err = errCode ? (LOGIN_ERRORS[errCode] || 'No se ha podido iniciar sesión. Inténtalo de nuevo.') : '';
  const dev = ENV.devLogin ? `<div class="notice" style="font-size:13px"><b>Modo prueba (solo en local):</b> <a href="/auth/dev?level=0">sin suscripción</a> · <a href="/auth/dev?level=1">Esencial</a> · <a href="/auth/dev?level=2">Intermedio</a> · <a href="/auth/dev?level=3">Superior</a> · <a href="/auth/dev?level=4">Admin</a></div>` : '';
  $('#main').innerHTML = `<div class="loginwrap"><div class="card login">
   <div><h2>Setups de acciones y ETFs</h2></div>
   <p>Esta web es para suscriptores de CyM Inversores en Patreon. Entra con tu cuenta de Patreon y verás los contenidos de tu nivel de suscripción.</p>
   ${err ? `<div class="notice err" role="alert">${esc(err)}</div>` : ''}
   <a class="btn patreon" href="/auth/patreon">Entrar con Patreon</a>
   <p class="meta">Solo leemos tu nombre, tu email y tu nivel de suscripción para saber qué contenido te corresponde. No podemos publicar ni cobrar nada en tu nombre.</p>
   ${dev}
  </div></div>`;
}

/* ---------- renderizado ---------- */
function visiblePages() {
  return PAGES.filter(([id]) => {
    if (id === 'admin') return !!ME?.isAdmin;
    if (level() === 0) return id === 'guia';
    return true;
  });
}
function renderNav() {
  const nav = $('#nav');
  nav.innerHTML = visiblePages().map(([id, l]) => {
    const lk = (id === 'rs' || id === 'recursos') ? !allowed(id, 'acc') : false;
    return `<button data-page="${id}" ${S.page === id ? 'aria-current="page"' : ''}>${l}${lk ? LOCK : ''}</button>`;
  }).join('');
  $('#navwrap').hidden = false;
}
function renderStamp() {
  const p = S.page;
  const k = p === 'rs' ? 'rs' : (p === 'listas' ? 'list' : S.uni);
  const el = $('#stamp');
  if (!D.dates?.[k] || ['guia', 'recursos', 'admin'].includes(p)) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<i></i><span>Actualizado ${fmtDate(D.dates[k])}</span>`;
}
function renderUserBar() {
  const el = $('#userbar');
  el.hidden = false;
  el.innerHTML = `<div class="who"><b>${esc(ME.name || 'Suscriptor')}</b><span>${esc(LEVEL_NAMES[level()])}</span></div><button data-act="logout">Salir</button>`;
}
async function renderAdmin() {
  const box = $('#main');
  box.innerHTML = '<div class="spin">Cargando administración…</div>';
  try {
    const m = await import('/admin.js');
    m.mount(box, { reloadData: () => loadData(true, true), fmtDate });
  } catch (e) {
    box.innerHTML = `<div class="notice err">No se ha podido cargar el panel: ${esc(e.message)}</div>`;
  }
}
function render(keepScroll) {
  if (!ME) return;
  if (level() === 0 && !ME.isAdmin && !D?.guideOpen) {
    $('#navwrap').hidden = true; $('#stamp').hidden = true; renderUserBar();
    $('#main').innerHTML = vSinSuscripcion();
    return;
  }
  if (level() === 0) S.page = 'guia';
  if (S.page === 'admin' && !ME.isAdmin) S.page = 'guia';
  renderUserBar(); renderNav(); renderStamp();
  const y = window.scrollY;
  if (S.page === 'admin') { renderAdmin(); window.scrollTo(0, 0); return; }
  const v = { guia: vGuia, corta: vCorta, ind: () => vData('ind'), brk: () => vData('brk'), reb: () => vData('reb'), per: () => vData('per'), rs: () => vData('rs'), listas: vListas, recursos: vRecursos }[S.page];
  $('#main').innerHTML = v();
  window.scrollTo(0, keepScroll ? y : 0);
  updCount();
}
function updCount() {
  const page = S.page; if (!CHIPS[page]) return;
  const u = page === 'rs' ? 'acc' : S.uni;
  const f = getF(page, u);
  const n = (f.q ? 1 : 0) + (f.g ? 1 : 0) + f.chips.length;
  const el = $('#fcount'); if (el) el.textContent = n ? `${n} activo${n > 1 ? 's' : ''}` : '';
}
function refresh() {
  const page = S.page, u = page === 'rs' ? 'acc' : S.uni;
  const rows = apply(page, u);
  $('#results').innerHTML = resultsHTML(page, rows, u);
  $('#rcount').textContent = `${rows.length} de ${rowsOf(page, u).length} valores`;
  updCount();
}

/* ---------- eventos ---------- */
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-page],[data-uni],[data-rsv],[data-chip],[data-sym],[data-sort],[data-close],[data-lchip],[data-del],[data-act],#freset');
  if (!t) return;
  const d = t.dataset;
  if (d.close !== undefined) { if (t.classList.contains('ov') && e.target !== t) return; closeDrawer(); return; }
  if (d.act === 'logout') { try { await api('POST', '/auth/logout'); } catch { /* se sale igualmente */ } location.href = '/'; return; }
  if (d.act === 'hardreload') { location.reload(); return; }
  if (d.act === 'reload') { await loadData(true); return; }
  if (!D || S.page === 'admin') return;
  if (d.page) { S.page = d.page; try { history.replaceState(null, '', '#' + d.page); } catch { /* ok */ } render(); return; }
  if (d.uni) { S.uni = d.uni; render(true); return; }
  if (d.rsv) { S.rsv = d.rsv; render(true); return; }
  if (d.chip) {
    const f = getF(S.page, S.page === 'rs' ? 'acc' : S.uni);
    const i = f.chips.indexOf(d.chip); if (i >= 0) f.chips.splice(i, 1); else f.chips.push(d.chip);
    t.setAttribute('aria-pressed', i < 0); refresh(); return;
  }
  if (d.sort) {
    const so = getSort(S.page, S.page === 'rs' ? 'acc' : S.uni);
    if (so.k === d.sort) so.d *= -1; else { so.k = d.sort; so.d = (d.sort === 's' || d.sort === 'n') ? 1 : -1; }
    render(true); return;
  }
  if (d.sym) { drawer(d.sym); return; }
  if (d.lchip !== undefined) { const f = S.lf[S.uni]; f.sg = !f.sg; render(true); return; }
  if (d.del) {
    const [u, s] = d.del.split('|');
    if (!confirm(`¿Quitar ${s} de la lista de seguimiento?`)) return;
    try { await api('DELETE', `/api/admin/watchlist/${u}/${encodeURIComponent(s)}`); await loadData(true); }
    catch (err) { alert(err.message); }
    return;
  }
  if (t.id === 'freset') { const f = getF(S.page, S.page === 'rs' ? 'acc' : S.uni); f.q = ''; f.g = ''; f.chips = []; render(true); }
});
document.addEventListener('input', (e) => {
  if (!D || S.page === 'admin') return;
  const t = e.target, page = S.page, u = page === 'rs' ? 'acc' : S.uni;
  if (t.id === 'fq') { getF(page, u).q = t.value; refresh(); }
  else if (t.id === 'lq') { const uu = S.uni; S.lf[uu].q = t.value; const rows = listaRows(uu); $('#lres').innerHTML = listasRows(rows, uu); $('#lcount').textContent = `${rows.length} de ${D.list[uu].length} ${uu === 'acc' ? 'acciones' : 'ETFs'}`; }
});
document.addEventListener('change', (e) => {
  if (!D || S.page === 'admin') return;
  const t = e.target, page = S.page, u = page === 'rs' ? 'acc' : S.uni;
  if (t.id === 'lg') { S.lf[S.uni].g = t.value; S.lf[S.uni].i = ''; render(true); }
  else if (t.id === 'li') { S.lf[S.uni].i = t.value; render(true); }
  else if (t.id === 'fg') { getF(page, u).g = t.value; refresh(); }
  else if (t.id === 'fs') { const so = getSort(page, u); so.k = t.value; so.d = t.value === 's' ? 1 : -1; render(true); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#ov').hidden) closeDrawer(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ME && S.page !== 'admin' && Date.now() - loadedAt > 15 * 60 * 1000) loadData(true, true);
});

/* ---------- arranque ---------- */
async function loadData(keepScroll, quiet) {
  try {
    D = await api('GET', '/api/bootstrap');
    loadedAt = Date.now();
    if (!allowedKind('acc') && S.uni === 'acc' && allowedKind('etf')) S.uni = 'etf';
    render(keepScroll);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { ME = null; D = null; renderLogin(); return; }
    if (!quiet) $('#main').innerHTML = `<div class="notice err" role="alert">No se han podido cargar los datos: ${esc(e.message)} <button class="btn sm ghost" data-act="reload">Reintentar</button></div>`;
  }
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const loginErr = params.get('login_error');
  if (loginErr) { try { history.replaceState(null, '', location.pathname + location.hash); } catch { /* ok */ } }
  try {
    const me = await api('GET', '/api/me');
    ENV = { patreonUrl: me.patreonUrl || '', devLogin: !!me.devLogin };
    if (!me.user) { renderLogin(loginErr); return; }
    setCsrf(me.csrf);
    ME = { ...me.user };
    await loadData(false);
  } catch (e) {
    $('#main').innerHTML = `<div class="notice err" role="alert">No se ha podido cargar la web: ${esc(e.message)} <button class="btn sm ghost" data-act="hardreload">Reintentar</button></div>`;
  }
}
boot();
