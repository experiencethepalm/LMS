// The Palm Unity — lead platform API (Cloudflare Worker + D1)
import content from '../content/unity.json';
import { json, bad, now, sha256, signToken, verifyToken, bearer, normalisePhone, clean, sixDigitCode, readJson, newShareId } from './lib.js';
import { sendOtp } from './otp.js';
import { scoreLead } from './score.js';
import { askAssistant } from './chat.js';
import { adminRoute, assignLead } from './admin.js';
import { crmRoute, inviteOpen } from './crm.js';

const BUYER_TTL = 180 * 86400;   // verified buyers stay unlocked for 6 months on that device
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
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
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
  if (p === '/api/open' && m === 'POST') return linkOpen(request, env);
  if (p === '/api/track' && m === 'POST') return track(request, env);
  if (p === '/api/chat' && m === 'POST') return chat(request, env);
  if (p === '/api/request' && m === 'POST') return buyerRequest(request, env, ctx);

  if (p.startsWith('/api/admin/')) return adminRoute(request, env, url, p, m);
  if (p.startsWith('/api/crm/')) return crmRoute(request, env, url, p, m);
  if (p === '/api/invite' && m === 'POST') return inviteOpen(request, env);
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
  const perPhone = await env.DB.prepare("SELECT COUNT(*) n FROM otps WHERE phone=? AND created_at>? AND COALESCE(purpose,'buyer')='buyer'").bind(phone, t - 900).first();
  if (perPhone.n >= 3) return bad('Too many codes requested. Please try again in 15 minutes.', 429);
  const perIp = await env.DB.prepare('SELECT COUNT(*) n FROM otps WHERE ip=? AND created_at>?').bind(ip, t - 3600).first();
  if (perIp.n >= 10) return bad('Too many requests from this network. Please try again later.', 429);

  const code = sixDigitCode();
  const pending = JSON.stringify({
    name,
    profession: clean(body.profession, 80),
    ref: clean(body.ref, 32),
    device: clean(body.device, 40),
    source: clean(body.source, 80),
  });
  await env.DB.prepare("INSERT INTO otps (phone, code_hash, expires_at, created_at, ip, pending, purpose) VALUES (?,?,?,?,?,?,'buyer')")
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
  const row = await env.DB.prepare("SELECT rowid, * FROM otps WHERE phone=? AND COALESCE(purpose,'buyer')='buyer' ORDER BY created_at DESC LIMIT 1").bind(phone).first();
  if (!row || row.expires_at < t) return bad('This code has expired. Please request a new one.');
  if (row.attempts >= 5) return bad('Too many wrong attempts. Please request a new code.', 429);
  if ((await sha256(`${phone}:${code}:${env.TOKEN_SECRET}`)) !== row.code_hash) {
    await env.DB.prepare('UPDATE otps SET attempts=attempts+1 WHERE rowid=?').bind(row.rowid).run();
    return bad('That code is not right. Please check and try again.');
  }
  await env.DB.prepare('UPDATE otps SET expires_at=0 WHERE rowid=?').bind(row.rowid).run();

  const info = JSON.parse(row.pending || '{}');
  const via = await resolveRef(env, info.ref);          // { sales, leadId } — salesperson link or another buyer's link
  const ref = via.sales || null;
  const existing = await env.DB.prepare('SELECT * FROM leads WHERE phone=?').bind(phone).first();
  let leadId;
  if (existing) {
    leadId = existing.id;
    const referrer = !existing.referred_by && via.leadId && via.leadId !== leadId ? via.leadId : null;
    await env.DB.prepare(
      `UPDATE leads SET name=?, profession=COALESCE(NULLIF(?,''),profession), last_ref=COALESCE(?,last_ref), first_ref=COALESCE(first_ref,?), referred_by=COALESCE(referred_by,?), share_id=COALESCE(share_id,?), last_seen=?, sessions=sessions+1, verified_at=COALESCE(verified_at,?) WHERE id=?`
    ).bind(info.name, info.profession || '', ref, ref, referrer, newShareId(), t, t, leadId).run();
  } else {
    const r = await env.DB.prepare(
      'INSERT INTO leads (phone, name, profession, first_ref, last_ref, source, referred_by, share_id, created_at, last_seen, verified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(phone, info.name, info.profession || null, ref, ref, via.leadId ? 'shared by a buyer' : info.source || null, via.leadId || null, newShareId(), t, t, t).run();
    leadId = r.meta.last_row_id;
  }
  if (info.device) await env.DB.prepare('UPDATE link_opens SET verified_lead=? WHERE device=? AND verified_lead IS NULL').bind(leadId, info.device).run();
  await assignLead(env, leadId);
  await logEvents(env, leadId, [{ type: 'session_start', target: via.leadId ? `lead:${via.leadId}` : ref || '' }]);
  const mine = await env.DB.prepare('SELECT share_id FROM leads WHERE id=?').bind(leadId).first();

  const token = await signToken({ sub: leadId, role: 'buyer' }, env.TOKEN_SECRET, BUYER_TTL);
  return json({ ok: true, token, name: info.name, shareId: mine.share_id, content });
}

