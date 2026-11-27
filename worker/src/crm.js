// CRM integration: the CRM pushes leads in, gets back a personal project-page link,
// and can look up that link again later. Leads keep the CRM's own lead ID (crm_id). No engagement data goes back to the CRM.
import { json, bad, now, sha256, clean, readJson, normalisePhone, newShareId } from './lib.js';


function apiKeyFrom(request) {
  const h = request.headers.get('authorization') || '';
  if (/^bearer\s+/i.test(h)) return h.replace(/^bearer\s+/i, '').trim();
  return (request.headers.get('x-api-key') || '').trim();
}

async function checkKey(request, env) {
  const key = apiKeyFrom(request);
  if (!key.startsWith('plms_')) return null;
  const row = await env.DB.prepare('SELECT * FROM api_keys WHERE key_hash=? AND active=1').bind(await sha256(key)).first();
  if (!row) return null;
  await env.DB.prepare('UPDATE api_keys SET last_used=? WHERE id=?').bind(now(), row.id).run();
  return row;
}

const inviteLink = (env, lead) => `${env.SITE_URL || ''}?i=${lead.invite_id}`;

async function salesFrom(env, value) {
  const v = clean(value, 60);
  if (!v) return null;
  const phone = normalisePhone(v);
  const row = phone
    ? await env.DB.prepare("SELECT code FROM salespeople WHERE phone=? AND role IN ('sales','super_admin') AND active=1").bind(phone).first()
    : await env.DB.prepare("SELECT code FROM salespeople WHERE (code=? OR lower(name)=lower(?)) AND role IN ('sales','super_admin') AND active=1").bind(v, v).first();
  return row?.code || null;
}

// What the CRM gets back: only the mapping and the personal link — no engagement data
const reply = (env, l) => ({ crm_id: l.crm_id, lead_id: l.id, link: inviteLink(env, l) });

export async function crmRoute(request, env, url, p, m) {
  const key = await checkKey(request, env);
  if (!key) return bad('Invalid or missing API key. Send it as "Authorization: Bearer plms_…".', 401);

  if (p === '/api/crm/leads' && m === 'POST') return upsertLead(request, env, key);
  const one = p.match(/^\/api\/crm\/leads\/([^/]+)$/);
  if (one && m === 'GET') return getLead(env, decodeURIComponent(one[1]));
  return bad('Not found', 404);
}

async function upsertLead(request, env, key) {
  const b = await readJson(request);
  const crmId = clean(b.crm_id ?? b.lead_id ?? b.id, 80);
  const name = clean(b.name, 80);
  const phone = normalisePhone(b.phone ?? b.mobile);
  if (!crmId) return bad('crm_id is required.');
  if (!name) return bad('name is required.');
  if (!phone) return bad('phone must be a valid 10-digit Indian mobile number.');
  const email = clean(b.email, 120) || null;
  const source = clean(b.source, 80) || 'CRM';
  const notes = clean(b.notes, 1000) || null;
  const assigned = await salesFrom(env, b.assigned_to);
  const t = now();

  const byCrm = await env.DB.prepare('SELECT * FROM leads WHERE crm_id=?').bind(crmId).first();
  const byPhone = await env.DB.prepare('SELECT * FROM leads WHERE phone=?').bind(phone).first();
  let lead, result;

  if (byCrm) {
    // Same CRM lead sent again: refresh contact details (phone only if it isn't someone else's)
    const newPhone = !byPhone || byPhone.id === byCrm.id ? phone : byCrm.phone;
    await env.DB.prepare('UPDATE leads SET name=?, phone=?, email=COALESCE(?,email), assigned_to=COALESCE(assigned_to,?), invite_id=COALESCE(invite_id,?) WHERE id=?')
      .bind(name, newPhone, email, assigned, newShareId(), byCrm.id).run();
    lead = await env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(byCrm.id).first();
    result = { result: 'updated' };
  } else if (byPhone) {
    if (byPhone.crm_id && byPhone.crm_id !== crmId) {
      // The number is already mapped to a different CRM lead — don't break that mapping
      return json({ ok: false, error: 'phone_already_mapped', message: 'This phone number already belongs to another CRM lead.', mapped_crm_id: byPhone.crm_id }, 409);
    }
    await env.DB.prepare('UPDATE leads SET crm_id=?, email=COALESCE(email,?), assigned_to=COALESCE(assigned_to,?), invite_id=COALESCE(invite_id,?) WHERE id=?')
      .bind(crmId, email, assigned, newShareId(), byPhone.id).run();
    lead = await env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(byPhone.id).first();
    result = { result: 'linked' };
  } else {
    const r = await env.DB.prepare(
      'INSERT INTO leads (phone, name, email, crm_id, source, notes, assigned_to, first_ref, last_ref, share_id, invite_id, created_at, last_seen, sessions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)'
    ).bind(phone, name, email, crmId, source, notes, assigned, assigned, assigned, newShareId(), newShareId(), t, t).run();
    lead = await env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(r.meta.last_row_id).first();
    result = { result: 'created' };
    await env.DB.prepare('INSERT INTO events (lead_id, type, target, value, ts) VALUES (?,?,?,?,?)').bind(lead.id, 'crm_created', key.name, 0, t).run();
  }
  return json({ ok: true, ...result, ...reply(env, lead) }, result.result === 'created' ? 201 : 200);
}

