/* The Palm Unity — themed location map (MapLibre GL + OpenFreeMap vector tiles, no API key) */
(() => {
  const MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
  const MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
  const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

  // Brand palette (matches styles.css)
  const T = {
    bg: '#F3EEE6', land: '#EFE9DF', water: '#C9D8D2', park: '#DCE4D1', building: '#E5DCCD',
    road: '#FFFFFF', roadMajor: '#E8D6AE', casing: '#DDD3C2', rail: '#C6BAA6', border: '#CFC5B4',
    text: '#5E665F', textStrong: '#2F4A3A', halo: '#F6F3EE', green: '#2F4A3A', sand: '#B89B6A',
  };

  const ICONS = {
    unity: '<path d="M12 3c-1.8 2.6-5 3.6-5 7.4 0 2.6 2.2 4.6 5 4.6s5-2 5-4.6C17 6.6 13.8 5.6 12 3Z"/><path d="M12 15v6"/>',
    food: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16 3c-1.7 0-3 2.2-3 5s1.3 4 3 4v9"/>',
    hospital: '<path d="M12 6v12M6 12h12"/><rect x="3.5" y="3.5" width="17" height="17" rx="4"/>',
    school: '<path d="M2.5 9 12 4.5 21.5 9 12 13.5 2.5 9Z"/><path d="M6.5 11v5c1.6 1.6 3.4 2.4 5.5 2.4s3.9-.8 5.5-2.4v-5"/>',
    shopping: '<path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
    garden: '<path d="M12 21v-8"/><path d="M12 13c-4 0-6-2.5-6-6 3.5 0 6 2 6 6Zm0 0c4 0 6-2.5 6-6-3.5 0-6 2-6 6Z"/>',
    worship: '<path d="M12 3 7 8h10l-5-5Z"/><path d="M6 8h12v13H6zM10 21v-5h4v5"/>',
    plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    office: '<rect x="5" y="3.5" width="14" height="17" rx="1.5"/><path d="M9 7.5h2M13 7.5h2M9 11h2M13 11h2M9 14.5h2M13 14.5h2M11 20.5v-3h2v3"/>',
    train: '<rect x="6" y="3.5" width="12" height="13" rx="3"/><path d="M6 11h12M9 20.5l1.5-4M15 20.5l-1.5-4"/><circle cx="9.5" cy="13.8" r=".6"/><circle cx="14.5" cy="13.8" r=".6"/>',
    metro: '<rect x="5.5" y="3.5" width="13" height="14" rx="3"/><path d="M8 20.5l2-3M16 20.5l-2-3M9 8l3 3 3-3"/>',
    road: '<path d="M8 21 10.5 3M16 21 13.5 3M12 7v2M12 12v2M12 17v2"/>',
    landmark: '<path d="M4 20h16M6 20v-8M10 20v-8M14 20v-8M18 20v-8M3.5 12h17L12 5 3.5 12Z"/>',
  };
  const svg = (name, size = 16) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.landmark}</svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`);
  const fmtMin = (m) => (m < 60 ? `${Math.max(1, Math.round(m))} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`);

  let loading;
  function loadLib() {
    if (window.maplibregl) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = MAPLIBRE_CSS; document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = MAPLIBRE_JS; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
    });
    return loading;
  }

  // Recolour the OpenFreeMap "positron" style into the Zen Living palette
  function themeStyle(style) {
    for (const l of style.layers) {
      const sl = l['source-layer'] || '';
      const id = l.id;
      const p = (l.paint = l.paint || {});
      if (l.type === 'background') p['background-color'] = T.bg;
      else if (l.type === 'fill') {
        if (sl === 'water') p['fill-color'] = T.water;
        else if (sl === 'park' || /wood|grass|park|forest|meadow|landcover/.test(id)) { p['fill-color'] = T.park; p['fill-opacity'] = 0.85; }
        else if (sl === 'building') { p['fill-color'] = T.building; p['fill-outline-color'] = T.building; }
        else if (sl === 'landuse') p['fill-color'] = T.land;
        else if (sl === 'aeroway') p['fill-color'] = T.land;
      } else if (l.type === 'line') {
        if (sl === 'waterway') p['line-color'] = T.water;
        else if (sl === 'boundary') p['line-color'] = T.border;
        else if (sl === 'transportation') {
          if (/rail|transit/.test(id)) p['line-color'] = T.rail;
          else if (/casing/.test(id)) p['line-color'] = T.casing;
          else if (/motorway|trunk|primary/.test(id)) p['line-color'] = T.roadMajor;
          else p['line-color'] = T.road;
        } else if (sl === 'aeroway') p['line-color'] = T.casing;
      } else if (l.type === 'symbol') {
        if (sl === 'poi') { l.layout = { ...(l.layout || {}), visibility: 'none' }; continue; }
        p['text-color'] = sl === 'place' ? T.textStrong : T.text;
        p['text-halo-color'] = T.halo;
        p['text-halo-width'] = 1.4;
      }
    }
    return style;
  }

  function markerEl(cls, icon, label) {
    const el = document.createElement('div');
    el.className = `um-marker ${cls}`;
    el.innerHTML = `<span class="um-dot">${svg(icon, cls === 'um-home' ? 18 : 14)}</span>${label ? `<span class="um-label">${esc(label)}</span>` : ''}`;
    return el;
  }

  async function init(root, loc, hooks = {}) {
    const emit = (target) => hooks.onEvent && hooks.onEvent(target);
    const mapEl = root.querySelector('[data-map]');
    const card = root.querySelector('[data-card]');
    const list = root.querySelector('[data-list]');
    const home = [loc.unity.lng, loc.unity.lat];

    try { await loadLib(); } catch {
      mapEl.innerHTML = `<div class="map-fallback">Map couldn't load. <a href="${esc(loc.mapsUrl)}" target="_blank" rel="noopener">Open in Google Maps</a></div>`;
    }
    let map;
    if (window.maplibregl) {
      const style = themeStyle(await (await fetch(STYLE_URL)).json());
      map = new maplibregl.Map({
        container: mapEl, style, center: home, zoom: 13.2, attributionControl: false,
        cooperativeGestures: true, dragRotate: false, pitchWithRotate: false,
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '© OpenStreetMap contributors' }));
      new maplibregl.Marker({ element: markerEl('um-home', 'unity', 'The Palm Unity'), anchor: 'bottom' }).setLngLat(home).addTo(map);
      await new Promise((r) => (map.loaded() ? r() : map.once('load', r)));
      // keep the credits collapsed to an (i) button so they don't cover the map
      mapEl.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
      // Some PCs without GPU acceleration leave stale patches on the map after scrolling; repaint when scrolling stops
      let st;
      const repaint = () => { clearTimeout(st); st = setTimeout(() => map.triggerRepaint(), 150); };
      window.addEventListener('scroll', repaint, { passive: true });
      document.addEventListener('visibilitychange', () => { if (!document.hidden) map.triggerRepaint(); });
      map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FFFFFF', 'line-width': 8 } });
      map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': T.green, 'line-width': 4.5 } });
    }

    let destMarker = null;
    let catMarkers = [];
    let popup = null;
    const clearRoute = () => {
      if (!map) return;
      map.getSource('route').setData({ type: 'FeatureCollection', features: [] });
      destMarker?.remove(); destMarker = null;
    };
    const clearCats = () => { catMarkers.forEach((m) => m.remove()); catMarkers = []; popup?.remove(); };
    const fit = (pts, maxZoom = 15) => {
      if (!map || !pts.length) return;
      const b = new maplibregl.LngLatBounds(home, home);
      pts.forEach((p) => b.extend(p));
      const pad = window.innerWidth < 600 ? 40 : 70;
      map.fitBounds(b, { padding: { top: pad + (card.classList.contains('hidden') ? 0 : 70), bottom: pad, left: pad, right: pad }, maxZoom, duration: 700 });
    };
    const showCard = (html) => { card.innerHTML = html; card.classList.remove('hidden'); };

    // --- Connectivity: key places with route, distance and drive time ---
    root.querySelectorAll('[data-place]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = loc.keyPlaces.find((x) => x.id === btn.dataset.place);
        root.querySelectorAll('[data-place],[data-cat]').forEach((b) => b.classList.toggle('on', b === btn));
        clearCats(); list.innerHTML = '';
        btn.querySelector('.kp-meta').textContent = `${fmtKm(p.km)} · ${fmtMin(p.mins)}`;
        showCard(`<div class="mc-icon">${svg(p.icon, 18)}</div><div><b>${esc(p.name)}</b><span>${fmtKm(p.km)} · about ${fmtMin(p.mins)} by car</span>${p.note ? `<small>${esc(p.note)}</small>` : ''}</div>`);
        emit(`place:${p.id}`);
        if (!map) return;
        // card is already visible here, so fit() leaves room for it
        clearRoute();
        const coords = p.route && p.route.length > 1 ? p.route : [home, [p.lng, p.lat]];
        map.getSource('route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } });
        destMarker = new maplibregl.Marker({ element: markerEl('um-dest', p.icon, p.short || p.name), anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(map);
        fit(coords, 14);
      });
    });

    // --- Around Unity: category landmarks ---
    root.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const c = loc.categories.find((x) => x.id === btn.dataset.cat);
        const wasOn = btn.classList.contains('on');
        root.querySelectorAll('[data-place],[data-cat]').forEach((b) => b.classList.toggle('on', !wasOn && b === btn));
        clearRoute(); clearCats(); card.classList.add('hidden');
        if (wasOn) { list.innerHTML = ''; map?.easeTo({ center: home, zoom: 13.2 }); return; }
        emit(`cat:${c.id}`);
        const places = [...c.places].sort((a, b) => a.km - b.km);
        list.innerHTML = places.map((p, i) => `<button class="lm" data-i="${i}"><span class="lm-ic">${svg(c.icon, 14)}</span><span class="lm-n">${esc(p.name)}</span><span class="lm-d">${fmtKm(p.km)} · ${fmtMin(p.mins)}</span></button>`).join('');
        const open = (p, m) => {
          if (!map) return;
          popup?.remove();
          popup = new maplibregl.Popup({ offset: 22, closeButton: false, className: 'um-pop' })
            .setLngLat([p.lng, p.lat])
            .setHTML(`<b>${esc(p.name)}</b><span>${fmtKm(p.km)} · about ${fmtMin(p.mins)} by car</span>`)
            .addTo(map);
          catMarkers.forEach((x) => x.getElement().classList.toggle('on', x === m));
        };
        if (map) {
          places.forEach((p) => {
            const m = new maplibregl.Marker({ element: markerEl('um-poi', c.icon), anchor: 'center' }).setLngLat([p.lng, p.lat]).addTo(map);
            m.getElement().addEventListener('click', (e) => { e.stopPropagation(); open(p, m); });
            catMarkers.push(m);
          });
          fit(places.map((p) => [p.lng, p.lat]));
        }
        list.querySelectorAll('.lm').forEach((el) => el.addEventListener('click', () => {
          const i = +el.dataset.i; const p = places[i];
          list.querySelectorAll('.lm').forEach((x) => x.classList.toggle('on', x === el));
          map?.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 14.5) });
          open(p, catMarkers[i]);
          mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }));
      });
    });
  }

  window.UnityMap = { init, svg, fmtKm, fmtMin };
})();
