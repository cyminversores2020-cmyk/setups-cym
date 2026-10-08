import { api } from '/api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => { if (!d) return '–'; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${y}`; };
const fmtTs = (t) => t ? new Date(t).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '–';

const KINDS = [
  ['etf', 'ETFs y sectores', 'Semanal', 'Señales_semanales_ETFs_y_Sectores.xlsx'],
  ['acc', 'Lista base de acciones', '2 veces por semana', 'Señales_LISTA BASE DE ACCIONES.xlsx'],
  ['rs', 'Acciones con RS superior a SPY', 'Semanal', 'Señales_LISTA ACCIONES RS vs SPY.xlsx'],
  ['list', 'Listas de seguimiento', 'Solo cuando cambie la lista', 'Lista de seguimiento completa.xlsx'],
];
const SHEET_LABEL = { ind: 'Indicadores', brk: 'Breakout', reb: 'Rebote', per: 'Performance', all: 'Lista completa', top: 'Top 50' };
const LEVELS = { 0: 'Sin suscripción', 1: 'Esencial', 2: 'Intermedio', 3: 'Superior', 4: 'Administrador' };
const ACTIONS = {
  login: 'Inicio de sesión', upload: 'Subida de Excel', publish: 'Publicación', watchlist_add: 'Valor añadido a la lista', watchlist_remove: 'Valor quitado de la lista',
  guest_set: 'Invitado añadido o cambiado', guest_remove: 'Invitado quitado', settings: 'Ajustes cambiados', campaign_detected: 'Campaña de Patreon detectada',
};

const TABS = [['cargas', 'Cargas de datos'], ['lista', 'Añadir a la lista'], ['recursos', 'Recursos'], ['invitados', 'Invitados'], ['ajustes', 'Ajustes de acceso'], ['personas', 'Personas'], ['registro', 'Registro']];
const st = { form: {}, tab: 'cargas', ds: null, preview: {}, msg: {}, settings: null, guests: null, users: null, audit: null, uq: '', busy: false };
let root = null;
let ctx = null;

export function mount(container, context) {
  ctx = context;
  root = container;
  if (container._adminHandler) {
    container.removeEventListener('click', container._adminHandler);
    container.removeEventListener('change', container._adminChange);
    container.removeEventListener('input', container._adminInput);
  }
  container._adminHandler = onClick;
  container._adminChange = onChange;
  container._adminInput = onInput;
  container.addEventListener('click', onClick);
  container.addEventListener('change', onChange);
  container.addEventListener('input', onInput);
  load().then(draw);
  draw();
}

async function load() {
  try {
    if (st.tab === 'cargas') st.ds = await api('GET', '/api/admin/datasets');
    else if (st.tab === 'recursos' || st.tab === 'ajustes') st.settings = await api('GET', '/api/admin/settings');
    else if (st.tab === 'invitados') st.guests = await api('GET', '/api/admin/guests');
    else if (st.tab === 'personas') st.users = await api('GET', '/api/admin/users?q=' + encodeURIComponent(st.uq));
    else if (st.tab === 'registro') st.audit = await api('GET', '/api/admin/audit');
    st.err = null;
  } catch (e) { st.err = e.message; }
}

const fv = (id, def = '') => st.form[id] ?? def;
const note = (key) => st.msg[key] ? `<div class="notice ${st.msg[key].ok ? 'ok' : 'err'}" role="status">${esc(st.msg[key].text)}</div>` : '';
const setMsg = (key, ok, text) => { st.msg[key] = { ok, text }; };

function draw() {
  if (!root) return;
  const y = window.scrollY;
  const tabs = `<div class="tabs2" role="tablist">${TABS.map(([id, l]) => `<button role="tab" data-tab="${id}" aria-current="${st.tab === id}">${l}</button>`).join('')}</div>`;
  let body = '';
  if (st.err) body += `<div class="notice err" role="alert">${esc(st.err)}</div>`;
  body += { cargas: vCargas, lista: vLista, recursos: vRecursos, invitados: vInvitados, ajustes: vAjustes, personas: vPersonas, registro: vRegistro }[st.tab]();
  root.innerHTML = `<div class="pagehead"><div><h2>Administración</h2><p>Solo visible para administradores.</p></div></div>${tabs}${body}`;
  window.scrollTo(0, y);
}

