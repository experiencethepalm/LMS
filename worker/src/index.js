// The Palm Unity — lead platform API (Cloudflare Worker + D1)
import content from '../content/unity.json';
import { json, bad, now, sha256, signToken, verifyToken, bearer, normalisePhone, clean, sixDigitCode, readJson } from './lib.js';
import { sendOtp } from './otp.js';
import { scoreLead } from './score.js';
import { askAssistant } from './chat.js';

const BUYER_TTL = 180 * 86400;   // verified buyers stay unlocked for 6 months on that device
const ADMIN_TTL = 12 * 3600;
const OTP_TTL = 600;             // code valid 10 minutes
const NEW_SESSION_GAP = 30 * 60; // a return after 30 min counts as a new visit
const STATUSES = ['new', 'contacted', 'visit_booked', 'visited', 'negotiating', 'booked', 'lost'];
const EVENT_TYPES = ['dwell', 'floorplan_open', 'brochure_open', 'gallery_open', 'walkthrough_play', 'cta', 'map'];

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let res;
    try {
      res = await route(request, env, ctx);
    } catch (err) {
      console.error(err);
      res = bad('Something went wrong. Please try again.', 500);
    }
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
};

function corsHeaders(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes('*') || allowed.includes(origin);
  return {
    'access-control-allow-origin': ok ? origin : allowed[0] || '',
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const p = url.pathname.replace(/\/+$/, '');
  const m = request.method;

  if (p === '/api/health') return json({ ok: true });
  if (p === '/api/otp/start' && m === 'POST') return otpStart(request, env);
  if (p === '/api/otp/verify' && m === 'POST') return otpVerify(request, env);
  if (p === '/api/me' && m === 'GET') return me(request, env);
  if (p === '/api/track' && m === 'POST') return track(request, env);
  if (p === '/api/chat' && m === 'POST') return chat(request, env);
  if (p === '/api/request' && m === 'POST') return buyerRequest(request, env, ctx);

  if (p === '/api/admin/login' && m === 'POST') return adminLogin(request, env);
  if (p.startsWith('/api/admin/')) {
    const admin = await verifyToken(bearer(request), env.TOKEN_SECRET);
    if (!admin || !['owner', 'sales'].includes(admin.role)) return bad('Please sign in again.', 401);
    if (p === '/api/admin/leads' && m === 'GET') return listLeads(env, admin, url);
    const lm = p.match(/^\/api\/admin\/leads\/(\d+)$/);
    if (lm && m === 'GET') return leadDetail(env, admin, Number(lm[1]));
    if (lm && m === 'PATCH') return updateLead(request, env, admin, Number(lm[1]));
    if (p === '/api/admin/salespeople' && m === 'GET') return listSales(env, admin);
    if (p === '/api/admin/salespeople' && m === 'POST') return upsertSales(request, env, admin);
    if (p === '/api/admin/requests' && m === 'GET') return listRequests(env, admin);
    const rm = p.match(/^\/api\/admin\/requests\/(\d+)$/);
    if (rm && m === 'PATCH') return markRequest(env, admin, Number(rm[1]));
    if (p === '/api/admin/export.csv' && m === 'GET') return exportCsv(env, admin);
  }
  return bad('Not found', 404);
}

// ---------- Buyer: OTP ----------

async function otpStart(request, env) {
  const body = await readJson(request);
  const phone = normalisePhone(body.phone);
  const name = clean(body.name, 80);
  if (!name || name.length < 2) return bad('Please enter your full name.');
  if (!phone) return bad('Please enter a valid 10-digit mobile number.');
  if (body.consent !== true) return bad('Please accept the consent to continue.');

  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const t = now();
  const perPhone = await env.DB.prepare('SELECT COUNT(*) n FROM otps WHERE phone=? AND created_at>?').bind(phone, t - 900).first();
  if (perPhone.n >= 3) return bad('Too many codes requested. Please try again in 15 minutes.', 429);
  const perIp = await env.DB.prepare('SELECT COUNT(*) n FROM otps WHERE ip=? AND created_at>?').bind(ip, t - 3600).first();
  if (perIp.n >= 10) return bad('Too many requests from this network. Please try again later.', 429);

  const code = sixDigitCode();
  const pending = JSON.stringify({
    name,
    profession: clean(body.profession, 80),
    ref: clean(body.ref, 32).toUpperCase(),
    source: clean(body.source, 80),
  });
  await env.DB.prepare('INSERT INTO otps (phone, code_hash, expires_at, created_at, ip, pending) VALUES (?,?,?,?,?,?)')
    .bind(phone, await sha256(`${phone}:${code}:${env.TOKEN_SECRET}`), t + OTP_TTL, t, ip, pending).run();

  const sent = await sendOtp(env, phone, code);
  return json({ ok: true, channel: sent.channel, ...(sent.devCode ? { devCode: sent.devCode } : {}) });
}

async function otpVerify(request, env) {
  const body = await readJson(request);
  const phone = normalisePhone(body.phone);
  const code = String(body.code || '').replace(/\D/g, '');
  if (!phone || code.length !== 6) return bad('Please enter the 6-digit code.');

  const t = now();
  const row = await env.DB.prepare('SELECT rowid, * FROM otps WHERE phone=? ORDER BY created_at DESC LIMIT 1').bind(phone).first();
  if (!row || row.expires_at < t) return bad('This code has expired. Please request a new one.');
  if (row.attempts >= 5) return bad('Too many wrong attempts. Please request a new code.', 429);
  if ((await sha256(`${phone}:${code}:${env.TOKEN_SECRET}`)) !== row.code_hash) {
    await env.DB.prepare('UPDATE otps SET attempts=attempts+1 WHERE rowid=?').bind(row.rowid).run();
    return bad('That code is not right. Please check and try again.');
  }
  await env.DB.prepare('UPDATE otps SET expires_at=0 WHERE rowid=?').bind(row.rowid).run();

  const info = JSON.parse(row.pending || '{}');
  const ref = await validRef(env, info.ref);
  const existing = await env.DB.prepare('SELECT * FROM leads WHERE phone=?').bind(phone).first();
  let leadId;
  if (existing) {
    leadId = existing.id;
    await env.DB.prepare(
      `UPDATE leads SET name=?, profession=COALESCE(NULLIF(?,''),profession), last_ref=COALESCE(?,last_ref), first_ref=COALESCE(first_ref,?), last_seen=?, sessions=sessions+1 WHERE id=?`
    ).bind(info.name, info.profession || '', ref, ref, t, leadId).run();
  } else {
    const r = await env.DB.prepare(
      'INSERT INTO leads (phone, name, profession, first_ref, last_ref, source, created_at, last_seen) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(phone, info.name, info.profession || null, ref, ref, info.source || null, t, t).run();
    leadId = r.meta.last_row_id;
  }
  await logEvents(env, leadId, [{ type: 'session_start', target: ref || '' }]);

  const token = await signToken({ sub: leadId, role: 'buyer' }, env.TOKEN_SECRET, BUYER_TTL);
  return json({ ok: true, token, name: info.name, content });
}

async function validRef(env, code) {
  if (!code) return null;
  const sp = await env.DB.prepare('SELECT code FROM salespeople WHERE code=? AND active=1').bind(code).first();
  return sp ? sp.code : null;
}

async function buyerFrom(request, env, bodyToken) {
  const tok = await verifyToken(bearer(request) || bodyToken, env.TOKEN_SECRET);
  if (!tok || tok.role !== 'buyer') return null;
  return env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(tok.sub).first();
}

// Returning visitor: re-opens the page without a new OTP
async function me(request, env) {
  const lead = await buyerFrom(request, env);
  if (!lead) return bad('Please verify to continue.', 401);
  const url = new URL(request.url);
  const ref = await validRef(env, clean(url.searchParams.get('ref'), 32).toUpperCase());
  const t = now();
  if (t - lead.last_seen > NEW_SESSION_GAP) {
    await env.DB.prepare('UPDATE leads SET sessions=sessions+1, last_seen=?, last_ref=COALESCE(?,last_ref) WHERE id=?').bind(t, ref, lead.id).run();
    await logEvents(env, lead.id, [{ type: 'session_start', target: ref || '' }]);
  } else {
    await env.DB.prepare('UPDATE leads SET last_seen=? WHERE id=?').bind(t, lead.id).run();
  }
  return json({ ok: true, name: lead.name, content });
}

// ---------- Buyer: tracking, chat, requests ----------

async function track(request, env) {
  // Accepts sendBeacon (text/plain body) as well as fetch
  let body = {};
  try { body = JSON.parse(await request.text()); } catch {}
  const lead = await buyerFrom(request, env, body.token);
  if (!lead) return bad('Unauthorized', 401);
  const events = (Array.isArray(body.events) ? body.events : [])
    .slice(0, 50)
    .filter((e) => EVENT_TYPES.includes(e.type))
    .map((e) => ({
      type: e.type,
      target: clean(e.target, 40),
      value: e.type === 'dwell' ? Math.max(0, Math.min(Number(e.value) || 0, 600)) : null,
    }))
    .filter((e) => e.type !== 'dwell' || e.value >= 1);
  await logEvents(env, lead.id, events);
  await env.DB.prepare('UPDATE leads SET last_seen=? WHERE id=?').bind(now(), lead.id).run();
  return json({ ok: true });
}

async function logEvents(env, leadId, events) {
  if (!events.length) return;
  const t = now();
  const stmt = env.DB.prepare('INSERT INTO events (lead_id, type, target, value, ts) VALUES (?,?,?,?,?)');
  await env.DB.batch(events.map((e) => stmt.bind(leadId, e.type, e.target ?? null, e.value ?? null, t)));
}

async function chat(request, env) {
  const body = await readJson(request);
  const lead = await buyerFrom(request, env);
  if (!lead) return bad('Please verify to use the assistant.', 401);
  const question = clean(body.message, 600);
  if (!question) return bad('Please type a question.');

  const today = await env.DB.prepare("SELECT COUNT(*) n FROM chats WHERE lead_id=? AND role='user' AND ts>?").bind(lead.id, now() - 86400).first();
  if (today.n >= 40) return json({ reply: "You've asked a lot today — our sales team can take it from here. Tap Request callback and we'll call you." });

  const past = await env.DB.prepare('SELECT role, content FROM chats WHERE lead_id=? ORDER BY ts DESC, id DESC LIMIT 10').bind(lead.id).all();
  const history = past.results.reverse().map((r) => ({ role: r.role, content: r.content }));
  history.push({ role: 'user', content: question });
  while (history.length && history[0].role !== 'user') history.shift();

  let reply;
  if (!env.ANTHROPIC_API_KEY) {
    reply = 'The assistant is not configured yet. Please tap Request callback and our team will answer.';
  } else {
    try {
      reply = await askAssistant(env, history);
    } catch (e) {
      console.error(e);
      reply = "Sorry, I couldn't answer just now. Please try again, or tap Request callback.";
    }
  }
  const t = now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO chats (lead_id, role, content, ts) VALUES (?,?,?,?)').bind(lead.id, 'user', question, t),
    env.DB.prepare('INSERT INTO chats (lead_id, role, content, ts) VALUES (?,?,?,?)').bind(lead.id, 'assistant', reply, t),
  ]);
  return json({ reply });
}