// Look up the link for a CRM lead that is already registered here
async function getLead(env, crmId) {
  const l = await env.DB.prepare('SELECT id, crm_id, invite_id FROM leads WHERE crm_id=?').bind(crmId).first();
  if (!l) return json({ ok: false, error: 'not_registered', message: 'No lead with this crm_id.' }, 404);
  return json({ ok: true, ...reply(env, l) });
}

// Public: someone opened their personal link (?i=…). Returns only the first name, to greet them and prefill the form.
export async function inviteOpen(request, env) {
  const b = await readJson(request);
  const id = clean(b.invite, 16);
  if (!/^[a-z0-9]{6}$/.test(id)) return json({ ok: false });
  const l = await env.DB.prepare('SELECT id, name, verified_at FROM leads WHERE invite_id=?').bind(id).first();
  if (!l) return json({ ok: false });
  const t = now();
  const recent = await env.DB.prepare("SELECT 1 FROM events WHERE lead_id=? AND type='invite_open' AND ts>?").bind(l.id, t - 1800).first();
  if (!recent) await env.DB.prepare('INSERT INTO events (lead_id, type, target, value, ts) VALUES (?,?,?,?,?)').bind(l.id, 'invite_open', '', 0, t).run();
  return json({ ok: true, firstName: String(l.name || '').split(' ')[0] });
}

// ---------- API keys (super admin) ----------
export async function listKeys(env) {
  const keys = (await env.DB.prepare('SELECT k.id, k.name, k.prefix, k.created_at, k.last_used, k.active, s.name AS created_by_name FROM api_keys k LEFT JOIN salespeople s ON s.code=k.created_by ORDER BY k.created_at DESC').all()).results;
  const linked = (await env.DB.prepare('SELECT COUNT(*) n FROM leads WHERE crm_id IS NOT NULL').first()).n;
  return json({ keys, linked, endpoint: '/api/crm/leads' });
}

