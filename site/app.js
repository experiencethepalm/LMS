/* The Palm Unity — private project page */
(() => {
  const C = window.UNITY_CONFIG;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
    del: (k) => { try { localStorage.removeItem(k); } catch {} },
  };

  // Attribution. ?r=<share id> belongs to a salesperson or to a buyer who forwarded the page
  // (older ?ref= links still work). Remembered on this device so forwards keep their credit.
  const params = new URLSearchParams(location.search);
  const incomingRef = (params.get('r') || params.get('ref') || '').trim();
  const myShareId = store.get('unity_me');
  if (incomingRef && incomingRef !== myShareId) store.set('unity_ref', incomingRef);
  // Random id for this browser, so an open of a shared link can be matched to the person once they verify
  let device = store.get('unity_dev');
  if (!device) { device = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).replace(/-/g, '').slice(0, 24); store.set('unity_dev', device); }
  if (incomingRef && incomingRef !== myShareId) {
    fetch(C.API_BASE + '/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: incomingRef, device }), keepalive: true }).catch(() => {});
  }
  const source = params.get('utm_source') ? [params.get('utm_source'), params.get('utm_campaign')].filter(Boolean).join('/') : document.referrer ? new URL(document.referrer).hostname : '';
  const ref = store.get('unity_ref') || '';
  // Personal link from the CRM (?i=…): greet the person and prefill their name
  const invite = (params.get('i') || '').trim();
  if (invite && !store.get('unity_token')) {
    fetch(C.API_BASE + '/api/invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invite, device }) })
      .then((r) => r.json()).then((d) => {
        if (!d.ok || !d.firstName) return;
        const n = document.querySelector('#detailsForm [name=name]');
        if (n && !n.value) n.placeholder = 'Your full name';
        const h = document.querySelector('#stepDetails h2');
        if (h) h.textContent = `Welcome, ${d.firstName}`;
      }).catch(() => {});
  }
  let token = store.get('unity_token');
  let phone = '';

  // ---------- static bits ----------
  setImg($('#heroImg'));
  $('#privacyLink').href = C.PRIVACY_URL;
  const tel = `tel:${C.SALES_PHONE}`;
  const wa = `https://wa.me/${C.SALES_WHATSAPP}?text=${encodeURIComponent(C.WHATSAPP_TEXT)}`;
  ['#helpCall', '#barCall'].forEach((s) => ($(s).href = tel));
  ['#helpWa', '#barWa'].forEach((s) => ($(s).href = wa));
  // Verified buyers share their own link, so the dashboard can show who they brought in
  const shareUrl = () => {
    const id = store.get('unity_me') || ref;
    return location.origin + location.pathname + (id ? `?r=${encodeURIComponent(id)}` : '');
  };
  const sharePage = () => {
    if (token) queue({ type: 'cta', target: 'share' });
    const url = shareUrl();
    const text = 'Have a look at The Palm Unity — 3 & 4 BHK Zen Living homes in Kudasan, Gandhinagar';
    if (navigator.share) navigator.share({ title: 'The Palm Unity', text, url }).catch(() => {});
    else window.open(`https://wa.me/?text=${encodeURIComponent(`${text}: ${url}`)}`, '_blank', 'noopener');
  };
  $('#shareBtn').onclick = sharePage;

  function setImg(img, src) {
    const box = img.closest('.ph');
    const ok = () => box?.classList.remove('missing');
    const fail = () => box?.classList.add('missing');
    img.onload = ok;
    img.onerror = fail;
    if (src) { box?.classList.add('missing'); img.src = src; }
    else if (img.complete) (img.naturalWidth ? ok : fail)();
  }

  async function api(path, opts = {}) {
    const res = await fetch(C.API_BASE + path, {
      ...opts,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: res.status });
    return data;
  }

  // ---------- gate ----------
  $('#detailsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, err = $('#detailsError'), btn = f.querySelector('button');
    err.textContent = '';
    phone = f.elements.phone.value.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').replace(/^0/, '');
    if (f.elements.name.value.trim().length < 2) return (err.textContent = 'Please enter your full name.');
    if (!/^[6-9]\d{9}$/.test(phone)) return (err.textContent = 'Please enter a valid 10-digit mobile number.');
    if (!f.elements.consent.checked) return (err.textContent = 'Please tick the consent box to continue.');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const r = await api('/api/otp/start', { method: 'POST', body: JSON.stringify({ name: f.elements.name.value, phone, profession: f.elements.profession.value, consent: true, ref, source, device }) });
      $('#stepDetails').classList.add('hidden');
      $('#stepCode').classList.remove('hidden');
      $('#codeSentTo').textContent = `We sent a code on ${r.channel === 'sms' ? 'SMS' : 'WhatsApp'} to +91 ${phone.slice(0, 5)} ${phone.slice(5)}.`;
      if (r.devCode) { $('#devNote').textContent = `Test mode — your code is ${r.devCode}`; $('#devNote').classList.remove('hidden'); }
      $('#codeForm').elements.code.focus();
    } catch (ex) { err.textContent = ex.message; }
    btn.disabled = false; btn.textContent = 'Send code on WhatsApp';
  });

  $('#codeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#codeError'), btn = e.target.querySelector('button');
    err.textContent = '';
    btn.disabled = true; btn.textContent = 'Verifying…';
    try {
      const r = await api('/api/otp/verify', { method: 'POST', body: JSON.stringify({ phone, code: e.target.elements.code.value }) });
      token = r.token; store.set('unity_token', token);
      unlock(r.content, r.name, r.shareId);
    } catch (ex) { err.textContent = ex.message; }
    btn.disabled = false; btn.textContent = 'Verify & open';
  });
  $('#codeForm').elements.code.addEventListener('input', (e) => { if (e.target.value.replace(/\D/g, '').length === 6) $('#codeForm').requestSubmit(); });
  $('#changeNumber').onclick = (e) => { e.preventDefault(); $('#stepCode').classList.add('hidden'); $('#stepDetails').classList.remove('hidden'); $('#devNote').classList.add('hidden'); };
  $('#resend').onclick = (e) => { e.preventDefault(); $('#stepCode').classList.add('hidden'); $('#stepDetails').classList.remove('hidden'); $('#detailsForm').requestSubmit(); };

  // Returning visitor
  if (token) {
    api(`/api/me${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`)
      .then((r) => unlock(r.content, r.name, r.shareId))
      .catch((ex) => { if (ex.status === 401) { store.del('unity_token'); token = null; } });
  }


  // Line icons for amenities (matched by keyword, so new amenities still get a sensible icon)
  const AMENITY_ICONS = [
    [/fitness|gym/i, '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>'],
    [/pool|swim/i, '<path d="M3 17c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0M3 20.5c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0M8 14V5.5a2 2 0 0 1 4 0M16 14V5.5a2 2 0 0 0-4 0M8 9h8"/>'],
    [/sports|court/i, '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.3 3.8 5.1 3.8 8.5s-1.3 6.2-3.8 8.5M12 3.5C9.5 5.8 8.2 8.6 8.2 12s1.3 6.2 3.8 8.5"/>'],
    [/garden walk|walk/i, '<path d="M8 20.5c-1.7 0-2.5-1.2-2.5-3s.8-3 2.5-3 2.5 1.3 2.5 3-.8 3-2.5 3ZM16 12.5c-1.7 0-2.5-1.2-2.5-3s.8-3 2.5-3 2.5 1.3 2.5 3-.8 3-2.5 3ZM7 11.5l1-1.8M17 4.5 16 6"/>'],
    [/cinema|theatre|movie/i, '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M3.5 9.5h17M8 5.5l-2 4M13 5.5l-2 4M18 5.5l-2 4"/>'],
    [/games/i, '<rect x="3" y="8" width="18" height="9" rx="4.5"/><path d="M7.5 11v3M6 12.5h3M15.5 11.5h.01M17.5 13.5h.01"/>'],
    [/recreation|lounge|club/i, '<path d="M4.5 18.5v-5a2 2 0 0 1 4 0v2h7v-2a2 2 0 0 1 4 0v5M8.5 13.5V9a3.5 3.5 0 0 1 7 0v4.5M4.5 18.5h15"/>'],
    [/kid|play|child/i, '<path d="M4 20.5 9 4.5h6l5 16M9 4.5h6M12 10v6.5"/><path d="M10 16.5h4"/>'],
    [/julla|jhula|swing/i, '<path d="M4 3.5h16M7.5 3.5v11M16.5 3.5v11M6 14.5h12v2.5H6z"/>'],
    [/hall|banquet/i, '<path d="M12 3.5v3M7 6.5h10l-1.5 4h-7L7 6.5ZM8.5 10.5 7 14.5h10l-1.5-4M12 14.5v6M8.5 20.5h7"/>'],
    [/sky garden|garden|park/i, '<path d="M12 21v-6"/><path d="M12 15c-3.6 0-6-2.4-6-5.6C6 6 8.7 3.5 12 3.5S18 6 18 9.4C18 12.6 15.6 15 12 15Z"/>'],
    [/work|office|co-?work/i, '<rect x="4" y="5" width="16" height="10.5" rx="1.5"/><path d="M2.5 19h19M10 19l.5-3.5h3L14 19"/>'],
    [/guest|suite|stay/i, '<path d="M3.5 18.5V7M3.5 14h17v4.5M20.5 14v-2.5a3 3 0 0 0-3-3h-7v5.5"/><circle cx="7" cy="11" r="1.8"/>'],
  ];
  const amenityIcon = (name) => {
    const hit = AMENITY_ICONS.find(([re]) => re.test(name));
    const path = hit ? hit[1] : '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"/>';
    return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  };

  // ---------- render unlocked page ----------
  const SECTIONS = [
    ['overview', 'Overview'], ['highlights', 'Highlights'], ['gallery', 'Gallery'], ['floorplans', 'Floor plans'],
    ['amenities', 'Amenities'], ['specifications', 'Specifications'],
    ['location', 'Location'], ['visit', 'Visit'],
  ];
  const isTbc = (v) => v == null || v === '' || /^TBC/i.test(String(v));
  const val = (v, fallback = 'To be announced') => (isTbc(v) ? `<span class="tbc">${fallback}</span>` : esc(v));

  function unlock(c, name, shareId) {
    if (shareId) {
      store.set('unity_me', shareId);
      // The address bar now carries this buyer's own link, so copy/paste forwards are credited to them
      try { history.replaceState(null, '', `${location.pathname}?r=${encodeURIComponent(shareId)}${location.hash}`); } catch {}
    }
    $('#gate').classList.add('hidden');
    $('#actionbar').classList.remove('hidden');
    $('#heroBadge').textContent = `✓ Verified${name ? ` · Welcome, ${name.split(' ')[0]}` : ''}`;
    $('#heroBadge').classList.add('ok');
    if (!isTbc(c.project.rera)) $('#footRera').textContent = `RERA: ${c.project.rera}`;
    const p = c.project;
    const plansByConfig = [...new Set(c.floorplans.map((f) => f.config))];
    const yt = c.walkthrough?.youtubeId;

    $('#project').innerHTML = `
      <nav class="secnav">${SECTIONS.map(([id, label]) => `<a href="#${id}" data-nav="${id}">${label}</a>`).join('')}</nav>

      <div class="sec" id="overview" data-track="overview">
        <p>${esc(p.about)}</p>
        <div class="facts">
          <div class="fact"><span>Type</span><b>${esc(p.type)}</b></div>
          <div class="fact"><span>Possession</span><b>${val(p.possession)}</b></div>
          <div class="fact"><span>Homes</span><b>3 & 4 BHK · Penthouses</b></div>
          <div class="fact"><span>Developer</span><b>${esc(p.developer)}</b></div>
        </div>
      </div>

      <div class="sec" id="highlights" data-track="highlights">
        <h2>Highlights</h2>
        <ol class="hl2">${c.highlights.map((h, i) => typeof h === 'string' ? `<li><p>${esc(h)}</p></li>` : `<li class="${h.image ? 'has-art' : ''}">${h.image ? `<figure class="hl-art${h.image.style === 'photo' ? ' photo' : ''}"><img src="${esc(h.image.thumb || h.image.src)}"${h.image.thumb ? ` srcset="${esc(h.image.thumb)} 800w, ${esc(h.image.src)} 1600w" sizes="(max-width: 760px) 92vw, 420px"` : ''} alt="${esc(h.image.alt)}" width="${h.image.w}" height="${h.image.h}" loading="lazy" decoding="async" /></figure>` : ''}<div class="hl-body"><span class="hl-n">${String(i + 1).padStart(2, '0')}</span><div><h3>${esc(h.title)}</h3><p>${esc(h.text)}</p></div></div></li>`).join('')}</ol>
      </div>

      <div class="sec" id="gallery" data-track="gallery">
        <h2>Gallery</h2>
        <div class="gallery">${c.gallery.map((g, i) => `<figure class="ph" data-label="${esc(g.caption)}" data-gal="${i}"><img alt="${esc(g.alt || g.caption)}" data-src="${esc(g.thumb || g.src)}"${g.thumb ? ` data-srcset="${esc(g.thumb)} 800w, ${esc(g.src)} 1920w" sizes="(max-width: 760px) 66vw, 500px"` : ''} width="${g.w || 800}" height="${g.h || 450}" loading="lazy" decoding="async" /><figcaption>${esc(g.caption)}</figcaption></figure>`).join('')}</div>
        ${yt ? `<h3 style="margin-top:22px">Walkthrough</h3><div class="video" id="walkthrough"><iframe src="https://www.youtube-nocookie.com/embed/${esc(yt)}" title="The Palm Unity walkthrough" allow="encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>` : ''}
      </div>

      <div class="sec" id="floorplans" data-track="floorplans">
        <h2>Floor plans</h2>
        <div class="chipsrow" id="planFilter">${plansByConfig.map((x, i) => `<button data-f="${esc(x)}"${i === 0 ? ' class="on"' : ''}>${esc(x)}</button>`).join('')}</div>
        <div class="unit-tabs" id="unitTabs"></div>
        <div class="fp" id="fp"></div>
      </div>
      </div>

      <div class="sec" id="amenities" data-track="amenities">
        <h2>Amenities</h2>
        ${c.amenities.map((g) => `<div class="amen-group"><p class="eyebrow">${esc(g.group)}</p><div class="amen">${g.items.map((a) => `<div class="amen-item"><span class="amen-ic">${amenityIcon(a)}</span><span class="amen-t">${esc(a)}</span></div>`).join('')}</div></div>`).join('')}
      </div>

      <div class="sec" id="specifications" data-track="specifications">
        <h2>Specifications</h2>
        <table class="specs">${c.specifications.map((s) => `<tr><td>${esc(s.item)}</td><td>${Array.isArray(s.detail) ? `<ul class="spec-list">${s.detail.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : val(s.detail, 'Details coming soon')}</td></tr>`).join('')}</table>
      </div>

      <div class="sec" id="location" data-track="location">
        <h2>Location</h2>
        <p class="tagline">${esc(p.tagline)}</p>
        <div class="umap" id="unityMap">
          <div class="umap-canvas" data-map></div>
          <div class="umap-card hidden" data-card></div>
        </div>
        <p class="eyebrow umap-h">Connectivity · tap to see the drive</p>
        <div class="kp-grid">${c.location.keyPlaces.map((k) => `<button class="kp" data-place="${esc(k.id)}"><span class="kp-ic">${window.UnityMap ? UnityMap.svg(k.icon, 18) : ''}</span><span class="kp-t"><b>${esc(k.name)}</b><span class="kp-meta">Tap for distance</span></span></button>`).join('')}</div>
        <p class="eyebrow umap-h">Around Unity · show on map</p>
        <div class="chipsrow cat-row">${c.location.categories.map((k) => `<button data-cat="${esc(k.id)}">${window.UnityMap ? UnityMap.svg(k.icon, 15) : ''}${esc(k.label)}</button>`).join('')}</div>
        <div class="lm-list" data-list></div>
        <p class="small">Distances and drive times are approximate, by road without traffic. <a href="${esc(c.location.mapsUrl)}" target="_blank" rel="noopener" data-cta="maps">Open in Google Maps</a></p>
      </div>

      <div class="sec" id="visit" data-track="visit">
        <div class="visit-card">
          <p class="eyebrow" style="color:#E4D3B0">Visit us</p>
          <h3>See Zen Living for yourself</h3>
          <p>Walk the site and sample homes with our team. Pick a slot — or call / WhatsApp for the same day.</p>
          <button class="btn sm" id="visitCta">Book a site visit</button>
        </div>
        <div class="share-card">
          <div><h3>Deciding with family?</h3><p class="muted">Send Unity to them on WhatsApp — they'll see everything you see.</p></div>
          <button class="btn primary sm" id="shareFamily"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8l7.4-4.4M8.3 13.2l7.4 4.4"/></svg> Share with family</button>
        </div>
      </div>`;
    $('#project').classList.remove('hidden');

    $$('#project img[data-src]').forEach((img) => { if (img.dataset.srcset) img.srcset = img.dataset.srcset; setImg(img, img.dataset.src); });
    const plansIn = (cfg) => c.floorplans.filter((f) => f.config === cfg);
    const showPlan = (f, user) => {
      $$('#unitTabs button').forEach((x) => x.classList.toggle('on', x.dataset.plan === f.id));
      const sqft = (f.sbAreaSqYd * 9).toLocaleString('en-IN');
      $('#fp').innerHTML = `
        <div class="fp-slider">
          ${f.floorPlan ? `<div class="fp-tabs"><button data-s="0" class="on">Unit plan</button><button data-s="1">Floor plan</button></div>` : ''}
          <div class="fp-track" id="fpTrack">
            <figure class="fp-slide"><button class="fp-plan" data-zoom="unit" aria-label="Zoom ${esc(f.name)} unit plan"><img src="${esc(f.image)}" alt="${esc(f.alt || f.name + ' unit plan')}" width="${f.w || 1800}" height="${f.h || 1500}" decoding="async" /></button></figure>
            ${f.floorPlan ? `<figure class="fp-slide"><button class="fp-plan fp-floor" data-zoom="floor" aria-label="Zoom ${esc(f.name)} floor plan"><img src="${esc(f.floorPlan.image)}" alt="${esc(f.floorPlan.alt)}" width="${f.floorPlan.w}" height="${f.floorPlan.h}" loading="lazy" decoding="async" /></button><figcaption><b>${esc(f.floorPlan.floors)}</b> · ${esc(f.name)} homes ${esc(f.floorPlan.units)} highlighted</figcaption></figure>` : ''}
          </div>
          ${f.floorPlan ? `<button class="fp-nav prev" aria-label="Unit plan" disabled>‹</button><button class="fp-nav next" aria-label="Floor plan">›</button><div class="fp-dots"><i class="on"></i><i></i></div><p class="fp-hint">Swipe for the floor plan · tap to zoom</p>` : '<p class="fp-hint">Tap to zoom</p>'}
        </div>
        <div class="fp-side">
          <small class="fp-cfg">${esc(f.config)}</small><h3>${esc(f.name)}</h3>
          <div class="fp-facts"><div><span>Super built-up</span><b>${f.sbAreaSqYd} sq.yds</b><em>≈ ${sqft} sq.ft</em></div>${f.parking ? `<div><span>Parking</span><b>${f.parking} cars</b><em>allocated</em></div>` : ''}</div>
          ${f.rooms ? `<table class="fp-rooms"><tbody>${f.rooms.map((r) => `<tr class="${r.n.includes('A') ? 'sub' : ''}"><td>${esc(r.n)}</td><td>${esc(r.room)}</td><td>${esc(r.size)}</td></tr>`).join('')}</tbody></table><p class="fp-note">Room sizes are internal dimensions.</p>` : ''}
          ${f.planNote ? `<p class="fp-note strong">${esc(f.planNote)}</p>` : ''}
        </div>`;
      $$('#fp [data-zoom]').forEach((b) => (b.onclick = () => {
        const fl = b.dataset.zoom === 'floor';
        queue({ type: 'floorplan_open', target: fl ? `${f.id}:floor` : f.id });
        fl ? openLightbox(f.floorPlan.image, `${f.name} · ${f.floorPlan.floors} · ${f.floorPlan.units}`, f.floorPlan.alt, false, 'plan')
           : openLightbox(f.image, `${f.name} · ${f.config} · ${f.sbAreaSqYd} sq.yds`, f.alt, false, 'plan');
      }));
      if (f.floorPlan) {
        const tr = $('#fpTrack'); let si = 0, seen = false;
        const mark = (i) => { $$('#fp .fp-tabs button').forEach((b, k) => b.classList.toggle('on', k === i)); $$('#fp .fp-dots i').forEach((d, k) => d.classList.toggle('on', k === i)); $('#fp .prev').disabled = i === 0; $('#fp .next').disabled = i === 1; if (i === 1 && !seen) { seen = true; queue({ type: 'floorplan_open', target: `${f.id}:floor` }); } };
        const go = (i) => { tr.scrollTo({ left: i * tr.clientWidth, behavior: 'smooth' }); si = i; mark(i); };
        tr.addEventListener('scroll', () => { const i = Math.round(tr.scrollLeft / tr.clientWidth); if (i !== si) { si = i; mark(i); } }, { passive: true });
        $$('#fp .fp-tabs button').forEach((b) => (b.onclick = () => go(+b.dataset.s)));
        $('#fp .prev').onclick = () => go(0); $('#fp .next').onclick = () => go(1);
      }
      if (user) queue({ type: 'floorplan_open', target: f.id });
    };
    const showConfig = (cfg, user) => {
      $$('#planFilter button').forEach((x) => x.classList.toggle('on', x.dataset.f === cfg));
      const list = plansIn(cfg);
      $('#unitTabs').innerHTML = list.length > 1 ? list.map((f) => `<button data-plan="${esc(f.id)}">${esc(f.name)}</button>`).join('') : '';
      $$('#unitTabs button').forEach((b) => (b.onclick = () => showPlan(c.floorplans.find((x) => x.id === b.dataset.plan), true)));
      showPlan(list[0], user);
    };
    $$('#planFilter button').forEach((b) => (b.onclick = () => showConfig(b.dataset.f, true)));
    showConfig(plansByConfig[0], false);
    $$('[data-gal]').forEach((fig) => (fig.onclick = () => openGallery(c.gallery, +fig.dataset.gal)));
    $('#visitCta').onclick = () => openVisit('site_visit');
    $('#shareFamily').onclick = sharePage;
    if (yt) watchVideoPlay();
    startTracking();
    const mapRoot = $('#unityMap');
    if (mapRoot && window.UnityMap) {
      const go = () => UnityMap.init(mapRoot.closest('.sec'), c.location, { onEvent: (t) => queue({ type: 'map', target: t }) });
      const io = new IntersectionObserver((en) => { if (en.some((e) => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '600px' });
      io.observe(mapRoot);
    }
  }

  // ---------- tracking ----------
  const pending = [];
  function queue(ev) { pending.push(ev); if (pending.length >= 10) flush(); }
  function flush(useBeacon) {
    collectDwell();
    if (!pending.length || !token) return;
    const body = JSON.stringify({ token, events: pending.splice(0) });
    if (useBeacon && navigator.sendBeacon) navigator.sendBeacon(C.API_BASE + '/api/track', new Blob([body], { type: 'text/plain' }));
    else fetch(C.API_BASE + '/api/track', { method: 'POST', body, headers: { 'content-type': 'text/plain' }, keepalive: true }).catch(() => {});
  }
  const visible = new Map(); // section -> visible since (ms)
  const dwell = {};
  function collectDwell() {
    const t = Date.now();
    for (const [id, since] of visible) { dwell[id] = (dwell[id] || 0) + (t - since) / 1000; visible.set(id, t); }
    for (const [id, secs] of Object.entries(dwell)) if (secs >= 1) { pending.push({ type: 'dwell', target: id, value: Math.round(secs) }); delete dwell[id]; }
  }
  // Highlight the current section in the sticky menu and slide the menu so it stays in view
  let navActive = null;
  function setActiveNav(id) {
    if (id === navActive) return;
    navActive = id;
    const nav = $('.secnav');
    if (!nav) return;
    let on = null;
    $$('a', nav).forEach((a) => { const hit = a.dataset.nav === id; a.classList.toggle('on', hit); if (hit) on = a; });
    if (on) nav.scrollTo({ left: on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' });
  }
  function startTracking() {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = e.target.dataset.track;
        if (e.isIntersecting && document.visibilityState === 'visible') { if (!visible.has(id)) visible.set(id, Date.now()); }
        else if (visible.has(id)) { dwell[id] = (dwell[id] || 0) + (Date.now() - visible.get(id)) / 1000; visible.delete(id); }
      }
    }, { threshold: 0.35 });
    $$('[data-track]').forEach((s) => io.observe(s));
    // Menu follows the section crossing the middle of the screen (works for tall sections too)
    const navIO = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setActiveNav(e.target.dataset.track); });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
    $$('[data-track]').forEach((s) => navIO.observe(s));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { flush(true); visible.clear(); }
    });
    window.addEventListener('pagehide', () => flush(true));
    setInterval(() => flush(), 20000);
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-cta]');
    if (a && token) queue({ type: 'cta', target: a.dataset.cta });
  });
  function watchVideoPlay() {
    // A tap on the embedded player moves focus into the iframe
    window.addEventListener('blur', () => { if (document.activeElement?.tagName === 'IFRAME') queue({ type: 'walkthrough_play', target: 'walkthrough' }); });
  }

  // ---------- sheets ----------
  function openSheet(id) { $('#scrim').classList.remove('hidden'); $(`#${id}`).classList.remove('hidden'); }
  function closeAll() { ['chatSheet', 'visitSheet', 'lightbox', 'scrim'].forEach((id) => $(`#${id}`).classList.add('hidden')); }
  $$('[data-close]').forEach((b) => (b.onclick = closeAll));
  $('#scrim').onclick = closeAll;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
  // Gallery viewer: arrows, keyboard ← →, and swipe on phones
  let gal = null;
  function openGallery(items, i) {
    gal = { items, i };
    $('#lightbox').classList.add('has-nav');
    showGal(0);
  }
  function showGal(step) {
    if (!gal) return;
    gal.i = (gal.i + step + gal.items.length) % gal.items.length;
    const g = gal.items[gal.i];
    queue({ type: 'gallery_open', target: String(gal.i) });
    openLightbox(g.src, `${g.caption}  ·  ${gal.i + 1} / ${gal.items.length}`, g.alt, true);
    const next = gal.items[(gal.i + 1) % gal.items.length];
    new Image().src = next.src; // preload the next photo
  }
  $('#lbPrev').onclick = (e) => { e.stopPropagation(); showGal(-1); };
  $('#lbNext').onclick = (e) => { e.stopPropagation(); showGal(1); };
  document.addEventListener('keydown', (e) => {
    if ($('#lightbox').classList.contains('hidden') || !gal) return;
    if (e.key === 'ArrowLeft') showGal(-1);
    if (e.key === 'ArrowRight') showGal(1);
  });
  let touchX = null;
  $('#lightbox').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  $('#lightbox').addEventListener('touchend', (e) => {
    if (touchX == null || !gal) return;
    const dx = e.changedTouches[0].clientX - touchX; touchX = null;
    if (Math.abs(dx) > 45) showGal(dx < 0 ? 1 : -1);
  });
  function openLightbox(src, caption, alt, fromGallery, kind) {
    const lb = $('#lightbox');
    lb.classList.toggle('is-plan', kind === 'plan');
    if (!fromGallery) { gal = null; lb.classList.remove('has-nav'); }
    $('img', lb).src = src; $('img', lb).alt = alt || caption; $('p', lb).textContent = caption;
    $('img', lb).onerror = () => { $('img', lb).removeAttribute('src'); $('p', lb).textContent = `${caption} — image coming soon`; };
    lb.classList.remove('hidden');
  }
  function alertToast(msg) { const d = document.createElement('div'); d.textContent = msg; Object.assign(d.style, { position: 'fixed', bottom: '96px', left: '50%', transform: 'translateX(-50%)', background: '#23302A', color: '#fff', padding: '10px 16px', borderRadius: '99px', zIndex: 99, fontSize: '14px' }); document.body.appendChild(d); setTimeout(() => d.remove(), 2200); }

  // ---------- AI assistant ----------
  $('#openChat').onclick = () => { openSheet('chatSheet'); $('#chatForm').elements.message.focus(); };
  $$('#chips button').forEach((b) => (b.onclick = () => ask(b.textContent)));
  $('#chatForm').addEventListener('submit', (e) => { e.preventDefault(); const m = e.target.elements.message.value.trim(); if (m) { e.target.elements.message.value = ''; ask(m); } });
  function bubble(role, text) { const d = document.createElement('div'); d.className = `msg ${role}`; d.textContent = text; $('#chatLog').appendChild(d); $('#chatLog').scrollTop = 1e6; return d; }
  async function ask(q) {
    $('.chat-intro')?.classList.add('hidden');
    bubble('user', q);
    const t = bubble('assistant typing', 'Typing…');
    try { const r = await api('/api/chat', { method: 'POST', body: JSON.stringify({ message: q }) }); t.className = 'msg assistant'; t.textContent = r.reply; }
    catch (ex) { t.className = 'msg assistant'; t.textContent = ex.message; }
    $('#chatLog').scrollTop = 1e6;
  }

  // ---------- visit / callback ----------
  $('#openVisit').onclick = () => openVisit('site_visit');
  function openVisit(kind) {
    const f = $('#visitForm');
    f.classList.remove('hidden'); $('#visitDone').classList.add('hidden');
    f.elements.kind.value = kind; syncKind();
    const d = new Date(Date.now() + 86400000); f.elements.date.min = new Date().toISOString().slice(0, 10); f.elements.date.value = d.toISOString().slice(0, 10);
    openSheet('visitSheet');
  }
  function syncKind() { const v = $('#visitForm').elements.kind.value === 'site_visit'; $('.visit-only').classList.toggle('hidden', !v); $('#visitTitle').textContent = v ? 'Book a site visit' : 'Request a callback'; }
  $$('#visitForm [name=kind]').forEach((r) => (r.onchange = syncKind));
  $('#visitForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api('/api/request', { method: 'POST', body: JSON.stringify({ kind: f.elements.kind.value, date: f.elements.kind.value === 'site_visit' ? f.elements.date.value : '', slot: f.elements.slot.value, message: f.elements.message.value }) });
      f.classList.add('hidden'); $('#visitDone').classList.remove('hidden');
    } catch (ex) { $('#visitError').textContent = ex.message; }
    btn.disabled = false;
  });
})();