async function buyerRequest(request, env, ctx) {
  const body = await readJson(request);
  const lead = await buyerFrom(request, env);
  if (!lead) return bad('Please verify first.', 401);
  const kind = body.kind === 'site_visit' ? 'site_visit' : 'callback';
  await env.DB.prepare('INSERT INTO requests (lead_id, kind, preferred_date, slot, message, created_at) VALUES (?,?,?,?,?,?)')
    .bind(lead.id, kind, clean(body.date, 20) || null, clean(body.slot, 40) || null, clean(body.message, 300) || null, now()).run();
  ctx.waitUntil(alert(env, `${kind === 'site_visit' ? '🏠 Site visit request' : '📞 Callback request'} — ${lead.name} (${lead.phone})` +
    (body.date ? ` · ${clean(body.date, 20)} ${clean(body.slot, 40)}` : '') + (lead.first_ref ? ` · ref ${lead.first_ref}` : '')));
  return json({ ok: true });
}

// Optional: post hot-lead alerts to a webhook (Google Chat / Slack / Discord / your own endpoint)
async function alert(env, text) {
  if (!env.ALERT_WEBHOOK_URL) return;
  try {
    await fetch(env.ALERT_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, content: text }) });
  } catch (e) { console.error('alert failed', e); }
}

// ---------- Admin ----------