/* ---------- Cargas ---------- */
function statsHTML(stats) {
  if (!stats) return '';
  const li = [];
  if (stats.filas) li.push(`<li>Filas leídas: ${Object.entries(stats.filas).map(([k, v]) => `${SHEET_LABEL[k] || k} ${v}`).join(' · ')}.</li>`);
  if (stats.lista_corta) li.push(`<li>Lista corta: ${Object.entries(stats.lista_corta).map(([k, v]) => `${SHEET_LABEL[k] || k} ${v}`).join(' · ')}.</li>`);
  if (stats.acciones != null) li.push(`<li>${stats.acciones} acciones y ${stats.etfs} ETFs${stats.bloques_etf?.length ? ` en ${stats.bloques_etf.length} bloques` : ''}.</li>`);
  if (stats.hb != null || stats.con_hb != null) li.push(`<li>${stats.hb ?? stats.con_hb} valores con etiqueta HB (Hard to Borrow).</li>`);
  if (stats.duplicados_unidos) li.push(`<li>${stats.duplicados_unidos} símbolos repetidos en varias hojas, unidos en uno solo.</li>`);
  if (stats.lista_corta_duplicados_quitados) li.push(`<li>${stats.lista_corta_duplicados_quitados} repetidos quitados de la lista corta.</li>`);
  const c = stats.conversiones;
  if (c && typeof c === 'object') {
    const parts = Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`);
    if (parts.length) li.push(`<li>Correcciones de formato aplicadas (${parts.join(' · ')}).</li>`);
  }
  return li.length ? `<ul>${li.join('')}</ul>` : '';
}
function diffHTML(kind, diff) {
  if (!diff) return '<p class="meta">Es la primera carga de este conjunto: no hay nada con lo que comparar.</p>';
  const out = [];
  const names = (a) => a.length ? a.map(esc).join(', ') : 'ninguno';
  if (kind === 'list') {
    for (const [k, lab] of [['acc', 'Acciones'], ['etf', 'ETFs']]) {
      const d = diff[k]; if (!d) continue;
      out.push(`<li><b>${lab}</b> (${d.total} en total). <span class="added">Nuevos: ${names(d.added)}.</span> <span class="removed">Quitados: ${names(d.removed)}.</span></li>`);
    }
  } else {
    for (const [k, v] of Object.entries(diff)) {
      if (k === 'short') continue;
      out.push(`<li>${SHEET_LABEL[k] || k}: ${v.before} → ${v.after} filas.</li>`);
    }
    if (diff.short) for (const [k, v] of Object.entries(diff.short)) {
      out.push(`<li>Lista corta de ${SHEET_LABEL[k]}: <span class="added">entran: ${names(v.added)}</span>; <span class="removed">salen: ${names(v.removed)}</span>.</li>`);
    }
  }
  return `<b>Cambios respecto a lo publicado</b><ul>${out.join('')}</ul>`;
}
function previewHTML(kind, p) {
  const v = p.draft || p.version;
  const warn = (v.warnings || []).length ? `<div class="warn"><b>Avisos</b><ul>${v.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '';
  const isRollback = v.status === 'archived';
  return `<div class="prev"><b>${isRollback ? 'Versión anterior' : 'Vista previa de la carga'} · datos del ${fmtDate(v.date)}</b>
   ${v.filename ? `<span class="meta">${esc(v.filename)}</span>` : ''}
   ${statsHTML(v.stats)}${warn}${diffHTML(kind, p.diff)}
   <div class="acts" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-pub="${v.id}" data-kind="${kind}" ${st.busy ? 'disabled' : ''}>${isRollback ? 'Volver a esta versión' : 'Publicar'}</button>
   ${v.status === 'draft' ? `<button class="btn ghost" data-discard="${v.id}" data-kind="${kind}">Descartar</button>` : `<button class="btn ghost" data-closeprev="${kind}">Cerrar</button>`}</div></div>`;
}
function vCargas() {
  if (!st.ds) return '<div class="spin">Cargando…</div>';
  return `<p class="meta" style="margin:0 0 12px">Sube el Excel, revisa la vista previa y publica. La fecha que ven los suscriptores sale del propio Excel. Hasta que no pulses «Publicar» no cambia nada para ellos.</p>
  <div class="ds">${KINDS.map(([id, title, freq, file]) => {
    const d = st.ds[id]; const pub = d?.published;
    return `<div class="dsr"><div><h3>${title}</h3><p>${freq} · ${esc(file)}</p>
     <p>${pub ? `Publicado: datos del <b>${fmtDate(pub.date)}</b> · subido por ${esc(pub.uploadedBy || '–')} el ${fmtTs(pub.publishedAt)}` : '<b>Todavía no hay nada publicado.</b>'}</p>
     ${d?.drafts?.length ? `<p class="meta">Borradores sin publicar: ${d.drafts.map((x) => `<button class="btn ghost sm" data-view="${x.id}" data-kind="${id}">${fmtDate(x.date)} · ${esc(x.filename || '')}</button>`).join(' ')}</p>` : ''}</div>
     <div class="acts"><label class="btn ghost sm" style="cursor:pointer">Subir Excel<input type="file" accept=".xlsx" data-upload="${id}" hidden></label></div>
     ${note('k_' + id)}
     ${st.preview[id] ? previewHTML(id, st.preview[id]) : ''}
     ${d?.history?.length ? `<details class="hist"><summary style="cursor:pointer;font-size:13px;color:var(--muted)">Versiones anteriores (${d.history.length})</summary>${d.history.map((h) => `<div class="h"><span>Datos del <b>${fmtDate(h.date)}</b> · publicado el ${fmtTs(h.publishedAt)}</span><button class="btn ghost sm" data-view="${h.id}" data-kind="${id}">Revisar y volver a esta</button></div>`).join('')}</details>` : ''}
    </div>`;
  }).join('')}</div>`;
}

/* ---------- Añadir a la lista ---------- */
function vLista() {
  return `<section class="card" style="display:grid;gap:10px"><h3>Añadir o cambiar un valor de la lista</h3>
   <p style="margin:0;color:var(--muted);font-size:14px">Para añadir una acción o un ETF sin subir el Excel entero. Si el símbolo ya existe, se actualizan sus datos. Para quitar uno, ve a Listas de seguimiento y pulsa «Quitar». Recuerda añadir también el símbolo en tu scanner para que salga en los setups.</p>
   <div class="frow"><label class="f">Tipo<select id="ad-t"><option value="acc" ${fv('ad-t') !== 'etf' ? 'selected' : ''}>Acción</option><option value="etf" ${fv('ad-t') === 'etf' ? 'selected' : ''}>ETF</option></select></label>
   <label class="f">Símbolo<input id="ad-s" placeholder="Ej.: AVGO" autocomplete="off" maxlength="10" value="${esc(fv('ad-s'))}"></label>
   <label class="f">Nombre<input id="ad-n" placeholder="Ej.: Broadcom Inc" autocomplete="off" value="${esc(fv('ad-n'))}"></label>
   <label class="f">Sector o categoría<input id="ad-g" placeholder="Ej.: Technology" autocomplete="off" value="${esc(fv('ad-g'))}"></label>
   <label class="f">Industria (solo acciones)<input id="ad-i" placeholder="Ej.: Semiconductors" autocomplete="off" value="${esc(fv('ad-i'))}"></label></div>
   <label class="sw"><input type="checkbox" id="ad-hb" ${fv('ad-hb') ? 'checked' : ''}> Es Hard to Borrow (HB)</label>
   <div class="row2"><button class="btn" data-add>Añadir a la lista</button></div>${note('add')}</section>`;
}

/* ---------- Recursos ---------- */
function vRecursos() {
  if (!st.settings) return '<div class="spin">Cargando…</div>';
  const links = st.links || (st.links = structuredClone(st.settings.links));
  return `<p class="meta" style="margin:0 0 12px">Estos accesos los ven las personas de Estrategia Superior. Solo se admiten enlaces que empiecen por https://</p>
  <div class="grid g3">${links.map((l, i) => `<div class="card" style="display:grid;gap:8px">
   <label class="f">Título<input data-lt="${i}" value="${esc(l.t)}" maxlength="120"></label>
   <label class="f">Descripción<input data-ld="${i}" value="${esc(l.d)}" maxlength="300"></label>
   <label class="f">Enlace (Discord o Patreon)<input data-lu="${i}" value="${esc(l.u)}" placeholder="https://…" inputmode="url"></label>
   <button class="btn ghost sm danger" data-lrm="${i}" style="justify-self:start">Quitar</button></div>`).join('')}</div>
  <div class="row2" style="margin-top:12px"><button class="btn ghost" data-ladd>Añadir otro enlace</button><button class="btn" data-lsave>Guardar enlaces</button></div>${note('links')}`;
}

/* ---------- Invitados ---------- */
function vInvitados() {
  if (!st.guests) return '<div class="spin">Cargando…</div>';
  return `<section class="card" style="display:grid;gap:10px"><h3>Dar acceso a alguien sin suscripción</h3>
   <p style="margin:0;color:var(--muted);font-size:14px">La persona entra igualmente con Patreon (una cuenta gratuita sirve). Si el email de su cuenta coincide con el de esta lista, verá los contenidos del nivel que elijas, aunque no pague.</p>
   <div class="frow"><label class="f">Email de su cuenta de Patreon<input id="g-e" type="email" placeholder="persona@correo.com" autocomplete="off" value="${esc(fv('g-e'))}"></label>
   <label class="f">Nivel<select id="g-l">${[1, 2, 3].map((n) => `<option value="${n}" ${String(fv('g-l', '1')) === String(n) ? 'selected' : ''}>${LEVELS[n]}</option>`).join('')}</select></label>
   <label class="f">Caduca el (opcional)<input id="g-x" type="date" value="${esc(fv('g-x'))}"></label>
   <label class="f">Nota (opcional)<input id="g-n" placeholder="Ej.: colaborador" maxlength="200" value="${esc(fv('g-n'))}"></label></div>
   <div class="row2"><button class="btn" data-gadd>Guardar invitado</button></div>${note('guest')}</section>
  <section class="sec"><h3>Invitados actuales (${st.guests.length})</h3>${st.guests.length ? `<div class="card" style="overflow-x:auto;padding:6px 14px"><table class="atable"><thead><tr><th>Email</th><th>Nivel</th><th>Caduca</th><th>Nota</th><th></th></tr></thead><tbody>${st.guests.map((g) => `<tr><td>${esc(g.email)}</td><td>${LEVELS[g.level]}</td><td>${g.expires_at ? fmtDate(g.expires_at) : 'No caduca'}</td><td>${esc(g.note || '')}</td><td><button class="btn ghost sm danger" data-grm="${esc(g.email)}">Quitar</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No hay invitados.</div>'}</section>`;
}

/* ---------- Ajustes de acceso ---------- */
function vAjustes() {
  const s = st.settings;
  if (!s) return '<div class="spin">Cargando…</div>';
  const tiers = s.tiers || [];
  return `<section class="card" style="display:grid;gap:10px"><h3>Guía de uso para personas sin suscripción</h3>
   <p style="margin:0;color:var(--muted);font-size:14px">Si lo activas, quien entre con una cuenta de Patreon sin suscripción de pago podrá ver la Guía de uso (nada más).</p>
   <label class="sw"><input type="checkbox" id="s-guide" ${s.guideOpen ? 'checked' : ''}> Mostrar la guía a cuentas sin suscripción</label>
   <div class="row2"><button class="btn" data-sguide>Guardar</button></div>${note('guide')}</section>
  <section class="sec"><h3>Campaña de Patreon</h3><div class="card" style="display:grid;gap:10px">
   <p style="margin:0;color:var(--muted);font-size:14px">Es la página de CyM Inversores en Patreon. Solo cuentan las suscripciones a esta campaña. Se detecta sola cuando entra la cuenta de creador; también puedes escribirla aquí${s.campaignFromEnv ? ' (ahora mismo viene fijada en la configuración del servidor y no se puede cambiar aquí)' : ''}.</p>
   <div class="frow"><label class="f">ID de campaña<input id="s-camp" value="${esc(s.campaignId || '')}" inputmode="numeric" ${s.campaignFromEnv ? 'disabled' : ''}></label></div>
   ${s.campaignFromEnv ? '' : '<div class="row2"><button class="btn" data-scamp>Guardar</button></div>'}${note('camp')}</div></section>
  <section class="sec"><h3>Niveles de Patreon y qué contenido dan</h3><div class="card" style="display:grid;gap:10px">
   <p style="margin:0;color:var(--muted);font-size:14px">Cada nivel de pago de Patreon se asocia a Esencial, Intermedio o Superior. Por defecto se deduce del nombre del nivel (si contiene «Esencial», «Intermedio» o «Superior»). Si no coincide, elígelo a mano. Los niveles aparecen aquí cuando alguien con ese nivel entra por primera vez.</p>
   ${tiers.length ? `<div style="overflow-x:auto"><table class="atable"><thead><tr><th>Nivel en Patreon</th><th>Precio</th><th>Se deduce</th><th>Asignar a</th></tr></thead><tbody>${tiers.map((t) => `<tr><td>${esc(t.title || t.id)}${t.ours ? '' : ' <span class="tag">otra campaña</span>'}</td><td>${t.amountCents != null ? (t.amountCents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }) : '–'}</td><td>${LEVELS[t.auto]}</td><td><select data-tiermap="${esc(t.id)}"><option value="">Automático</option>${[0, 1, 2, 3].map((n) => `<option value="${n}" ${t.manual === n ? 'selected' : ''}>${LEVELS[n]}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>
   <div class="row2"><button class="btn" data-stiers>Guardar niveles</button></div>` : '<div class="empty">Todavía no se ha visto ningún nivel. Aparecerán cuando entre la primera persona suscrita.</div>'}
   ${note('tiers')}</div></section>
  <section class="sec"><h3>Avisos inmediatos de Patreon (webhook)</h3><div class="card" style="display:grid;gap:6px">
   <p style="margin:0;color:var(--muted);font-size:14px">Con el webhook, una baja o un cambio de nivel se refleja en minutos. Sin él, la web lo comprueba sola cada pocas horas cuando la persona la usa.</p>
   <div><b>Estado:</b> ${s.webhookConfigured ? 'configurado' : 'no configurado'}</div>
   <div><b>Dirección para Patreon:</b> <code>${esc(s.webhookUrl)}</code></div></div></section>`;
}

/* ---------- Personas ---------- */
function vPersonas() {
  return `<div class="frow" style="margin-bottom:12px"><label class="f">Buscar por nombre o email<input id="u-q" type="search" value="${esc(st.uq)}" autocomplete="off"></label></div>
  ${st.users ? (st.users.length ? `<div class="card" style="overflow-x:auto;padding:6px 14px"><table class="atable"><thead><tr><th>Nombre</th><th>Email</th><th>Nivel</th><th>Origen</th><th>Último acceso</th></tr></thead><tbody>${st.users.map((u) => `<tr><td>${esc(u.name || '–')}${u.is_admin ? ' <span class="tag gold">admin</span>' : ''}</td><td>${esc(u.email || '–')}</td><td>${LEVELS[u.level] || u.level}</td><td>${{ patreon: 'Patreon', guest: 'Invitado', admin: 'Admin', dev: 'Prueba', none: '–' }[u.source] || esc(u.source || '–')}</td><td>${fmtTs(u.last_login)}</td></tr>`).join('')}</tbody></table></div><p class="meta" style="margin-top:8px">${st.users.length} personas (máximo 300 por búsqueda).</p>` : '<div class="empty">No hay personas que coincidan.</div>') : '<div class="spin">Cargando…</div>'}`;
}

/* ---------- Registro ---------- */
function vRegistro() {
  if (!st.audit) return '<div class="spin">Cargando…</div>';
  return `<div class="card" style="overflow-x:auto;padding:6px 14px"><table class="atable"><thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th><th>Detalle</th></tr></thead><tbody>${st.audit.map((a) => `<tr><td>${fmtTs(a.at)}</td><td>${esc(a.actor || '–')}</td><td>${esc(ACTIONS[a.action] || a.action)}</td><td class="meta">${a.detail ? esc(JSON.stringify(a.detail)) : ''}</td></tr>`).join('')}</tbody></table></div><p class="meta" style="margin-top:8px">Últimas 60 acciones.</p>`;
}

/* ---------- eventos ---------- */
const val = (id) => root.querySelector('#' + id)?.value ?? '';

async function run(key, fn) {
  if (st.busy) return;
  st.busy = true; delete st.msg[key];
  try { await fn(); } catch (e) { setMsg(key, false, e.message); }
  st.busy = false; draw();
}
const clearForm = (...ids) => ids.forEach((id) => { delete st.form[id]; });

async function onClick(e) {
  const t = e.target.closest('button,[data-tab]');
  if (!t) return;
  const d = t.dataset;
  if (d.tab) { st.tab = d.tab; st.err = null; if (d.tab === 'recursos') st.links = null; draw(); await load(); draw(); return; }
  if (d.view) {
    const kind = d.kind;
    try { st.preview[kind] = await api('GET', `/api/admin/versions/${d.view}`); delete st.msg['k_' + kind]; } catch (err) { setMsg('k_' + kind, false, err.message); }
    draw(); return;
  }
  if (d.closeprev) { delete st.preview[d.closeprev]; draw(); return; }
  if (d.discard) {
    const kind = d.kind;
    await run('k_' + kind, async () => {
      await api('DELETE', `/api/admin/versions/${d.discard}`);
      delete st.preview[kind]; st.ds = await api('GET', '/api/admin/datasets');
      setMsg('k_' + kind, true, 'Borrador descartado. Lo publicado no ha cambiado.');
    });
    return;
  }
  if (d.pub) {
    const kind = d.kind;
    const p = st.preview[kind]; const v = p?.draft || p?.version;
    if (v?.status === 'archived' && !confirm(`Vas a volver a la versión con datos del ${fmtDate(v.date)}. Los suscriptores verán esa versión. ¿Continuar?`)) return;
    await run('k_' + kind, async () => {
      const r = await api('POST', `/api/admin/versions/${d.pub}/publish`);
      delete st.preview[kind]; st.ds = await api('GET', '/api/admin/datasets');
      setMsg('k_' + kind, true, `Publicado. Los suscriptores ya ven los datos del ${fmtDate(r.published.date)}.`);
      ctx?.reloadData?.();
    });
    return;
  }
  if (d.add !== undefined) {
    await run('add', async () => {
      const kind = val('ad-t');
      await api('POST', '/api/admin/watchlist/item', { kind, symbol: val('ad-s'), name: val('ad-n'), sector: val('ad-g'), industry: val('ad-i'), hb: root.querySelector('#ad-hb')?.checked });
      const sym = val('ad-s').trim().toUpperCase();
      clearForm('ad-s', 'ad-n', 'ad-g', 'ad-i', 'ad-hb');
      setMsg('add', true, `${sym} guardado en la lista de ${kind === 'acc' ? 'acciones' : 'ETFs'}. Ya aparece en Listas de seguimiento.`);
      ctx?.reloadData?.();
    });
    return;
  }
  if (d.ladd !== undefined) { (st.links ||= []).push({ t: '', d: '', u: '' }); draw(); return; }
  if (d.lrm !== undefined) { st.links.splice(+d.lrm, 1); draw(); return; }
  if (d.lsave !== undefined) {
    await run('links', async () => {
      const r = await api('PUT', '/api/admin/settings', { links: st.links });
      st.settings = r.settings; st.links = structuredClone(r.settings.links);
      setMsg('links', true, 'Enlaces guardados.');
      ctx?.reloadData?.();
    });
    return;
  }
  if (d.gadd !== undefined) {
    await run('guest', async () => {
      await api('POST', '/api/admin/guests', { email: val('g-e'), level: Number(val('g-l')), expires: val('g-x') || null, note: val('g-n') });
      st.guests = await api('GET', '/api/admin/guests');
      clearForm('g-e', 'g-x', 'g-n'); setMsg('guest', true, 'Invitado guardado.');
    });
    return;
  }
  if (d.grm) {
    if (!confirm(`¿Quitar el acceso de invitado a ${d.grm}?`)) return;
    await run('guest', async () => { await api('DELETE', `/api/admin/guests/${encodeURIComponent(d.grm)}`); st.guests = await api('GET', '/api/admin/guests'); });
    return;
  }
  if (d.sguide !== undefined) {
    await run('guide', async () => {
      const r = await api('PUT', '/api/admin/settings', { guideOpen: root.querySelector('#s-guide').checked });
      st.settings = r.settings; setMsg('guide', true, 'Guardado.');
    });
    return;
  }
  if (d.scamp !== undefined) {
    await run('camp', async () => {
      const r = await api('PUT', '/api/admin/settings', { campaignId: val('s-camp') });
      st.settings = r.settings; setMsg('camp', true, 'Guardado. Se han recalculado los niveles de las personas.');
    });
    return;
  }
  if (d.stiers !== undefined) {
    await run('tiers', async () => {
      const tierMap = {};
      root.querySelectorAll('[data-tiermap]').forEach((el) => { if (el.value !== '') tierMap[el.dataset.tiermap] = Number(el.value); });
      const r = await api('PUT', '/api/admin/settings', { tierMap });
      st.settings = r.settings; setMsg('tiers', true, 'Guardado. Se han recalculado los niveles de las personas.');
    });
  }
}

async function onChange(e) {
  const t = e.target;
  if (t.id && /^(ad|g)-/.test(t.id)) st.form[t.id] = t.type === 'checkbox' ? t.checked : t.value;
  if (t.dataset.upload) {
    const kind = t.dataset.upload; const file = t.files[0];
    if (!file) return;
    st.busy = true; delete st.msg['k_' + kind]; delete st.preview[kind];
    setMsg('k_' + kind, true, `Leyendo «${file.name}»…`); draw();
    try {
      const fd = new FormData(); fd.append('kind', kind); fd.append('file', file);
      st.preview[kind] = await api('POST', '/api/admin/uploads', fd);
      delete st.msg['k_' + kind];
      st.ds = await api('GET', '/api/admin/datasets');
    } catch (err) {
      const det = err.body?.details;
      setMsg('k_' + kind, false, err.message + (Array.isArray(det) && det.length ? ' ' + det.join(' ') : ''));
    }
    st.busy = false; draw();
  }
}

let uqTimer = null;
function onInput(e) {
  const t = e.target; const d = t.dataset;
  if (t.id && /^(ad|g)-/.test(t.id)) st.form[t.id] = t.type === 'checkbox' ? t.checked : t.value;
  if (d.lt !== undefined) st.links[+d.lt].t = t.value;
  else if (d.ld !== undefined) st.links[+d.ld].d = t.value;
  else if (d.lu !== undefined) st.links[+d.lu].u = t.value.trim();
  else if (t.id === 'u-q') {
    st.uq = t.value; clearTimeout(uqTimer);
    uqTimer = setTimeout(async () => {
      try { st.users = await api('GET', '/api/admin/users?q=' + encodeURIComponent(st.uq)); } catch (err) { st.err = err.message; }
      const pos = t.selectionStart; draw(); const el = root.querySelector('#u-q'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* ok */ } }
    }, 300);
  }
}
