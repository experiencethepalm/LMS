/* The Palm Unity — team dashboard (super admin & sales team) */
(() => {
  const C = window.UNITY_CONFIG;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STATUSES = { new: 'New', contacted: 'Contacted', visit_booked: 'Visit booked', visited: 'Visited', negotiating: 'Negotiating', booked: 'Booked ✓', lost: 'Lost' };
  const ROLES = { super_admin: 'Super admin', sales: 'Sales team', channel_partner: 'Channel partner' };
  const KINDS = { call: 'Call', whatsapp: 'WhatsApp', meeting: 'Meeting', site_visit: 'Site visit', other: 'Other' };
  const SECTION_NAMES = { overview: 'Overview', highlights: 'Highlights', gallery: 'Gallery', floorplans: 'Floor plans', payment: 'Payment plan', amenities: 'Amenities', specifications: 'Specs', location: 'Location', visit: 'Visit' };
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };

  let token = store.get('unity_staff');
  let me = null, siteUrl = '', team = [], leadsCache = [], tab = 'followups';

  const ago = (t) => { if (!t) return '—'; const s = Date.now() / 1000 - t; if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; return `${Math.round(s / 86400)} d ago`; };
  const when = (t) => (t ? new Date(t * 1000).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
  const day = (t) => new Date(t * 1000).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = (t) => new Date(t * 1000).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const toast = (m) => { const d = document.createElement('div'); d.className = 'toast'; d.textContent = m; document.body.appendChild(d); setTimeout(() => d.remove(), 2200); };
  const isSuper = () => me && me.role === 'super_admin';
  // datetime-local helpers (local time)
  const toLocalInput = (t) => { const d = new Date(t * 1000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const fromLocalInput = (v) => (v ? Math.floor(new Date(v).getTime() / 1000) : 0);
  const tomorrow11 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(11, 0, 0, 0); return Math.floor(d / 1000); };

  async function api(path, opts = {}) {
    const res = await fetch(C.API_BASE + path, { ...opts, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) } });
    if (res.status === 401 && token) { logout(); throw new Error('Session expired'); }
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Something went wrong');
    return d;
  }

  // ---------- Login: phone + WhatsApp OTP ----------
  let loginPhone = '';
  $('#phoneForm').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#phoneError'); err.textContent = '';
    loginPhone = e.target.elements.phone.value.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').replace(/^0/, '');
    if (!/^[6-9]\d{9}$/.test(loginPhone)) return (err.textContent = 'Enter a valid 10-digit mobile number.');
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      const r = await api('/api/admin/otp/start', { method: 'POST', body: JSON.stringify({ phone: loginPhone }) });
      $('#phoneForm').classList.add('hidden'); $('#codeForm').classList.remove('hidden');
      $('#codeSent').textContent = `Hi ${r.name || ''} — enter the code sent on WhatsApp to +91 ${loginPhone}.`;
      if (r.devCode) { $('#devNote').textContent = `Test mode — code ${r.devCode}`; $('#devNote').classList.remove('hidden'); }
      $('#codeForm').elements.code.focus();
    } catch (ex) { err.textContent = ex.message; }
    btn.disabled = false;
  };
  $('#codeForm').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#codeError'); err.textContent = '';
    try {
      const r = await api('/api/admin/otp/verify', { method: 'POST', body: JSON.stringify({ phone: loginPhone, code: e.target.elements.code.value }) });
      token = r.token; store.set('unity_staff', token); start();
    } catch (ex) { err.textContent = ex.message; }
  };
  $('#codeForm').elements.code.addEventListener('input', (e) => { if (e.target.value.replace(/\D/g, '').length === 6) $('#codeForm').requestSubmit(); });
  $('#changePhone').onclick = (e) => { e.preventDefault(); $('#codeForm').classList.add('hidden'); $('#phoneForm').classList.remove('hidden'); };
  function logout() { store.del('unity_staff'); token = null; location.reload(); }

  async function start() {
    try {
      const r = await api('/api/admin/me');
      me = r.user; siteUrl = r.siteUrl || location.origin + '/';
    } catch { return; }
    $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden');
    $('#who').innerHTML = `<span class="who-full">${esc(me.name)} · <span class="role ${me.role}">${ROLES[me.role]}</span> · <a href="#" class="lnk" data-logout>Sign out</a></span>
      <button class="avatar" id="avatarBtn" aria-label="Account">${esc((me.name || '?').trim().charAt(0).toUpperCase())}</button>
      <div class="acct hidden" id="acctMenu"><b>${esc(me.name)}</b><span class="role ${me.role}">${ROLES[me.role]}</span><span class="small">+91 ${esc(me.phone || '')}</span><a href="#" class="btn ghost sm" data-logout>Sign out</a></div>`;
    $$('[data-logout]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); logout(); }));
    $('#avatarBtn').onclick = (e) => { e.stopPropagation(); $('#acctMenu').classList.toggle('hidden'); };
    document.addEventListener('click', (e) => { if (!e.target.closest('#acctMenu')) $('#acctMenu')?.classList.add('hidden'); });
    await loadTeam();
    renderTabs();
    show(tab);
  }

  async function loadTeam() {
    const r = await api('/api/admin/users');
    team = r.users; siteUrl = r.siteUrl || siteUrl;
  }
  const staff = () => team.filter((u) => u.active && (u.role === 'sales' || u.role === 'super_admin'));
  const partners = () => team.filter((u) => u.role === 'channel_partner');
  const shareLink = (u) => `${siteUrl}?r=${encodeURIComponent(u.share_id)}`;

  const ICONS = {
    followups: '<path d="M12 8v4l3 2"/><circle cx="12" cy="12" r="8"/>',
    clients: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.8-3.2 3-5 5.5-5s4.7 1.8 5.5 5"/><path d="M16 5.5a3 3 0 0 1 0 5.6M17.5 14.3c1.6.7 2.6 2.2 3 4.7"/>',
    partners: '<path d="M8 12l2.5 2.5L16 9"/><path d="M3 12l4-4 3 1 2-2 3 1 6 4-4 5-2-1-2 2-3-1-3-2z"/>',
    requests: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  };
  const ic = (k) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[k] || ICONS.more}</svg>`;
  const SHORT = { followups: 'Follow-ups', clients: 'Clients', partners: 'Partners', requests: 'Requests' };
  let tabList = [];
  function renderTabs() {
    tabList = [['followups', 'Follow-ups'], ['clients', 'Clients'], ['partners', 'Channel partners'], ['requests', 'Visit & callback requests']];
    if (isSuper()) tabList.push(['team', 'Team & roles'], ['activity', 'Team activity'], ['knowledge', 'AI knowledge'], ['integrations', 'CRM integration']);
    const extra = tabList.slice(4);
    $('#mainTabs').innerHTML = tabList.map(([k, v], i) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}${i >= 4 ? ' extra' : ''}">${i < 4 ? `<i class="tab-ic">${ic(k)}</i>` : ''}<span class="t-full">${v}</span><span class="t-short">${SHORT[k] || v}</span>${k === 'followups' ? '<span class="count hidden" id="fuCount"></span>' : ''}</button>`).join('')
      + (extra.length ? `<button class="more-btn" id="moreBtn"><i class="tab-ic">${ic('more')}</i><span class="t-short">More</span></button>` : '');
    $$('#mainTabs button[data-tab]').forEach((b) => (b.onclick = () => show(b.dataset.tab)));
    if ($('#moreBtn')) $('#moreBtn').onclick = () => {
      const d = document.createElement('div'); d.className = 'install-sheet more-sheet';
      d.innerHTML = `<h3>More</h3>${extra.map(([k, v]) => `<button class="more-item" data-go="${k}">${v}</button>`).join('')}<button class="btn ghost sm" data-x style="margin-top:8px">Close</button>`;
      document.body.appendChild(d);
      $$('[data-go]', d).forEach((b) => (b.onclick = () => { d.remove(); show(b.dataset.go); }));
      $('[data-x]', d).onclick = () => d.remove();
    };
  }
  function show(t) {
    tab = t;
    $$('#mainTabs button[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    if ($('#moreBtn')) $('#moreBtn').classList.toggle('on', tabList.findIndex(([k]) => k === t) >= 4);
    window.scrollTo(0, 0);
    ({ followups: viewFollowups, clients: viewClients, partners: viewPartners, requests: viewRequests, team: viewTeam, activity: viewActivity, knowledge: viewKnowledge, integrations: viewIntegrations }[t] || viewFollowups)();
  }

  // ---------- Follow-ups ----------
  let fuWho = null;
  async function viewFollowups() {
    fuWho = fuWho || (isSuper() ? 'all' : 'mine');
    $('#view').innerHTML = `<div class="toolbar"><div class="left">
        <select id="fuWho"><option value="mine">My follow-ups</option><option value="all">Everyone's</option>${staff().map((u) => `<option value="${u.code}">${esc(u.name)}</option>`).join('')}</select>
      </div><button class="btn primary sm" id="fuNew">+ New follow-up</button></div>
      <div id="fuNewBox"></div><div id="fuList"><p class="empty">Loading…</p></div>`;
    $('#fuWho').value = fuWho;
    $('#fuWho').onchange = (e) => { fuWho = e.target.value; loadFollowups(); };
    $('#fuNew').onclick = () => openNewFollowup($('#fuNewBox'));
    loadFollowups();
  }
  async function loadFollowups() {
    const [open, done] = await Promise.all([api(`/api/admin/followups?who=${fuWho}&status=open`), api(`/api/admin/followups?who=${fuWho}&status=done`)]);
    const t = open.now, endToday = (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d / 1000; })();
    const groups = [
      ['overdue', 'Overdue', open.followups.filter((f) => f.due_at < t)],
      ['today', 'Today', open.followups.filter((f) => f.due_at >= t && f.due_at <= endToday)],
      ['upcoming', 'Upcoming', open.followups.filter((f) => f.due_at > endToday)],
      ['done', 'Recently completed', done.followups.slice(0, 30)],
    ];
    const n = groups[0][2].length + groups[1][2].length;
    const c = $('#fuCount'); if (c) { c.textContent = n; c.classList.toggle('hidden', !n); }
    $('#fuList').innerHTML = groups.map(([k, label, items]) => `<div class="fu-group ${k}"><h3>${label} <span class="n">${items.length}</span></h3>
      ${items.map((f) => fuCard(f, t)).join('') || `<p class="small" style="margin:0 0 8px">${k === 'overdue' ? 'Nothing overdue 👍' : 'Nothing here.'}</p>`}</div>`).join('');
    bindFuCards($('#fuList'), loadFollowups);
  }
  function fuCard(f, t = Date.now() / 1000, compact) {
    const late = f.status === 'open' && f.due_at < t;
    const who = f.lead_id ? `<a class="lnk" data-lead="${f.lead_id}">${esc(f.lead_name || 'Client')}</a>` : `<a class="lnk" data-user="${esc(f.partner_code)}">${esc(f.partner_name || 'Channel partner')}</a> <span class="tag tag-cp">Channel partner</span>`;
    const phone = f.lead_phone || f.partner_phone;
    return `<div class="fu ${late ? 'late' : ''}" data-fu="${f.id}">
      <div class="fu-ic">${esc((KINDS[f.kind] || f.kind).slice(0, 4))}</div>
      <div class="fu-main">${compact ? `<b>${KINDS[f.kind] || f.kind}</b>` : `<b>${KINDS[f.kind] || f.kind} · ${who}</b>`}
        <span class="small">${f.status === 'open' ? '' : f.status === 'done' ? `Done ${when(f.done_at)} · ` : `Cancelled · `}Assigned to ${esc(f.assigned_name || '—')}${f.created_name && f.created_name !== f.assigned_name ? ` · by ${esc(f.created_name)}` : ''}${f.lead_status ? ` · ${STATUSES[f.lead_status] || ''}` : ''}</span>
        ${f.note ? `<div class="fu-note">${esc(f.note)}</div>` : ''}
        ${f.outcome ? `<div class="fu-out">↳ ${esc(f.outcome)}</div>` : ''}
      </div>
      <div class="fu-when ${late ? 'late' : ''}">${day(f.due_at)}<br>${time(f.due_at)}</div>
      ${f.status === 'open' ? `<div class="fu-actions">
        ${phone ? `<a class="btn ghost xs" href="tel:+91${esc(phone)}">Call</a><a class="btn ghost xs" href="https://wa.me/91${esc(phone)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        <button class="btn primary xs" data-act="done">Mark done</button>
        <button class="btn ghost xs" data-act="snooze">Tomorrow</button>
        <button class="btn ghost xs" data-act="cancel">Cancel</button>
      </div>` : ''}
    </div>`;
  }
  function bindFuCards(root, reload) {
    $$('[data-lead]', root).forEach((a) => (a.onclick = (e) => { e.preventDefault(); openLead(a.dataset.lead); }));
    $$('[data-user]', root).forEach((a) => (a.onclick = (e) => { e.preventDefault(); openUser(a.dataset.user); }));
    $$('.fu [data-act]', root).forEach((b) => (b.onclick = async () => {
      const card = b.closest('.fu'); const id = card.dataset.fu;
      if (b.dataset.act === 'snooze') { await api(`/api/admin/followups/${id}`, { method: 'PATCH', body: JSON.stringify({ due_at: tomorrow11() }) }); toast('Moved to tomorrow 11 am'); return reload(); }
      if (b.dataset.act === 'cancel') { if (!confirm('Cancel this follow-up?')) return; await api(`/api/admin/followups/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) }); return reload(); }
      if ($('.fu-done-form', card)) return;
      card.insertAdjacentHTML('beforeend', `<form class="fu-done-form form">
        <label>What happened?<textarea name="outcome" rows="2" placeholder="e.g. Interested in Zeal, wants a site visit on Sunday"></textarea></label>
        <div class="grid2"><label>Next follow-up (optional)<input type="datetime-local" name="next"></label>
        <label>Type<select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label></div>
        <div class="btnrow"><button class="btn primary xs">Save</button><button type="button" class="btn ghost xs" data-x>Close</button></div></form>`);
      const f = $('.fu-done-form', card);
      $('[data-x]', f).onclick = () => f.remove();
      f.onsubmit = async (e) => {
        e.preventDefault();
        await api(`/api/admin/followups/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done', outcome: f.elements.outcome.value, next_due_at: fromLocalInput(f.elements.next.value) || undefined, next_kind: f.elements.kind.value }) });
        toast('Follow-up completed'); reload();
      };
    }));
  }
  async function openNewFollowup(box, preset = {}) {
    if (!leadsCache.length) leadsCache = (await api('/api/admin/leads')).leads;
    box.innerHTML = `<form class="box form" id="nfu">
      <h4>New follow-up</h4>
      ${preset.lead_id || preset.partner_code ? '' : `<label>With<select name="target"><optgroup label="Clients">${leadsCache.map((l) => `<option value="lead:${l.id}">${esc(l.name)} · ${esc(l.phone)}</option>`).join('')}</optgroup><optgroup label="Channel partners">${partners().map((p) => `<option value="cp:${p.code}">${esc(p.name)}${p.company ? ` · ${esc(p.company)}` : ''}</option>`).join('')}</optgroup></select></label>`}
      <div class="grid2"><label>Type<select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label>When<input type="datetime-local" name="due" value="${toLocalInput(tomorrow11())}" required></label></div>
      <label>Assign to<select name="assigned">${staff().map((u) => `<option value="${u.code}" ${u.code === me.code ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
      <label>Note<textarea name="note" rows="2" placeholder="e.g. Share Nova penthouse plan and cost sheet"></textarea></label>
      <p class="error"></p>
      <div class="btnrow"><button class="btn primary sm">Add follow-up</button><button type="button" class="btn ghost sm" data-x>Cancel</button></div></form>`;
    const f = $('#nfu', box);
    $('[data-x]', f).onclick = () => (box.innerHTML = '');
    f.onsubmit = async (e) => {
      e.preventDefault();
      const tgt = preset.lead_id ? `lead:${preset.lead_id}` : preset.partner_code ? `cp:${preset.partner_code}` : f.elements.target.value;
      const body = { kind: f.elements.kind.value, due_at: fromLocalInput(f.elements.due.value), note: f.elements.note.value, assigned_to: f.elements.assigned.value };
      if (tgt.startsWith('lead:')) body.lead_id = Number(tgt.slice(5)); else body.partner_code = tgt.slice(3);
      try { await api('/api/admin/followups', { method: 'POST', body: JSON.stringify(body) }); box.innerHTML = ''; toast('Follow-up added'); preset.after ? preset.after() : loadFollowups(); }
      catch (ex) { $('.error', f).textContent = ex.message; }
    };
  }

  // ---------- Clients ----------
  let clientScope = 'all';
  async function viewClients() {
    $('#view').innerHTML = `<div class="toolbar"><div class="left">
        <input id="q" placeholder="Search name or number" />
        <select id="fScope"><option value="all">All clients</option><option value="mine">My clients</option><option value="partners">Via channel partners</option><option value="unassigned">Unassigned</option><option value="internal">Team & test entries (hidden)</option>${staff().map((u) => `<option value="user:${u.code}">${esc(u.name)}'s clients</option>`).join('')}${partners().map((u) => `<option value="user:${u.code}">Via ${esc(u.name)}</option>`).join('')}</select>
        <select id="fPri"><option value="">All priorities</option><option>P0</option><option>P1</option><option>P2</option><option>P3</option><option>P4</option></select>
        <select id="fStatus"><option value="">All statuses</option>${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      </div><div class="btnrow tb-actions"><button class="btn ghost sm" id="refresh" aria-label="Refresh">↻<span class="t-full"> Refresh</span></button><button class="btn ghost sm" id="exportCsv" aria-label="Export CSV">⤓<span class="t-full"> Export CSV</span></button></div></div>
      <div class="stats" id="stats"></div>
      <table class="list"><thead><tr><th>Priority</th><th>Client</th><th class="hide-m">Came via</th><th class="hide-m">Signals</th><th class="hide-m">Status</th><th class="hide-m">Next follow-up</th></tr></thead><tbody id="leadRows"></tbody></table>`;
    $('#fScope').value = clientScope;
    ['#q', '#fPri', '#fStatus'].forEach((s) => $(s).addEventListener('input', renderLeads));
    $('#fScope').onchange = (e) => { clientScope = e.target.value; loadLeads(); };
    $('#refresh').onclick = loadLeads;
    $('#exportCsv').onclick = async () => {
      const res = await fetch(C.API_BASE + '/api/admin/export.csv', { headers: { authorization: `Bearer ${token}` } });
      const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = 'unity-clients.csv'; a.click();
    };
    loadLeads();
  }
  async function loadLeads() {
    const d = await api(`/api/admin/leads?scope=${encodeURIComponent(clientScope)}`);
    leadsCache = clientScope === 'all' ? d.leads : leadsCache;
    window.__leads = d.leads; renderLeads();
  }
  function renderLeads() {
    const leads = window.__leads || [];
    const q = $('#q').value.toLowerCase().trim(), pr = $('#fPri').value, st = $('#fStatus').value;
    const rows = leads.filter((l) => (!q || l.name.toLowerCase().includes(q) || l.phone.includes(q)) && (!pr || l.priority === pr) && (!st || l.status === st));
    const dayAgo = Date.now() / 1000 - 86400;
    $('#stats').innerHTML = [
      ['Clients', leads.length], ['New today', leads.filter((l) => l.created_at > dayAgo).length], ['Hot (P0–P1)', leads.filter((l) => ['P0', 'P1'].includes(l.priority)).length],
      ['Follow-up overdue', leads.filter((l) => l.overdue).length], ['Via channel partners', leads.filter((l) => l.source_user_role === 'channel_partner').length], ['Via family/friends', leads.filter((l) => l.referred_by).length],
    ].map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');
    $('#leadRows').innerHTML = rows.map((l) => `<tr class="row" data-id="${l.id}">
        <td><span class="pri ${l.priority}">${l.priority}</span><span class="bar"><i style="width:${l.score}%"></i></span></td>
        <td><b>${esc(l.name)}</b><br><span class="small">+91 ${esc(l.phone)}${l.assigned_name ? ` · ${esc(l.assigned_name)}` : ' · Unassigned'}</span>
          <div class="m-only m-meta"><span>${STATUSES[l.status] || l.status}</span>${l.verified_at ? '' : '<span class="od">Not verified yet</span>'}${l.crm_id ? `<span class="tag">CRM ${esc(l.crm_id)}</span>` : ''}${l.next_followup ? `<span class="${l.overdue ? 'od' : ''}">Next: ${when(l.next_followup)}</span>` : '<span class="od">No follow-up</span>'}${l.source_user_role === 'channel_partner' ? `<span class="tag tag-cp">${esc(l.source_user_name)}</span>` : ''}${l.referred_by_name ? `<span class="tag tag-via">via ${esc(l.referred_by_name)}</span>` : ''}${l.openRequests.length ? '<span class="tag">Wants visit/call</span>' : ''}</div></td>
        <td class="hide-m">${l.crm_id ? `<span class="tag">CRM ${esc(l.crm_id)}</span>` : ''}${l.verified_at ? '' : '<span class="tag tag-red">Not verified yet</span>'}${l.referred_by_name ? `<span class="tag tag-via">via ${esc(l.referred_by_name)}</span>` : ''}${l.source_user_role === 'channel_partner' ? `<span class="tag tag-cp">${esc(l.source_user_name)}</span>` : l.source_user_name ? `<span class="small">${esc(l.source_user_name)}</span>` : l.referred_by_name ? '' : '<span class="small">Direct</span>'}</td>
        <td class="hide-m">${l.openRequests.map((r) => `<span class="tag">${r === 'site_visit' ? 'Wants visit' : 'Callback'}</span>`).join('')}${l.sessions > 1 ? `<span class="tag">${l.sessions} visits</span>` : ''}${l.questions ? `<span class="tag">${l.questions} questions</span>` : ''}${l.referrals ? `<span class="tag tag-share">Brought ${l.referrals}</span>` : l.link_opens ? `<span class="tag tag-share">Shared · ${l.link_opens} opened</span>` : ''}</td>
        <td class="hide-m">${STATUSES[l.status] || l.status}</td>
        <td class="hide-m small">${l.next_followup ? `<span class="${l.overdue ? 'tag tag-red' : ''}">${when(l.next_followup)}</span>` : '<span class="tag tag-red" style="background:#F1F1EF;color:#888">None planned</span>'}</td>
      </tr>`).join('') || `<tr><td colspan="6" class="empty">No clients here yet.</td></tr>`;
    $$('#leadRows tr.row').forEach((tr) => (tr.onclick = () => openLead(tr.dataset.id)));
  }

  async function openLead(id) {
    const d = await api(`/api/admin/leads/${id}`);
    const l = d.lead;
    const maxDwell = Math.max(1, ...Object.values(d.dwell));
    const tlLabel = (e) => ({
      arrived_via: `Received the link from ${e.target}`, share_open: 'Someone opened the link they shared (not verified yet)', share_open_verified: `${e.target} opened the link they shared`,
      referral_verified: `${e.target} verified via their link`, session_start: 'Opened the page', floorplan_open: `Opened floor plan: ${e.target}`, brochure_open: 'Opened the brochure',
      gallery_open: 'Viewed a photo', walkthrough_play: 'Played the walkthrough', cta: e.target === 'share' ? 'Tapped Share' : `Tapped ${e.target}`,
      crm_created: 'Added from the CRM', invite_open: 'Opened their personal link', map: (e.target || '').startsWith('place:') ? `Checked commute to ${e.target.slice(6)}` : `Viewed nearby ${(e.target || '').slice(4)} on map`, staff: e.target,
    }[e.type] || e.type);
    const wa = `https://wa.me/91${l.phone}?text=${encodeURIComponent(d.openingLine)}`;
    const t = Date.now() / 1000;
    const src = d.source ? `${esc(d.source.name)} <span class="role ${d.source.role || 'sales'}">${ROLES[d.source.role || 'sales']}</span>${d.source.company ? ` · ${esc(d.source.company)}` : ''}` : (d.network.referrer ? 'Family/friend link' : 'Direct');
    drawer(`
      <div style="display:flex;justify-content:space-between;align-items:start">
        <div><span class="pri ${d.priority}">${d.priority}</span> <span class="small">Score ${d.score}/100</span><h2>${esc(l.name)}</h2></div>
        <button class="icon-btn" data-close>✕</button>
      </div>
      <div class="btnrow" style="margin:10px 0">
        <a class="btn primary sm" href="tel:+91${esc(l.phone)}">Call +91 ${esc(l.phone)}</a>
        <a class="btn ghost sm" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>
      </div>
      ${l.is_internal ? `<div class="box internal-note"><b>Hidden from the client list</b><p class="small" style="margin:4px 0 8px">${l.staff_match && l.internal !== 1 ? `This number belongs to ${esc(l.staff_match)} on the team, so it's treated as a team entry.` : 'Marked as a team member or test entry.'}</p><button class="btn ghost xs" id="toClient">Move back to clients</button></div>` : ''}
      <div class="box opening"><h4>Suggested opening line</h4>${esc(d.openingLine)}</div>
      <div class="kv">
        <span>Came via</span><b>${src}${d.source && d.source.role === 'channel_partner' ? ` <a class="lnk" data-user="${esc(d.source.code)}">View</a>` : ''}</b>
        <span>Assigned to</span><b><select id="assignSel" style="padding:6px 10px;width:auto"><option value="">Unassigned</option>${staff().map((u) => `<option value="${u.code}" ${d.assigned && d.assigned.code === u.code ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></b>
        ${l.crm_id ? `<span>CRM lead ID</span><b>${esc(l.crm_id)}</b>` : ''}
        ${l.invite_id ? `<span>Personal link</span><b><span class="linkbox"><input readonly value="${esc(siteUrl + '?i=' + l.invite_id)}"><button class="btn ghost xs" data-copy="${esc(siteUrl + '?i=' + l.invite_id)}">Copy link</button></span></b>` : ''}
        ${l.verified_at ? '' : '<span>WhatsApp</span><b><span class="tag tag-red">Not verified yet</span></b>'}
        ${l.email ? `<span>Email</span><b>${esc(l.email)}</b>` : ''}
        <span>Profession</span><b>${esc(l.profession || '—')}</b>
        <span>First verified</span><b>${when(l.created_at)}</b>
        <span>Visits</span><b>${l.sessions} · last ${ago(l.last_seen)}</b>
      </div>
      <div class="box"><h4>Follow-ups <button class="btn ghost xs" id="addFu">+ Add</button></h4><div id="fuNewLead"></div>
        <div id="leadFus">${d.followups.map((f) => fuCard({ ...f, lead_id: null, partner_code: null }, t, true)).join('') || '<p class="small" style="margin:0">No follow-ups yet — add one so this client is not forgotten.</p>'}</div></div>
      ${d.requests.length ? `<div class="box"><h4>Requests</h4>${d.requests.map((r) => `<div class="tl"><span>${r.kind === 'site_visit' ? '🏠 Site visit' : '📞 Callback'} ${esc(r.preferred_date || '')} ${esc(r.slot || '')}${r.message ? ' — ' + esc(r.message) : ''}</span><span>${r.handled ? 'Handled' : 'Open'}</span></div>`).join('')}</div>` : ''}
      <div class="box"><h4>Status & notes</h4>
        <form id="leadForm" class="form">
          <label>Status<select name="status">${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${k === l.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Notes<textarea name="notes" rows="3">${esc(l.notes || '')}</textarea></label>
          <div class="btnrow"><button class="btn primary sm">Save</button>${l.is_internal ? '' : '<button type="button" class="btn ghost sm" id="toInternal">Mark as team / test entry</button>'}</div>
        </form></div>
      ${l.staff_match ? '' : `<div class="box"><h4>Channel partner?</h4><p class="small" style="margin:0 0 10px">If ${esc(l.name)} is a broker or agent, make them a channel partner. They get their own tracked share link, move to the Channel partners list and leave the client list.</p>
        <div id="cpBox"><button class="btn ghost sm" id="toCp">Mark as channel partner</button></div></div>`}
      ${(d.network.referrer || d.network.opens || d.network.referees.length) ? `<div class="box"><h4>Family & friends</h4>
        ${d.network.referrer ? `<div class="tl"><span>Came via</span><span><a class="lnk" data-lead="${d.network.referrer.id}">${esc(d.network.referrer.name)}</a></span></div>` : ''}
        ${d.network.opens ? `<div class="tl"><span>Their shared link was opened</span><span>${d.network.opens} ${d.network.opens === 1 ? 'person' : 'people'}${d.network.unverifiedOpens ? ` · ${d.network.unverifiedOpens} not verified yet` : ''}</span></div>` : ''}
        ${d.network.referees.map((r) => `<div class="tl"><span><a class="lnk" data-lead="${r.id}">${esc(r.name)}</a> verified</span><span>${STATUSES[r.status] || r.status} · ${when(r.created_at)}</span></div>`).join('')}
      </div>` : ''}
      <div class="box"><h4>Why this score</h4>${d.parts.map((p) => `<div class="tl"><span>${esc(p.label)}</span><span>${p.pts > 0 ? '+' : ''}${p.pts}</span></div>`).join('') || '<p class="small">Only verified so far.</p>'}</div>
      <div class="box"><h4>Time spent by section</h4>${Object.entries(d.dwell).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="dwell-row"><span>${SECTION_NAMES[k] || esc(k)}</span><span class="bar"><i style="width:${(v / maxDwell) * 100}%"></i></span><span>${v >= 60 ? Math.round(v / 60) + ' min' : v + ' s'}</span></div>`).join('') || '<p class="small">No browsing recorded yet.</p>'}</div>
      ${d.chats.length ? `<div class="box"><h4>Questions to the assistant</h4><div class="chatbox">${d.chats.map((c) => `<div class="msg ${c.role}">${esc(c.content)}</div>`).join('')}</div></div>` : ''}
      <div class="box"><h4>Journey</h4>${d.timeline.slice(0, 80).map((e) => `<div class="tl ${e.type === 'staff' ? 'staff' : ''}"><span>${esc(tlLabel(e))}</span><span>${when(e.ts)}</span></div>`).join('')}</div>
      ${isSuper() ? `<div class="box danger"><h4>Delete client</h4><p class="small" style="margin:0 0 10px">Removes ${esc(l.name)} and their journey, questions, requests and follow-ups. This can't be undone.</p>
        <div id="delBox"><button class="btn danger sm" id="delLead">Delete this client</button></div></div>` : ''}`);
    const reopen = () => openLead(id);
    bindCopy($('#drawer'));
    if ($('#delLead')) $('#delLead').onclick = () => {
      $('#delBox').innerHTML = `<p class="small" style="margin:0 0 8px">Type <b>DELETE</b> to confirm.</p><div class="btnrow"><input id="delTxt" autocomplete="off" style="max-width:160px"><button class="btn danger sm" id="delGo" disabled>Delete permanently</button><button class="btn ghost sm" id="delNo">Keep</button></div>`;
      $('#delTxt').focus();
      $('#delTxt').oninput = (e) => ($('#delGo').disabled = e.target.value.trim().toUpperCase() !== 'DELETE');
      $('#delNo').onclick = reopen;
      $('#delGo').onclick = async () => {
        $('#delGo').disabled = true;
        try { await api(`/api/admin/leads/${id}`, { method: 'DELETE' }); toast(`${l.name} deleted`); closeDrawer(); leadsCache = []; if (tab === 'clients') loadLeads(); }
        catch (ex) { toast(ex.message); $('#delGo').disabled = false; }
      };
    };
    bindFuCards($('#leadFus'), reopen);
    $('#addFu').onclick = () => openNewFollowup($('#fuNewLead'), { lead_id: Number(id), after: reopen });
    const setInternal = async (v) => {
      await api(`/api/admin/leads/${id}`, { method: 'PATCH', body: JSON.stringify({ internal: v }) });
      toast(v ? `${l.name} hidden from the client list` : `${l.name} is back in the client list`);
      if (tab === 'clients') loadLeads();
      v ? closeDrawer() : reopen();
    };
    if ($('#toInternal')) $('#toInternal').onclick = () => setInternal(true);
    if ($('#toCp')) $('#toCp').onclick = () => {
      $('#cpBox').innerHTML = `<form class="form" id="cpForm"><label>Firm / company (optional)<input name="company" placeholder="e.g. Shree Realty"></label><p class="error"></p><div class="btnrow"><button class="btn primary sm">Make channel partner</button><button type="button" class="btn ghost sm" id="cpNo">Cancel</button></div></form>`;
      $('#cpNo').onclick = reopen;
      $('#cpForm').onsubmit = async (e) => {
        e.preventDefault();
        try {
          const r = await api(`/api/admin/leads/${id}/partner`, { method: 'POST', body: JSON.stringify({ company: e.target.elements.company.value }) });
          toast(`${l.name} is now a channel partner`); await loadTeam(); if (tab === 'clients') loadLeads(); openUser(r.code);
        } catch (ex) { $('#cpForm .error').textContent = ex.message; }
      };
    };
    if ($('#toClient')) $('#toClient').onclick = () => setInternal(false);
    $('#assignSel').onchange = async (e) => { await api(`/api/admin/leads/${id}`, { method: 'PATCH', body: JSON.stringify({ assigned_to: e.target.value }) }); toast('Assignment saved'); };
    $('#leadForm').onsubmit = async (e) => {
      e.preventDefault();
      await api(`/api/admin/leads/${id}`, { method: 'PATCH', body: JSON.stringify({ status: e.target.elements.status.value, notes: e.target.elements.notes.value }) });
      toast('Saved'); if (tab === 'clients') loadLeads(); reopen();
    };
  }

  // ---------- Channel partners ----------
  async function viewPartners() {
    await loadTeam();
    const list = partners();
    $('#view').innerHTML = `<div class="toolbar"><div class="left"><input id="pq" placeholder="Search partner, firm or number" /></div><div class="btnrow"><button class="btn ghost sm" id="importCp">Import list</button><button class="btn primary sm" id="addCp">+ Add channel partner</button></div></div>
      <div id="cpForm"></div>
      <table class="list"><thead><tr><th>Channel partner</th><th class="hide-m">Clients</th><th class="hide-m">Link opens</th><th class="hide-m">Added by</th><th>Share link</th></tr></thead><tbody id="cpRows"></tbody></table>`;
    const draw = () => {
      const q = $('#pq').value.toLowerCase().trim();
      const rows = list.filter((p) => !q || [p.name, p.company, p.phone].some((x) => (x || '').toLowerCase().includes(q)));
      $('#cpRows').innerHTML = rows.map((p) => `<tr class="row" data-code="${p.code}" style="${p.active ? '' : 'opacity:.5'}">
          <td><b>${esc(p.name)}</b>${p.active ? '' : ' <span class="tag">Inactive</span>'}<br><span class="small">${esc(p.company || '—')} · ${p.phone ? `+91 ${esc(p.phone)}` : 'No number'}</span></td>
          <td class="hide-m">${p.clients}</td><td class="hide-m">${p.link_opens}</td><td class="hide-m small">${esc(p.created_by_name || '—')}</td>
          <td><button class="btn ghost xs" data-copy="${esc(shareLink(p))}">Copy link</button></td></tr>`).join('') || `<tr><td colspan="5" class="empty">No channel partners yet. Add one to give them a tracked link.</td></tr>`;
      $$('#cpRows tr.row').forEach((tr) => (tr.onclick = (e) => { if (e.target.closest('[data-copy]')) return; openUser(tr.dataset.code); }));
      bindCopy($('#cpRows'));
    };
    $('#pq').oninput = draw; draw();
    $('#addCp').onclick = () => userForm($('#cpForm'), { role: 'channel_partner' }, viewPartners);
    $('#importCp').onclick = () => importPartners($('#cpForm'));
  }
  function parsePartnerList(text) {
    return text.split(/\r?\n/).map((line) => {
      const cells = line.split(/\t|,|;/).map((c) => c.trim()).filter(Boolean);
      const pi = cells.findIndex((c) => c.replace(/\D/g, '').length >= 10);
      if (pi < 0) return null;
      const rest = cells.filter((c, i) => i !== pi && !/^\d{1,3}$/.test(c));
      return { name: rest[0] || '', company: rest[1] || '', phone: cells[pi] };
    }).filter((r) => r && r.name && !/^cp name$/i.test(r.name));
  }
  function importPartners(box) {
    box.innerHTML = `<div class="box form" id="impBox"><h4>Import channel partners</h4>
      <p class="small" style="margin:0">Copy the rows from Excel (name, firm, mobile number) and paste them here. Each partner gets a tracked share link. Numbers already in the system are not duplicated.</p>
      <textarea id="impTxt" rows="7" placeholder="Smit Sathvara	Gruham Properties	9601010763"></textarea>
      <p class="small" id="impCount" style="margin:0"></p><p class="error"></p>
      <div class="btnrow"><button class="btn primary sm" id="impGo" disabled>Import</button><button class="btn ghost sm" data-x>Cancel</button></div></div>`;
    const b = $('#impBox'); let rows = [];
    $('[data-x]', b).onclick = () => (box.innerHTML = '');
    $('#impTxt').oninput = (e) => { rows = parsePartnerList(e.target.value); $('#impCount').textContent = rows.length ? `${rows.length} partner${rows.length === 1 ? '' : 's'} found` : ''; $('#impGo').disabled = !rows.length; };
    $('#impGo').onclick = async () => {
      $('#impGo').disabled = true;
      try {
        const r = await api('/api/admin/users/bulk', { method: 'POST', body: JSON.stringify({ partners: rows }) });
        const tsv = ['Name\tFirm\tMobile\tLink'].concat(r.results.map((x) => [x.name, x.company || '', x.phone, x.link || x.reason || ''].join('\t'))).join('\n');
        box.innerHTML = `<div class="box"><h4>${r.added} added · ${r.results.filter((x) => x.status === 'existing').length} already in the system${r.results.some((x) => x.status === 'skipped') ? ` · ${r.results.filter((x) => x.status === 'skipped').length} skipped` : ''}</h4>
          <div class="btnrow" style="margin-bottom:8px"><button class="btn primary xs" id="impCopy">Copy table for Excel</button><button class="btn ghost xs" data-x>Close</button></div>
          ${r.results.map((x) => `<div class="tl"><span><b>${esc(x.name)}</b>${x.company ? ` · ${esc(x.company)}` : ''}<br><span class="small">${x.status === 'skipped' ? esc(x.reason) : esc(x.link)}</span></span><span>${x.status === 'added' ? 'Added' : x.status === 'existing' ? 'Existing' : 'Skipped'}</span></div>`).join('')}</div>`;
        $('#impCopy').onclick = () => navigator.clipboard.writeText(tsv).then(() => toast('Copied — paste into Excel'));
        $('[data-x]', box).onclick = () => viewPartners();
        await loadTeam();
      } catch (ex) { $('.error', b).textContent = ex.message; $('#impGo').disabled = false; }
    };
  }
  function bindCopy(root) { $$('[data-copy]', root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); navigator.clipboard.writeText(b.dataset.copy).then(() => { b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy link'), 1500); }); })); }

  function userForm(box, u = {}, after) {
    const canRole = isSuper();
    box.innerHTML = `<form class="box form" id="uf"><h4>${u.code ? 'Edit' : 'Add'} ${u.role === 'channel_partner' && !canRole ? 'channel partner' : 'user'}</h4>
      <div class="grid2"><label>Name<input name="name" value="${esc(u.name || '')}" required></label>
      <label>Mobile number <i>(optional for channel partners)</i><input name="phone" inputmode="numeric" value="${esc(u.phone || '')}" placeholder="98765 43210"></label></div>
      <div class="grid2">${canRole ? `<label>User type<select name="role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === (u.role || 'sales') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}
      <label>Firm / company <i>(channel partners)</i><input name="company" value="${esc(u.company || '')}"></label></div>
      ${u.code ? `<label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" name="active" style="width:auto" ${u.active ? 'checked' : ''}> Active</label>` : ''}
      <p class="small" style="margin:0">${canRole ? 'Super admins and sales team sign in with this number using a WhatsApp code. Channel partners get a tracked share link.' : 'The partner gets a tracked share link; clients who verify through it are credited to them.'}</p>
      <p class="error"></p>
      <div class="btnrow"><button class="btn primary sm">Save</button><button type="button" class="btn ghost sm" data-x>Cancel</button></div></form>`;
    const f = $('#uf', box);
    $('[data-x]', f).onclick = () => (box.innerHTML = '');
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = { code: u.code, name: f.elements.name.value, phone: f.elements.phone.value, company: f.elements.company.value, role: canRole ? f.elements.role.value : 'channel_partner', active: f.elements.active ? f.elements.active.checked : true };
      try { await api('/api/admin/users', { method: 'POST', body: JSON.stringify(body) }); toast('Saved'); box.innerHTML = ''; await loadTeam(); after && after(); }
      catch (ex) { $('.error', f).textContent = ex.message; }
    };
  }

  async function openUser(code) {
    const d = await api(`/api/admin/users/${code}`);
    const u = d.user; const t = Date.now() / 1000;
    const editable = isSuper() || u.role === 'channel_partner';
    drawer(`
      <div style="display:flex;justify-content:space-between;align-items:start">
        <div><span class="role ${u.role}">${ROLES[u.role]}</span>${u.active ? '' : ' <span class="tag">Inactive</span>'}<h2>${esc(u.name)}</h2>${u.company ? `<p class="small" style="margin:2px 0 0">${esc(u.company)}</p>` : ''}</div>
        <button class="icon-btn" data-close>✕</button>
      </div>
      <div class="btnrow" style="margin:10px 0">${u.phone ? `<a class="btn primary sm" href="tel:+91${esc(u.phone)}">Call +91 ${esc(u.phone)}</a><a class="btn ghost sm" href="https://wa.me/91${esc(u.phone)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${editable ? '<button class="btn ghost sm" id="editU">Edit</button>' : ''}</div>
      <div id="editBox"></div>
      <div class="kv">
        <span>Share link</span><b><span class="linkbox"><input readonly value="${esc(shareLink(u))}"><button class="btn ghost xs" data-copy="${esc(shareLink(u))}">Copy link</button></span></b>
        <span>Added by</span><b>${esc(u.created_by_name || '—')} · ${when(u.created_at)}</b>
        ${u.client_record ? `<span>Was a client</span><b><a class="lnk" data-lead="${u.client_record.id}">View their journey</a></b>` : ''}
        ${u.role !== 'channel_partner' ? `<span>Last sign-in</span><b>${when(u.last_login)}</b>` : ''}
        <span>Link opened by</span><b>${d.opens} ${d.opens === 1 ? 'person' : 'people'}${d.unverifiedOpens ? ` · ${d.unverifiedOpens} not verified yet` : ''}</b>
      </div>
      ${u.role === 'channel_partner' ? `<div class="box"><h4>Follow-ups with this partner <button class="btn ghost xs" id="addFuU">+ Add</button></h4><div id="fuNewU"></div>
        <div id="uFus">${d.followups.filter((f) => f.partner_code === u.code).map((f) => fuCard({ ...f, lead_id: null, partner_code: null }, t, true)).join('') || '<p class="small" style="margin:0">None yet.</p>'}</div></div>` : ''}
      <div class="box"><h4>Clients ${u.role === 'channel_partner' ? 'brought in' : 'from their link'} (${d.clients.length})</h4>${d.clients.map((c) => `<div class="tl"><span><a class="lnk" data-lead="${c.id}">${esc(c.name)}</a> · +91 ${esc(c.phone)}</span><span>${STATUSES[c.status] || c.status} · ${ago(c.last_seen)}</span></div>`).join('') || '<p class="small" style="margin:0">No verified clients yet.</p>'}</div>
      ${d.assigned.length ? `<div class="box"><h4>Assigned clients (${d.assigned.length})</h4>${d.assigned.map((c) => `<div class="tl"><span><a class="lnk" data-lead="${c.id}">${esc(c.name)}</a></span><span>${STATUSES[c.status] || c.status} · ${ago(c.last_seen)}</span></div>`).join('')}</div>` : ''}
      ${u.role !== 'channel_partner' && d.followups.length ? `<div class="box"><h4>Their follow-ups</h4>${d.followups.slice(0, 40).map((f) => `<div class="tl"><span>${KINDS[f.kind] || f.kind} · ${esc(f.lead_name || '')} ${f.status === 'open' ? (f.due_at < t ? '<span class="tag tag-red">Overdue</span>' : '') : `<span class="tag">${f.status}</span>`}</span><span>${when(f.due_at)}</span></div>`).join('')}</div>` : ''}
      ${d.activity.length ? `<div class="box feed"><h4>Activity</h4>${d.activity.map((a) => `<div class="tl"><span><b>${esc(a.user_name || '')}</b> ${esc(a.detail || a.action)}</span><span>${when(a.ts)}</span></div>`).join('')}</div>` : ''}
      ${isSuper() && u.code !== me.code ? `<div class="box danger"><h4>Delete ${u.role === 'channel_partner' ? 'channel partner' : 'user'}</h4><p class="small" style="margin:0 0 10px">Removes ${esc(u.name)}'s login and share link. Their clients stay in the system and become unassigned; their open follow-ups move to you. This can't be undone.</p>
        <div id="delUBox"><button class="btn danger sm" id="delUser">Delete ${esc(u.name)}</button></div></div>` : ''}`);
    bindCopy($('#drawer'));
    const reopen = () => openUser(code);
    if ($('#delUser')) $('#delUser').onclick = () => {
      $('#delUBox').innerHTML = `<p class="small" style="margin:0 0 8px">Type <b>DELETE</b> to confirm.</p><div class="btnrow"><input id="delUTxt" autocomplete="off" style="max-width:160px"><button class="btn danger sm" id="delUGo" disabled>Delete permanently</button><button class="btn ghost sm" id="delUNo">Keep</button></div>`;
      $('#delUTxt').focus();
      $('#delUTxt').oninput = (e) => ($('#delUGo').disabled = e.target.value.trim().toUpperCase() !== 'DELETE');
      $('#delUNo').onclick = reopen;
      $('#delUGo').onclick = async () => {
        $('#delUGo').disabled = true;
        try { await api(`/api/admin/users/${code}`, { method: 'DELETE' }); toast(`${u.name} deleted`); closeDrawer(); await loadTeam(); if (['team', 'partners'].includes(tab)) show(tab); }
        catch (ex) { toast(ex.message); $('#delUGo').disabled = false; }
      };
    };
    if ($('#uFus')) bindFuCards($('#uFus'), reopen);
    if ($('#addFuU')) $('#addFuU').onclick = () => openNewFollowup($('#fuNewU'), { partner_code: u.code, after: reopen });
    if ($('#editU')) $('#editU').onclick = () => userForm($('#editBox'), u, () => { reopen(); if (tab === 'partners' || tab === 'team') show(tab); });
  }

  // ---------- Requests ----------
  async function viewRequests() {
    const d = await api('/api/admin/requests');
    $('#view').innerHTML = `<table class="list" style="margin-top:16px"><thead><tr><th>Type</th><th>Client</th><th>Preferred</th><th class="hide-m">Note</th><th class="hide-m">Assigned</th><th class="hide-m">Received</th><th></th></tr></thead><tbody>
      ${d.requests.map((r) => `<tr style="${r.handled ? 'opacity:.5' : ''}">
        <td>${r.kind === 'site_visit' ? '🏠 Visit' : '📞 Callback'}</td>
        <td><a class="lnk" data-lead="${r.lead_id}">${esc(r.name)}</a><br><a class="small" href="tel:+91${esc(r.phone)}">+91 ${esc(r.phone)}</a></td>
        <td>${esc(r.preferred_date || '')} ${esc(r.slot || '')}</td><td class="hide-m small">${esc(r.message || '')}</td>
        <td class="hide-m small">${esc(r.assigned_name || '—')}</td><td class="hide-m small">${ago(r.created_at)}</td>
        <td>${r.handled ? 'Done' : `<button class="btn ghost xs" data-done="${r.id}">Mark done</button>`}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No requests yet.</td></tr>'}</tbody></table>`;
    $$('[data-lead]', $('#view')).forEach((a) => (a.onclick = (e) => { e.preventDefault(); openLead(a.dataset.lead); }));
    $$('[data-done]').forEach((b) => (b.onclick = async () => { await api(`/api/admin/requests/${b.dataset.done}`, { method: 'PATCH' }); viewRequests(); }));
  }

  // ---------- Team & roles (super admin) ----------
  async function viewTeam() {
    await loadTeam();
    $('#view').innerHTML = `<div class="toolbar"><div class="left"><select id="tRole"><option value="">All user types</option>${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div><button class="btn primary sm" id="addU">+ Add user</button></div>
      <div id="uForm"></div>
      <table class="list"><thead><tr><th>User</th><th>Type</th><th class="hide-m">Clients</th><th class="hide-m">Open follow-ups</th><th class="hide-m">Last active</th><th></th></tr></thead><tbody id="tRows"></tbody></table>`;
    const draw = () => {
      const r = $('#tRole').value;
      $('#tRows').innerHTML = team.filter((u) => !r || u.role === r).map((u) => `<tr class="row" data-code="${u.code}" style="${u.active ? '' : 'opacity:.5'}">
        <td><b>${esc(u.name)}</b>${u.code === me.code ? ' <span class="small">(you)</span>' : ''}<br><span class="small">${u.phone ? `+91 ${esc(u.phone)}` : 'No number'}${u.company ? ` · ${esc(u.company)}` : ''}</span></td>
        <td><span class="role ${u.role}">${ROLES[u.role]}</span>${u.active ? '' : ' <span class="tag">Inactive</span>'}</td>
        <td class="hide-m">${u.clients}</td><td class="hide-m">${u.open_followups}</td><td class="hide-m small">${ago(u.last_activity || u.last_login)}</td>
        <td><button class="btn ghost xs" data-edit="${u.code}">Edit</button></td></tr>`).join('');
      $$('#tRows tr.row').forEach((tr) => (tr.onclick = (e) => { if (e.target.closest('[data-edit]')) return; openUser(tr.dataset.code); }));
      $$('[data-edit]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); userForm($('#uForm'), team.find((u) => u.code === b.dataset.edit), viewTeam); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
    };
    $('#tRole').onchange = draw; draw();
    $('#addU').onclick = () => userForm($('#uForm'), { role: 'sales' }, viewTeam);
  }

  // ---------- Team activity (super admin) ----------
  async function viewActivity() {
    $('#view').innerHTML = `<div class="toolbar"><div class="left"><select id="aUser"><option value="">Everyone</option>${team.filter((u) => u.role !== 'channel_partner').map((u) => `<option value="${u.code}">${esc(u.name)}</option>`).join('')}</select></div></div><div class="box feed" id="feed"><p class="empty">Loading…</p></div>`;
    const load = async () => {
      const u = $('#aUser').value;
      const d = await api(`/api/admin/activity${u ? `?user=${u}` : ''}`);
      $('#feed').innerHTML = d.activity.map((a) => `<div class="tl"><span><b>${esc(a.user_name || a.user_code)}</b> ${a.action === 'login' ? 'signed in' : esc(a.detail || a.action)}${a.lead_name ? ` · <a class="lnk" data-lead="${esc(a.target_id)}">${esc(a.lead_name)}</a>` : ''}${a.partner_name ? ` · <a class="lnk" data-user="${esc(a.target_id)}">${esc(a.partner_name)}</a>` : ''}</span><span>${when(a.ts)}</span></div>`).join('') || '<p class="empty">No activity yet.</p>';
      $$('[data-lead]', $('#feed')).forEach((x) => (x.onclick = (e) => { e.preventDefault(); openLead(x.dataset.lead); }));
      $$('[data-user]', $('#feed')).forEach((x) => (x.onclick = (e) => { e.preventDefault(); openUser(x.dataset.user); }));
    };
    $('#aUser').onchange = load; load();
  }

  // ---------- CRM integration (super admin) ----------
  async function viewIntegrations() {
    const d = await api('/api/admin/integrations');
    const base = C.API_BASE;
    const sample = JSON.stringify({ crm_id: 'CRM-10234', name: 'Rahul Shah', phone: '9876543210', email: 'rahul@example.com', source: 'Facebook ads', assigned_to: '9900000002', notes: 'Wants 4 BHK' }, null, 2);
    const reply = JSON.stringify({ ok: true, result: 'created', crm_id: 'CRM-10234', lead_id: 128, link: siteUrl + '?i=k7m2qx' }, null, 2);
    $('#view').innerHTML = `<div class="box"><h4>CRM integration</h4>
        <p class="small" style="margin:0 0 10px">${d.linked} client${d.linked === 1 ? '' : 's'} linked to CRM lead IDs.</p>
        <div id="keyNew"></div>
        <div class="btnrow" style="margin-bottom:8px"><input id="keyName" placeholder="Key name, e.g. Our CRM" style="max-width:240px"><button class="btn primary sm" id="mkKey">Create API key</button></div>
        ${d.keys.map((k) => `<div class="tl"><span><b>${esc(k.name)}</b> · ${esc(k.prefix)}… ${k.active ? '' : '<span class="tag">Revoked</span>'}<br><span class="small">Created ${when(k.created_at)} by ${esc(k.created_by_name || '—')} · last used ${k.last_used ? ago(k.last_used) : 'never'}</span></span><span>${k.active ? `<button class="btn ghost xs" data-revoke="${k.id}">Revoke</button>` : ''}</span></div>`).join('') || '<p class="small" style="margin:0">No API keys yet.</p>'}
      </div>
      <div class="box kn"><h4>For your CRM developer</h4>
        <p><b>1. Create a lead</b> — call this whenever a lead is created in the CRM. Sending the same <code>crm_id</code> again updates that lead instead of duplicating it.</p>
        <pre>POST ${esc(base)}/api/crm/leads
Authorization: Bearer plms_…
Content-Type: application/json

${esc(sample)}</pre>
        <p>Required: <code>crm_id</code>, <code>name</code>, <code>phone</code> (10-digit mobile). Optional: <code>email</code>, <code>source</code>, <code>notes</code>, <code>assigned_to</code> (salesperson's mobile number or name in this dashboard).</p>
        <p><b>Reply</b> (201 when created, 200 when updated or linked to someone already on the page):</p>
        <pre>${esc(reply)}</pre>
        <p>Send <code>link</code> to the client (e.g. by WhatsApp). It greets them by name, and their visits are recorded against this lead. If the phone number already belongs to a different CRM lead, the reply is 409 with <code>phone_already_mapped</code> and that lead's <code>mapped_crm_id</code>; nothing changes.</p>
        <p><b>2. Get the link again</b> (optional) — for a lead already sent:</p>
        <pre>GET ${esc(base)}/api/crm/leads/CRM-10234
Authorization: Bearer plms_…</pre>
        <p>Returns the same <code>crm_id</code>, <code>lead_id</code> and <code>link</code>, or 404 <code>not_registered</code> if that lead hasn't been sent yet. No visit or engagement data is shared with the CRM.</p>
      </div>`;
    $('#mkKey').onclick = async () => {
      const r = await api('/api/admin/integrations/keys', { method: 'POST', body: JSON.stringify({ name: $('#keyName').value }) });
      await viewIntegrations();
      $('#keyNew').innerHTML = `<div class="box internal-note"><b>Copy this key now — it won't be shown again.</b><div class="linkbox" style="margin-top:8px"><input readonly value="${esc(r.key)}"><button class="btn primary xs" data-copy="${esc(r.key)}">Copy key</button></div><p class="small" style="margin:6px 0 0">Give it only to your CRM developer. Anyone with it can add leads.</p></div>`;
      bindCopy($('#keyNew'));
    };
    $$('[data-revoke]').forEach((b) => (b.onclick = async () => { if (!confirm('Revoke this key? The CRM will stop being able to send leads with it.')) return; await api(`/api/admin/integrations/keys/${b.dataset.revoke}`, { method: 'DELETE' }); viewIntegrations(); }));
  }

  // ---------- AI knowledge (super admin) ----------
  function md(text) {
    const out = []; let list = false;
    const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/(https?:\/\/[^\s)]+)/g, '<a class="lnk" href="$1" target="_blank" rel="noopener">$1</a>');
    for (const line of text.split('\n')) {
      const li = line.match(/^\s*[-*] (.*)/);
      if (li) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
      if (list) { out.push('</ul>'); list = false; }
      const h = line.match(/^(#{1,3}) (.*)/);
      if (h) out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`);
      else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    }
    if (list) out.push('</ul>');
    return out.join('');
  }
  async function viewKnowledge() {
    $('#view').innerHTML = '<p class="empty">Loading…</p>';
    const d = await api('/api/admin/knowledge');
    const body = d.knowledge.replace(/^# .*\n/, '').replace(/^\s*Edit this file[\s\S]*?\n\n/, '');
    $('#view').innerHTML = `<div class="box kn"><p class="small" style="margin:0 0 6px">This is everything the “Ask Unity” assistant knows. It answers only from this text; anything else it refers to the sales team. To add or change something, send the update to whoever maintains the page.</p>${md(body)}</div>`;
  }

  // ---------- Drawer ----------
  function drawer(html) {
    $('#drawer').innerHTML = html; $('#drawer').classList.remove('hidden'); $('#scrim').classList.remove('hidden'); $('#drawer').scrollTop = 0;
    $$('[data-close]', $('#drawer')).forEach((b) => (b.onclick = closeDrawer));
    $$('#drawer [data-lead]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); openLead(a.dataset.lead); }));
    $$('#drawer [data-user]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); openUser(a.dataset.user); }));
  }
  function closeDrawer() { $('#drawer').classList.add('hidden'); $('#scrim').classList.add('hidden'); if (tab === 'followups') loadFollowups(); }
  $('#scrim').onclick = closeDrawer;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  // ---------- Install as a phone app ----------
  let installEvt = null;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent) || isIOS;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#installBtn').classList.remove('hidden'); });
  window.addEventListener('appinstalled', () => { $('#installBtn').classList.add('hidden'); toast('Unity Sales added to your home screen'); });
  if (!standalone && isMobile) $('#installBtn').classList.remove('hidden');
  function installSheet() {
    const steps = isIOS
      ? '<li>Tap the <b>Share</b> button in Safari (square with an arrow).</li><li>Scroll and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. The Unity Sales icon appears on your home screen.</li>'
      : '<li>Tap the <b>⋮</b> menu in Chrome (top right).</li><li>Tap <b>Add to Home screen</b> or <b>Install app</b>.</li><li>Tap <b>Install</b>. The Unity Sales icon appears on your home screen.</li>';
    const d = document.createElement('div'); d.className = 'install-sheet';
    d.innerHTML = `<img class="app-ic" src="icons/apple-touch-icon.png" alt=""><h3>Add Unity Sales to your phone</h3><p class="small" style="margin:0">Open the dashboard from your home screen like an app.</p><ol>${steps}</ol><button class="btn primary sm" data-x>Got it</button>`;
    document.body.appendChild(d); $('[data-x]', d).onclick = () => d.remove();
  }
  $('#installBtn').onclick = async () => {
    if (installEvt) { installEvt.prompt(); const r = await installEvt.userChoice; installEvt = null; if (r.outcome === 'accepted') $('#installBtn').classList.add('hidden'); return; }
    installSheet();
  };

  if (token) start();
})();