async function adminLogin(request, env) {
  const body = await readJson(request);
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  if (body.password) {
    if (!env.ADMIN_PASSWORD || body.password !== env.ADMIN_PASSWORD) return bad('Wrong password.', 401);
    return json({ token: await signToken({ role: 'owner', name: 'Owner' }, env.TOKEN_SECRET, ADMIN_TTL), role: 'owner', name: 'Owner' });
  }
  const code = clean(body.code, 32).toUpperCase();
  const sp = await env.DB.prepare('SELECT * FROM salespeople WHERE code=? AND active=1').bind(code).first();
  if (!sp || !sp.pin_hash || (await sha256(`${code}:${body.pin}:${env.TOKEN_SECRET}`)) !== sp.pin_hash) {
    console.log('failed sales login', code, ip);
    return bad('Wrong code or PIN.', 401);
  }
  return json({ token: await signToken({ role: 'sales', code, name: sp.name }, env.TOKEN_SECRET, ADMIN_TTL), role: 'sales', name: sp.name, code });
}

const scopeSql = (admin) => (admin.role === 'sales' ? { where: 'WHERE l.first_ref = ?', args: [admin.code] } : { where: '', args: [] });

async function listLeads(env, admin, url) {
  const scope = scopeSql(admin);
  let where = scope.where, args = [...scope.args];
  const ref = url.searchParams.get('ref');
  if (admin.role === 'owner' && ref === 'none') { where = 'WHERE l.first_ref IS NULL'; args = []; }
  else if (admin.role === 'owner' && ref) { where = 'WHERE l.first_ref = ?'; args = [ref]; }

  const leads = (await env.DB.prepare(`SELECT l.* FROM leads l ${where} ORDER BY l.last_seen DESC LIMIT 2000`).bind(...args).all()).results;
  if (!leads.length) return json({ leads: [] });
  // Subquery keeps bound parameters small (D1 allows max 100 per query)
  const inScope = `lead_id IN (SELECT l.id FROM leads l ${where})`;
  const agg = await groupBy(env, `SELECT lead_id, type, target, COUNT(*) n, SUM(value) v FROM events WHERE ${inScope} GROUP BY lead_id, type, target`, args);
  const chats = await groupBy(env, `SELECT lead_id, COUNT(*) n FROM chats WHERE role='user' AND ${inScope} GROUP BY lead_id`, args);
  const reqs = await groupBy(env, `SELECT lead_id, kind, handled FROM requests WHERE ${inScope}`, args);

  const out = leads.map((l) => {
    const s = scoreLead(l, agg[l.id] || [], (chats[l.id] || [{ n: 0 }])[0].n, reqs[l.id] || []);
    const open = (reqs[l.id] || []).filter((r) => !r.handled).map((r) => r.kind);
    return { ...l, score: s.score, priority: s.priority, openRequests: open, questions: (chats[l.id] || [{ n: 0 }])[0].n };
  });
  out.sort((a, b) => b.score - a.score || b.last_seen - a.last_seen);
  return json({ leads: out });
}