export async function createKey(request, env, me) {
  const b = await readJson(request);
  const name = clean(b.name, 60) || 'CRM';
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const key = 'plms_' + [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare('INSERT INTO api_keys (name, key_hash, prefix, created_by, created_at, active) VALUES (?,?,?,?,?,1)')
    .bind(name, await sha256(key), key.slice(0, 10), me.code, now()).run();
  return json({ ok: true, key, name });
}

export async function revokeKey(env, id) {
  await env.DB.prepare('UPDATE api_keys SET active=0 WHERE id=?').bind(id).run();
  return json({ ok: true });
}


// ---------- Outbound: send verified website leads into the Reecosys CRM ----------
const PUSH_URL = 'https://www.reecosys.com/api/Services/LeadNew';
const PUSH_KEYS = ['push_api_key', 'push_project', 'push_sub_source', 'push_enabled'];

async function getPush(env) {
  const rows = (await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN (${PUSH_KEYS.map(() => '?').join(',')})`).bind(...PUSH_KEYS).all()).results;
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { key: m.push_api_key || '', project: m.push_project || '', subSource: m.push_sub_source || 'Unity Website', enabled: m.push_enabled === '1' };
}

export async function pushSettings(env) {
  const s = await getPush(env);
  const stats = (await env.DB.prepare("SELECT crm_push_status st, COUNT(*) n FROM leads WHERE crm_push_status IS NOT NULL GROUP BY crm_push_status").all()).results;
  return json({ ok: true, push: { keySet: !!s.key, keyHint: s.key ? s.key.slice(-4) : '', project: s.project, subSource: s.subSource, enabled: s.enabled, stats: Object.fromEntries(stats.map((r) => [r.st, r.n])) } });
}

export async function savePushSettings(request, env, me) {
  const b = await readJson(request);
  const t = now();
  const put = (k, v) => env.DB.prepare('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by').bind(k, v, t, me.code).run();
  if (typeof b.apiKey === 'string' && b.apiKey.trim()) await put('push_api_key', clean(b.apiKey, 200));
  if (typeof b.project === 'string') await put('push_project', clean(b.project, 120));
  if (typeof b.subSource === 'string') await put('push_sub_source', clean(b.subSource, 80) || 'Unity Website');
  if (typeof b.enabled === 'boolean') await put('push_enabled', b.enabled ? '1' : '0');
  return pushSettings(env);
}

// Sends one lead. Skips leads that came from the CRM, team/test entries and leads already sent (unless force).
export async function pushLead(env, leadId, force = false) {
  const s = await getPush(env);
  if (!s.key || !s.project) return { ok: false, skipped: 'Connection not set up yet' };
  if (!s.enabled && !force) return { ok: false, skipped: 'Sending is switched off' };
  const l = await env.DB.prepare(`SELECT l.*, sp.name AS src_name, sp.role AS src_role, sp.company AS src_company, rb.name AS ref_name,
      (COALESCE(l.internal,0)=1 OR (COALESCE(l.internal,0)=0 AND l.phone IN (SELECT phone FROM salespeople WHERE COALESCE(phone,'')!=''))) AS is_internal
    FROM leads l LEFT JOIN salespeople sp ON sp.code = l.first_ref LEFT JOIN leads rb ON rb.id = l.referred_by WHERE l.id=?`).bind(leadId).first();
  if (!l) return { ok: false, skipped: 'Client not found' };
  if (l.crm_id) return { ok: false, skipped: 'This lead came from the CRM' };
  if (l.is_internal) return { ok: false, skipped: 'Team / test entry' };
  if (!l.verified_at) return { ok: false, skipped: 'Not verified yet' };
  if (l.crm_push_status === 'sent' && !force) return { ok: true, skipped: 'Already sent' };

  const [srcName, srcCampaign] = String(l.source || '').split('/');
  const via = l.src_role === 'channel_partner' ? `Channel partner: ${l.src_name}${l.src_company ? ` (${l.src_company})` : ''}`
    : l.ref_name ? `Shared by client: ${l.ref_name}`
    : l.gclid ? 'Google Ads'
    : l.src_name ? `Team link: ${l.src_name}`
    : l.source ? `Source: ${l.source}` : 'Direct visit';
  const body = new URLSearchParams({
    full_name: l.name,
    email_address: l.email || '',
    contact_no: l.phone,
    country_code: '91',
    project_name: s.project,
    sub_source: s.subSource,
    remarks: [`Verified on WhatsApp at unity.thepalm.in`, via, l.profession ? `Profession: ${l.profession}` : ''].filter(Boolean).join(' · '),
    utm_source: l.gclid ? 'Google Ads' : l.src_role === 'channel_partner' ? l.src_name : srcName || 'unity.thepalm.in',
    utm_campaign: srcCampaign || '',
    utm_gclid: l.gclid || '',
  });
  let status = 'failed', msg = '';
  try {
    const r = await fetch(PUSH_URL, { method: 'POST', headers: { Authorization: `api_key ${s.key}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(12000) });
    const text = (await r.text()).trim();
    let d = {}; try { d = JSON.parse(text); } catch { d = { message: text.slice(0, 200) }; }
    msg = clean(d.message || `HTTP ${r.status}`, 200);
    if (Number(d.success) === 1) status = 'sent';
  } catch (e) { msg = clean(`Could not reach the CRM: ${e.message || e}`, 200); }
  await env.DB.prepare('UPDATE leads SET crm_push_status=?, crm_push_at=?, crm_push_msg=? WHERE id=?').bind(status, now(), msg, leadId).run();
  return { ok: status === 'sent', status, message: msg };
}