// Share links carry an opaque id (?r=k7m2qx) so buyers never see the salesperson's name.
// Older ?ref=CODE links keep working.
async function validRef(env, value) {
  const v = String(value || '').trim();
  if (!v) return null;
  const sp = await env.DB.prepare('SELECT code FROM salespeople WHERE (share_id=? OR code=?) AND active=1')
    .bind(v.toLowerCase(), v.toUpperCase()).first();
  return sp ? sp.code : null;
}

// A share id can belong to a salesperson or to a verified buyer who forwarded the page.
// A buyer's link keeps crediting the salesperson who brought that buyer in.
async function resolveRef(env, value) {
  const v = String(value || '').trim();
  if (!v) return {};
  const sales = await validRef(env, v);
  if (sales) return { sales };
  const ld = await env.DB.prepare('SELECT id, first_ref FROM leads WHERE share_id=?').bind(v.toLowerCase()).first();
  return ld ? { sales: ld.first_ref || null, leadId: ld.id } : {};
}

// Logged when anyone opens a shared link (before they verify), so the dashboard can show reach
async function linkOpen(request, env) {
  const body = await readJson(request);
  const ref = clean(body.ref, 32), device = clean(body.device, 40);
  if (!ref || !device) return json({ ok: true });
  const via = await resolveRef(env, ref);
  if (!via.sales && !via.leadId) return json({ ok: true });
  const t = now();
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const same = await env.DB.prepare('SELECT 1 FROM link_opens WHERE device=? AND ref=? AND ts>?').bind(device, ref, t - 1800).first();
  if (same) return json({ ok: true });                       // same person reopening within 30 min
  const flood = await env.DB.prepare('SELECT COUNT(*) n FROM link_opens WHERE ip=? AND ts>?').bind(ip, t - 3600).first();
  if (flood.n >= 60) return json({ ok: true });              // ignore floods from one network
  const known = await env.DB.prepare('SELECT verified_lead FROM link_opens WHERE device=? AND verified_lead IS NOT NULL LIMIT 1').bind(device).first();
  await env.DB.prepare('INSERT INTO link_opens (ref, sales_code, by_lead, device, ip, ts, verified_lead) VALUES (?,?,?,?,?,?,?)')
    .bind(ref, via.sales || null, via.leadId || null, device, ip, t, known?.verified_lead || null).run();
  return json({ ok: true });
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
  const ref = (await resolveRef(env, clean(url.searchParams.get('ref'), 32))).sales || null;
  if (!lead.share_id) { lead.share_id = newShareId(); await env.DB.prepare('UPDATE leads SET share_id=? WHERE id=?').bind(lead.share_id, lead.id).run(); }
  const t = now();
  if (t - lead.last_seen > NEW_SESSION_GAP) {
    await env.DB.prepare('UPDATE leads SET sessions=sessions+1, last_seen=?, last_ref=COALESCE(?,last_ref) WHERE id=?').bind(t, ref, lead.id).run();
    await logEvents(env, lead.id, [{ type: 'session_start', target: ref || '' }]);
  } else {
    await env.DB.prepare('UPDATE leads SET last_seen=? WHERE id=?').bind(t, lead.id).run();
  }
  return json({ ok: true, name: lead.name, shareId: lead.share_id, content });
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

// ---------- Admin: see admin.js ----------