async function groupBy(env, sql, ids) {
  const res = (await env.DB.prepare(sql).bind(...ids).all()).results;
  const map = {};
  for (const r of res) (map[r.lead_id] ||= []).push(r);
  return map;
}

async function getScopedLead(env, admin, id) {
  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(id).first();
  if (!lead) return null;
  if (admin.role === 'sales' && lead.first_ref !== admin.code) return null;
  return lead;
}

async function leadDetail(env, admin, id) {
  const lead = await getScopedLead(env, admin, id);
  if (!lead) return bad('Lead not found', 404);
  const agg = (await env.DB.prepare('SELECT type, target, COUNT(*) n, SUM(value) v FROM events WHERE lead_id=? GROUP BY type, target').bind(id).all()).results;
  const timeline = (await env.DB.prepare("SELECT type, target, value, ts FROM events WHERE lead_id=? AND type!='dwell' ORDER BY ts DESC LIMIT 200").bind(id).all()).results;
  const chats = (await env.DB.prepare('SELECT role, content, ts FROM chats WHERE lead_id=? ORDER BY ts, id').bind(id).all()).results;
  const requests = (await env.DB.prepare('SELECT * FROM requests WHERE lead_id=? ORDER BY created_at DESC').bind(id).all()).results;
  const s = scoreLead(lead, agg, chats.filter((c) => c.role === 'user').length, requests);
  return json({ lead, ...s, timeline, chats, requests, openingLine: openingLine(lead, s, chats, requests) });
}

// A suggested first line for the sales call, based on what the buyer looked at
function openingLine(lead, s, chats, requests) {
  const first = lead.name.split(' ')[0];
  const topSection = Object.entries(s.dwell).sort((a, b) => b[1] - a[1])[0]?.[0];
  const PLACE = { gift: 'GIFT City', airport: 'the airport', infocity: 'Infocity', mahatma: 'Mahatma Mandir', railway: 'the railway station', vaishnodevi: 'SG Highway', metro: 'the metro' };
  const checked = [...new Set(s.places || [])].map((id) => PLACE[id]).filter(Boolean);
  const lastQ = [...chats].reverse().find((c) => c.role === 'user')?.content;
  if (requests.some((r) => r.kind === 'site_visit')) return `Hi ${first}, this is from The Palm Unity — calling to confirm your site visit. Which day suits you best?`;
  if (lastQ) return `Hi ${first}, this is from The Palm Unity. I saw you asked "${lastQ.slice(0, 80)}" — happy to take you through that properly.`;
  if (checked.length) return `Hi ${first}, this is from The Palm Unity. I noticed you checked the commute to ${checked.slice(0, 2).join(' and ')} — Unity is well placed for that. Would a quick site visit this week help?`;
  if (topSection === 'floorplans') return `Hi ${first}, this is from The Palm Unity. You were looking at our floor plans — shall I share the layouts that are still available on your preferred floor?`;
  if (topSection === 'payment') return `Hi ${first}, this is from The Palm Unity. You were checking the payment plan — I can share the full cost sheet for the home you liked.`;
  if (topSection === 'location') return `Hi ${first}, this is from The Palm Unity. You were exploring the location — would a quick site visit this week help?`;
  return `Hi ${first}, this is from The Palm Unity. Thanks for checking out the project — what kind of home are you looking for?`;
}

async function updateLead(request, env, admin, id) {
  const lead = await getScopedLead(env, admin, id);
  if (!lead) return bad('Lead not found', 404);
  const body = await readJson(request);
  const status = STATUSES.includes(body.status) ? body.status : lead.status;
  const notes = body.notes !== undefined ? clean(body.notes, 4000) : lead.notes;
  let firstRef = lead.first_ref;
  if (admin.role === 'owner' && body.first_ref !== undefined) firstRef = body.first_ref ? await validRef(env, clean(body.first_ref, 32).toUpperCase()) : null;
  await env.DB.prepare('UPDATE leads SET status=?, notes=?, first_ref=? WHERE id=?').bind(status, notes, firstRef, id).run();
  return json({ ok: true });
}

async function listSales(env, admin) {
  const rows = (await env.DB.prepare('SELECT code, name, phone, active, created_at FROM salespeople ORDER BY name').all()).results;
  const visible = admin.role === 'owner' ? rows : rows.filter((r) => r.code === admin.code);
  return json({ salespeople: visible, siteUrl: env.SITE_URL || '' });
}

async function upsertSales(request, env, admin) {
  if (admin.role !== 'owner') return bad('Only the owner can manage the team.', 403);
  const b = await readJson(request);
  const code = clean(b.code, 16).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code || !clean(b.name)) return bad('Code and name are required.');
  const existing = await env.DB.prepare('SELECT * FROM salespeople WHERE code=?').bind(code).first();
  const pinHash = b.pin ? await sha256(`${code}:${b.pin}:${env.TOKEN_SECRET}`) : existing?.pin_hash || null;
  if (!pinHash) return bad('Set a PIN for the new salesperson.');
  const active = b.active === false ? 0 : 1;
  if (existing) {
    await env.DB.prepare('UPDATE salespeople SET name=?, phone=?, pin_hash=?, active=? WHERE code=?').bind(clean(b.name), clean(b.phone, 20), pinHash, active, code).run();
  } else {
    await env.DB.prepare('INSERT INTO salespeople (code, name, phone, pin_hash, active, created_at) VALUES (?,?,?,?,?,?)').bind(code, clean(b.name), clean(b.phone, 20), pinHash, active, now()).run();
  }
  return json({ ok: true });
}

async function listRequests(env, admin) {
  const scope = scopeSql(admin);
  const rows = (await env.DB.prepare(
    `SELECT r.*, l.name, l.phone, l.first_ref FROM requests r JOIN leads l ON l.id=r.lead_id ${scope.where} ORDER BY r.handled, r.created_at DESC LIMIT 500`
  ).bind(...scope.args).all()).results;
  return json({ requests: rows });
}

async function markRequest(env, admin, id) {
  const r = await env.DB.prepare('SELECT r.*, l.first_ref FROM requests r JOIN leads l ON l.id=r.lead_id WHERE r.id=?').bind(id).first();
  if (!r || (admin.role === 'sales' && r.first_ref !== admin.code)) return bad('Not found', 404);
  await env.DB.prepare('UPDATE requests SET handled=1 WHERE id=?').bind(id).run();
  return json({ ok: true });
}

async function exportCsv(env, admin) {
  const fake = new URL('https://x/api/admin/leads');
  const { leads } = await (await listLeads(env, admin, fake)).json();
  const cols = ['id', 'name', 'phone', 'profession', 'first_ref', 'source', 'status', 'score', 'priority', 'sessions', 'questions', 'created_at', 'last_seen', 'notes'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const iso = (t) => (t ? new Date(t * 1000).toISOString() : '');
  const lines = [cols.join(',')].concat(
    leads.map((l) => cols.map((c) => esc(c === 'created_at' || c === 'last_seen' ? iso(l[c]) : l[c])).join(','))
  );
  return new Response(lines.join('\n'), { headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="unity-leads.csv"' } });
}
