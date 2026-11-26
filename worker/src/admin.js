// Staff side of the platform: phone + WhatsApp OTP login, roles, channel partners, follow-ups, activity log.
//
// Roles
//   super_admin      sees everything; adds/edits any user and their role; sees staff activity
//   sales            sees all clients and channel partners; adds channel partners; owns follow-ups
//   channel_partner  gets a share link that credits clients to them (no dashboard login yet)
//
// Users live in the `salespeople` table (kept for compatibility with existing share links).
import { json, bad, now, sha256, signToken, verifyToken, bearer, normalisePhone, clean, sixDigitCode, readJson, newShareId } from './lib.js';
import { sendOtp } from './otp.js';
import { scoreLead } from './score.js';
import knowledge from '../content/knowledge.md';
import { listKeys, createKey, revokeKey } from './crm.js';

const STAFF_TTL = 7 * 86400;
const OTP_TTL = 600;
const ROLES = ['super_admin', 'sales', 'channel_partner'];
const LOGIN_ROLES = ['super_admin', 'sales'];
const STATUSES = ['new', 'contacted', 'visit_booked', 'visited', 'negotiating', 'booked', 'lost'];
const FU_KINDS = ['call', 'whatsapp', 'meeting', 'site_visit', 'other'];

export async function adminRoute(request, env, url, p, m) {
  if (p === '/api/admin/otp/start' && m === 'POST') return staffOtpStart(request, env);
  if (p === '/api/admin/otp/verify' && m === 'POST') return staffOtpVerify(request, env);

  const tok = await verifyToken(bearer(request), env.TOKEN_SECRET);
  if (!tok || !tok.code) return bad('Please sign in again.', 401);
  const me = await env.DB.prepare('SELECT * FROM salespeople WHERE code=? AND active=1').bind(tok.code).first();
  if (!me || !LOGIN_ROLES.includes(me.role || 'sales')) return bad('Please sign in again.', 401);
  me.role = me.role || 'sales';
  const isSuper = me.role === 'super_admin';

  if (p === '/api/admin/me' && m === 'GET') return json({ user: publicUser(me), siteUrl: env.SITE_URL || '' });
  if (p === '/api/admin/leads' && m === 'GET') return listLeads(env, me, url);
  const lm = p.match(/^\/api\/admin\/leads\/(\d+)$/);
  const lpm = p.match(/^\/api\/admin\/leads\/(\d+)\/partner$/);
  if (lpm && m === 'POST') return leadToPartner(request, env, me, Number(lpm[1]));
  if (lm && m === 'GET') return leadDetail(env, me, Number(lm[1]));
  if (lm && m === 'PATCH') return updateLead(request, env, me, Number(lm[1]));
  if (lm && m === 'DELETE') return isSuper ? deleteLead(env, me, Number(lm[1])) : bad('Only super admins can delete clients.', 403);
  if (p === '/api/admin/followups' && m === 'GET') return listFollowups(env, me, url);
  if (p === '/api/admin/followups' && m === 'POST') return addFollowup(request, env, me);
  const fm = p.match(/^\/api\/admin\/followups\/(\d+)$/);
  if (fm && m === 'PATCH') return updateFollowup(request, env, me, Number(fm[1]));
  if (p === '/api/admin/users' && m === 'GET') return listUsers(env, me, url);
  if (p === '/api/admin/users' && m === 'POST') return saveUser(request, env, me);
  if (p === '/api/admin/users/bulk' && m === 'POST') return bulkPartners(request, env, me);
  const um = p.match(/^\/api\/admin\/users\/([A-Z0-9]+)$/);
  if (um && m === 'GET') return userDetail(env, me, um[1]);
  if (um && m === 'DELETE') return isSuper ? deleteUser(env, me, um[1]) : bad('Only super admins can delete users.', 403);
  if (p === '/api/admin/integrations' && m === 'GET') return isSuper ? listKeys(env) : bad('Only super admins can manage integrations.', 403);
  if (p === '/api/admin/integrations/keys' && m === 'POST') return isSuper ? createKey(request, env, me) : bad('Only super admins can manage integrations.', 403);
  const km = p.match(/^\/api\/admin\/integrations\/keys\/(\d+)$/);
  if (km && m === 'DELETE') return isSuper ? revokeKey(env, Number(km[1])) : bad('Only super admins can manage integrations.', 403);
  if (p === '/api/admin/knowledge' && m === 'GET') return isSuper ? json({ knowledge }) : bad('Only super admins can see this.', 403);
  if (p === '/api/admin/requests' && m === 'GET') return listRequests(env);
  const rm = p.match(/^\/api\/admin\/requests\/(\d+)$/);
  if (rm && m === 'PATCH') return markRequest(env, me, Number(rm[1]));
  if (p === '/api/admin/activity' && m === 'GET') return isSuper ? listActivity(env, url) : bad('Only super admins can see team activity.', 403);
  if (p === '/api/admin/export.csv' && m === 'GET') return exportCsv(env, me);
  return bad('Not found', 404);
}

const publicUser = (u) => ({ code: u.code, name: u.name, phone: u.phone, role: u.role || 'sales', company: u.company, active: !!u.active, share_id: u.share_id, created_by: u.created_by, created_at: u.created_at, last_login: u.last_login });

async function log(env, me, action, targetType, targetId, detail) {
  await env.DB.prepare('INSERT INTO staff_activity (user_code, action, target_type, target_id, detail, ts) VALUES (?,?,?,?,?,?)')
    .bind(me.code, action, targetType || null, targetId != null ? String(targetId) : null, detail ? clean(detail, 300) : null, now()).run();
}

// ---------- Login: phone + WhatsApp OTP ----------

async function staffOtpStart(request, env) {
  const b = await readJson(request);
  const phone = normalisePhone(b.phone);
  if (!phone) return bad('Please enter a valid 10-digit mobile number.');
  let user = await env.DB.prepare('SELECT * FROM salespeople WHERE phone=? AND active=1').bind(phone).first();
  // Owner numbers (SUPER_ADMIN_PHONES in wrangler.toml, or the SUPER_ADMIN_PHONE secret) are always super admins
  const owners = [env.SUPER_ADMIN_PHONE, env.SUPER_ADMIN_PHONES].filter(Boolean).join(',').split(',').map(normalisePhone).filter(Boolean);
  if (owners.includes(phone)) {
    // An owner number is always a super admin, even if it was added earlier with another role
    const existing = await env.DB.prepare('SELECT * FROM salespeople WHERE phone=?').bind(phone).first();
    if (existing && (existing.role !== 'super_admin' || !existing.active)) {
      await env.DB.prepare("UPDATE salespeople SET role='super_admin', active=1 WHERE code=?").bind(existing.code).run();
    }
    if (existing) user = await env.DB.prepare('SELECT * FROM salespeople WHERE code=?').bind(existing.code).first();
  }
  if (!user && owners.includes(phone)) {
    const code = `SA${phone.slice(-4)}${Math.floor(Math.random() * 90 + 10)}`;
    await env.DB.prepare("INSERT INTO salespeople (code, name, phone, role, active, share_id, created_by, created_at) VALUES (?,?,?,'super_admin',1,?,?,?)")
      .bind(code, 'Owner', phone, newShareId(), 'system', now()).run();
    user = await env.DB.prepare('SELECT * FROM salespeople WHERE code=?').bind(code).first();
  }
  if (!user || !LOGIN_ROLES.includes(user.role || 'sales')) return bad("This number isn't registered for the dashboard. Ask your admin to add you.", 403);

  const t = now();
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const recent = await env.DB.prepare("SELECT COUNT(*) n FROM otps WHERE phone=? AND purpose='staff' AND created_at>?").bind(phone, t - 900).first();
  if (recent.n >= 4) return bad('Too many codes requested. Please try again in 15 minutes.', 429);
  const code = sixDigitCode();
  await env.DB.prepare("INSERT INTO otps (phone, code_hash, expires_at, created_at, ip, pending, purpose) VALUES (?,?,?,?,?,?,'staff')")
    .bind(phone, await sha256(`staff:${phone}:${code}:${env.TOKEN_SECRET}`), t + OTP_TTL, t, ip, JSON.stringify({ code: user.code })).run();
  const sent = await sendOtp(env, phone, code);
  return json({ ok: true, name: user.name, ...(sent.devCode ? { devCode: sent.devCode } : {}) });
}

async function staffOtpVerify(request, env) {
  const b = await readJson(request);
  const phone = normalisePhone(b.phone);
  const code = String(b.code || '').replace(/\D/g, '');
  if (!phone || code.length !== 6) return bad('Please enter the 6-digit code.');
  const t = now();
  const row = await env.DB.prepare("SELECT rowid, * FROM otps WHERE phone=? AND purpose='staff' ORDER BY created_at DESC LIMIT 1").bind(phone).first();
  if (!row || row.expires_at < t) return bad('This code has expired. Please request a new one.');
  if (row.attempts >= 5) return bad('Too many wrong attempts. Please request a new code.', 429);
  if ((await sha256(`staff:${phone}:${code}:${env.TOKEN_SECRET}`)) !== row.code_hash) {
    await env.DB.prepare('UPDATE otps SET attempts=attempts+1 WHERE rowid=?').bind(row.rowid).run();
    return bad('That code is not right. Please check and try again.');
  }
  await env.DB.prepare('UPDATE otps SET expires_at=0 WHERE rowid=?').bind(row.rowid).run();
  const user = await env.DB.prepare('SELECT * FROM salespeople WHERE phone=? AND active=1').bind(phone).first();
  if (!user || !LOGIN_ROLES.includes(user.role || 'sales')) return bad('This number no longer has dashboard access.', 403);
  await env.DB.prepare('UPDATE salespeople SET last_login=? WHERE code=?').bind(t, user.code).run();
  await log(env, user, 'login');
  const token = await signToken({ code: user.code }, env.TOKEN_SECRET, STAFF_TTL);
  return json({ token, user: publicUser({ ...user, role: user.role || 'sales' }) });
}

// ---------- Lead assignment ----------
// A client brought by a salesperson is assigned to them; by a channel partner, to the salesperson who added that partner.
export async function assignLead(env, leadId) {
  const lead = await env.DB.prepare('SELECT id, first_ref, assigned_to FROM leads WHERE id=?').bind(leadId).first();
  if (!lead || lead.assigned_to || !lead.first_ref) return;
  const u = await env.DB.prepare('SELECT code, role, created_by FROM salespeople WHERE code=?').bind(lead.first_ref).first();
  if (!u) return;
  const to = (u.role || 'sales') === 'channel_partner' ? (u.created_by && u.created_by !== 'system' ? u.created_by : null) : u.code;
  if (to) await env.DB.prepare('UPDATE leads SET assigned_to=? WHERE id=?').bind(to, leadId).run();
}

// ---------- Clients ----------

// A lead is "internal" (team member, channel partner or test entry) when marked so,
// or automatically when its number belongs to a dashboard user — unless someone moved it back to clients.
const INTERNAL = "(COALESCE(l.internal,0)=1 OR (COALESCE(l.internal,0)=0 AND l.phone IN (SELECT phone FROM salespeople WHERE COALESCE(phone,'')!='')))";

function leadFilter(me, url) {
  const scope = url.searchParams.get('scope') || 'all';
  const c = [], args = [];
  if (scope === 'internal') c.push(INTERNAL); else c.push(`NOT ${INTERNAL}`);
  if (scope === 'mine') { c.push('(l.assigned_to = ? OR l.first_ref = ?)'); args.push(me.code, me.code); }
  if (scope === 'unassigned') c.push('l.assigned_to IS NULL');
  if (scope === 'partners') c.push("l.first_ref IN (SELECT code FROM salespeople WHERE role='channel_partner')");
  if (scope.startsWith('user:')) { c.push('(l.first_ref = ? OR l.assigned_to = ?)'); args.push(scope.slice(5), scope.slice(5)); }
  return { where: `WHERE ${c.join(' AND ')}`, args };
}

async function listLeads(env, me, url) {
  const { where, args } = leadFilter(me, url);
  const t = now();
  const leads = (await env.DB.prepare(
    `SELECT l.*, rb.name AS referred_by_name, src.name AS source_user_name, src.role AS source_user_role, src.company AS source_user_company,
       asg.name AS assigned_name,
       (SELECT COUNT(*) FROM leads x WHERE x.referred_by = l.id) AS referrals,
       (SELECT COUNT(DISTINCT o.device) FROM link_opens o WHERE o.by_lead = l.id) AS link_opens,
       (SELECT MIN(f.due_at) FROM followups f WHERE f.lead_id = l.id AND f.status = 'open') AS next_followup
     FROM leads l
     LEFT JOIN leads rb ON rb.id = l.referred_by
     LEFT JOIN salespeople src ON src.code = l.first_ref
     LEFT JOIN salespeople asg ON asg.code = l.assigned_to
     ${where} ORDER BY l.last_seen DESC LIMIT 2000`
  ).bind(...args).all()).results;
  if (!leads.length) return json({ leads: [] });
  const inScope = `lead_id IN (SELECT l.id FROM leads l ${where})`;
  const agg = await groupBy(env, `SELECT lead_id, type, target, COUNT(*) n, SUM(value) v FROM events WHERE ${inScope} GROUP BY lead_id, type, target`, args);
  const chats = await groupBy(env, `SELECT lead_id, COUNT(*) n FROM chats WHERE role='user' AND ${inScope} GROUP BY lead_id`, args);
  const reqs = await groupBy(env, `SELECT lead_id, kind, handled FROM requests WHERE ${inScope}`, args);
  const out = leads.map((l) => {
    const s = scoreLead(l, agg[l.id] || [], (chats[l.id] || [{ n: 0 }])[0].n, reqs[l.id] || []);
    const open = (reqs[l.id] || []).filter((r) => !r.handled).map((r) => r.kind);
    return { ...l, score: s.score, priority: s.priority, openRequests: open, questions: (chats[l.id] || [{ n: 0 }])[0].n, overdue: !!(l.next_followup && l.next_followup < t) };
  });
  out.sort((a, b) => b.score - a.score || b.last_seen - a.last_seen);
  return json({ leads: out });
}

async function groupBy(env, sql, args) {
  const res = (await env.DB.prepare(sql).bind(...args).all()).results;
  const map = {};
  for (const r of res) (map[r.lead_id] ||= []).push(r);
  return map;
}

async function leadDetail(env, me, id) {
  const lead = await env.DB.prepare(`SELECT l.*, ${INTERNAL} AS is_internal, (SELECT name FROM salespeople WHERE phone = l.phone LIMIT 1) AS staff_match FROM leads l WHERE l.id=?`).bind(id).first();
  if (!lead) return bad('Client not found', 404);
  const agg = (await env.DB.prepare('SELECT type, target, COUNT(*) n, SUM(value) v FROM events WHERE lead_id=? GROUP BY type, target').bind(id).all()).results;
  const timeline = (await env.DB.prepare("SELECT type, target, value, ts FROM events WHERE lead_id=? AND type!='dwell' ORDER BY ts DESC LIMIT 200").bind(id).all()).results;
  const chats = (await env.DB.prepare('SELECT role, content, ts FROM chats WHERE lead_id=? ORDER BY ts, id').bind(id).all()).results;
  const requests = (await env.DB.prepare('SELECT * FROM requests WHERE lead_id=? ORDER BY created_at DESC').bind(id).all()).results;
  const referrer = lead.referred_by ? await env.DB.prepare('SELECT id, name FROM leads WHERE id=?').bind(lead.referred_by).first() : null;
  const referees = (await env.DB.prepare('SELECT id, name, status, created_at FROM leads WHERE referred_by=? ORDER BY created_at').bind(id).all()).results;
  const opens = (await env.DB.prepare(
    `SELECT o.ts, o.device, o.verified_lead, v.name AS verified_name FROM link_opens o LEFT JOIN leads v ON v.id = o.verified_lead
     WHERE o.by_lead=? ORDER BY o.ts DESC LIMIT 200`).bind(id).all()).results;
  const source = lead.first_ref ? await env.DB.prepare('SELECT code, name, role, company FROM salespeople WHERE code=?').bind(lead.first_ref).first() : null;
  const assigned = lead.assigned_to ? await env.DB.prepare('SELECT code, name FROM salespeople WHERE code=?').bind(lead.assigned_to).first() : null;
  const followups = (await env.DB.prepare(
    `SELECT f.*, a.name AS assigned_name, c.name AS created_name FROM followups f
     LEFT JOIN salespeople a ON a.code = f.assigned_to LEFT JOIN salespeople c ON c.code = f.created_by
     WHERE f.lead_id=? ORDER BY CASE f.status WHEN 'open' THEN 0 ELSE 1 END, f.due_at`).bind(id).all()).results;
  const staffLog = (await env.DB.prepare(
    `SELECT s.action, s.detail, s.ts, u.name AS user_name FROM staff_activity s LEFT JOIN salespeople u ON u.code = s.user_code
     WHERE s.target_type='lead' AND s.target_id=? ORDER BY s.ts DESC LIMIT 100`).bind(String(id)).all()).results;

  lead.referrals = referees.length;
  lead.link_opens = new Set(opens.map((o) => o.device)).size;
  const network = {
    referrer: referrer ? { id: referrer.id, name: referrer.name, open: true } : null,
    referees: referees.map((r) => ({ ...r, open: true })),
    opens: lead.link_opens,
    unverifiedOpens: new Set(opens.filter((o) => !o.verified_lead).map((o) => o.device)).size,
  };
  const journey = [
    ...timeline,
    ...(referrer ? [{ type: 'arrived_via', target: referrer.name, ts: lead.created_at }] : []),
    ...opens.map((o) => ({ type: o.verified_lead ? 'share_open_verified' : 'share_open', target: o.verified_name || '', ts: o.ts })),
    ...referees.map((r) => ({ type: 'referral_verified', target: r.name, ts: r.created_at })),
    ...staffLog.map((x) => ({ type: 'staff', target: `${x.user_name || 'Team'}: ${x.detail || x.action}`, ts: x.ts })),
  ].sort((a, b) => b.ts - a.ts).slice(0, 300);
  const s = scoreLead(lead, agg, chats.filter((c) => c.role === 'user').length, requests);
  return json({ lead, ...s, timeline: journey, network, chats, requests, followups, source, assigned, openingLine: openingLine(lead, s, chats, requests) });
}

function openingLine(lead, s, chats, requests) {
  const first = lead.name.split(' ')[0];
  const topSection = Object.entries(s.dwell).sort((a, b) => b[1] - a[1])[0]?.[0];
  const PLACE = { gift: 'GIFT City', airport: 'the airport', infocity: 'Infocity', mahatma: 'Mahatma Mandir', railway: 'the railway station', vaishnodevi: 'SG Highway', metro: 'the metro' };
  const checked = [...new Set(s.places || [])].map((id) => PLACE[id]).filter(Boolean);
  const lastQ = [...chats].reverse().find((c) => c.role === 'user')?.content;
  if (lead.referrals > 0) return `Hi ${first}, this is from The Palm Unity — thank you for sharing Unity with your family and friends! Would you like to plan a site visit together with them?`;
  if (requests.some((r) => r.kind === 'site_visit')) return `Hi ${first}, this is from The Palm Unity — calling to confirm your site visit. Which day suits you best?`;
  if (lastQ) return `Hi ${first}, this is from The Palm Unity. I saw you asked "${lastQ.slice(0, 80)}" — happy to take you through that properly.`;
  if (checked.length) return `Hi ${first}, this is from The Palm Unity. I noticed you checked the commute to ${checked.slice(0, 2).join(' and ')} — Unity is well placed for that. Would a quick site visit this week help?`;
  if (topSection === 'floorplans') return `Hi ${first}, this is from The Palm Unity. You were looking at our floor plans — shall I share the layouts that are still available on your preferred floor?`;
  if (topSection === 'payment') return `Hi ${first}, this is from The Palm Unity. You were checking the payment plan — I can share the full cost sheet for the home you liked.`;
  if (topSection === 'location') return `Hi ${first}, this is from The Palm Unity. You were exploring the location — would a quick site visit this week help?`;
  return `Hi ${first}, this is from The Palm Unity. Thanks for checking out the project — what kind of home are you looking for?`;
}

async function updateLead(request, env, me, id) {
  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(id).first();
  if (!lead) return bad('Client not found', 404);
  const b = await readJson(request);
  const status = STATUSES.includes(b.status) ? b.status : lead.status;
  const notes = b.notes !== undefined ? clean(b.notes, 4000) : lead.notes;
  let assigned = lead.assigned_to;
  if (b.assigned_to !== undefined) {
    if (!b.assigned_to) assigned = null;
    else {
      const u = await env.DB.prepare("SELECT code FROM salespeople WHERE code=? AND active=1 AND COALESCE(role,'sales') IN ('sales','super_admin')").bind(clean(b.assigned_to, 16)).first();
      if (!u) return bad('Pick an active team member.');
      assigned = u.code;
    }
  }
  let internal = lead.internal;
  if (b.internal !== undefined) internal = b.internal ? 1 : -1;
  await env.DB.prepare('UPDATE leads SET status=?, notes=?, assigned_to=?, internal=? WHERE id=?').bind(status, notes, assigned, internal, id).run();
  if (b.internal !== undefined && internal !== lead.internal) await log(env, me, internal === 1 ? 'mark_internal' : 'mark_client', 'lead', id, internal === 1 ? 'Marked as team / test entry' : 'Moved back to clients');
  if (status !== lead.status) await log(env, me, 'status', 'lead', id, `Status → ${status.replace('_', ' ')}`);
  if (notes !== lead.notes) await log(env, me, 'notes', 'lead', id, 'Updated notes');
  if (assigned !== lead.assigned_to) await log(env, me, 'assign', 'lead', id, `Assigned to ${assigned || 'nobody'}`);
  return json({ ok: true });
}

// ---------- Follow-ups ----------

async function listFollowups(env, me, url) {
  const who = url.searchParams.get('who') || (me.role === 'super_admin' ? 'all' : 'mine');
  const status = url.searchParams.get('status') || 'open';
  const conds = [], args = [];
  if (status !== 'all') { conds.push('f.status = ?'); args.push(status); }
  if (who === 'mine') { conds.push('f.assigned_to = ?'); args.push(me.code); }
  else if (who !== 'all') { conds.push('f.assigned_to = ?'); args.push(clean(who, 16)); }
  const rows = (await env.DB.prepare(
    `SELECT f.*, l.name AS lead_name, l.phone AS lead_phone, l.status AS lead_status, p.name AS partner_name, p.phone AS partner_phone,
       a.name AS assigned_name, c.name AS created_name
     FROM followups f LEFT JOIN leads l ON l.id = f.lead_id LEFT JOIN salespeople p ON p.code = f.partner_code
     LEFT JOIN salespeople a ON a.code = f.assigned_to LEFT JOIN salespeople c ON c.code = f.created_by
     ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''} ORDER BY ${status === 'done' ? 'f.done_at DESC' : 'f.due_at ASC'} LIMIT 500`
  ).bind(...args).all()).results;
  return json({ followups: rows, now: now() });
}

async function addFollowup(request, env, me) {
  const b = await readJson(request);
  const leadId = b.lead_id ? Number(b.lead_id) : null;
  const partner = b.partner_code ? clean(b.partner_code, 16) : null;
  if (!leadId && !partner) return bad('Pick a client or channel partner.');
  if (leadId && !(await env.DB.prepare('SELECT id FROM leads WHERE id=?').bind(leadId).first())) return bad('Client not found', 404);
  if (partner && !(await env.DB.prepare("SELECT code FROM salespeople WHERE code=? AND role='channel_partner'").bind(partner).first())) return bad('Channel partner not found', 404);
  const due = Number(b.due_at);
  if (!due || due < 1e9) return bad('Pick a date and time for the follow-up.');
  const kind = FU_KINDS.includes(b.kind) ? b.kind : 'call';
  let assignee = me.code;
  if (b.assigned_to && b.assigned_to !== me.code) {
    const u = await env.DB.prepare("SELECT code FROM salespeople WHERE code=? AND active=1 AND COALESCE(role,'sales') IN ('sales','super_admin')").bind(clean(b.assigned_to, 16)).first();
    if (!u) return bad('Pick an active team member.');
    assignee = u.code;
  }
  const r = await env.DB.prepare('INSERT INTO followups (lead_id, partner_code, assigned_to, created_by, kind, due_at, note, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(leadId, partner, assignee, me.code, kind, due, clean(b.note, 1000) || null, 'open', now()).run();
  const when = new Date(due * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  await log(env, me, 'followup_add', leadId ? 'lead' : 'partner', leadId || partner, `Planned ${kind.replace('_', ' ')} for ${when}${b.note ? ` — ${clean(b.note, 120)}` : ''}`);
  return json({ ok: true, id: r.meta.last_row_id });
}

async function updateFollowup(request, env, me, id) {
  const f = await env.DB.prepare('SELECT * FROM followups WHERE id=?').bind(id).first();
  if (!f) return bad('Follow-up not found', 404);
  if (me.role !== 'super_admin' && f.assigned_to !== me.code && f.created_by !== me.code) return bad('This follow-up belongs to someone else.', 403);
  const b = await readJson(request);
  const t = now();
  if (b.status === 'done' || b.status === 'cancelled') {
    await env.DB.prepare('UPDATE followups SET status=?, outcome=?, done_at=?, done_by=? WHERE id=?').bind(b.status, clean(b.outcome, 1000) || null, t, me.code, id).run();
    await log(env, me, b.status === 'done' ? 'followup_done' : 'followup_cancel', f.lead_id ? 'lead' : 'partner', f.lead_id || f.partner_code,
      `${b.status === 'done' ? 'Completed' : 'Cancelled'} ${f.kind.replace('_', ' ')}${b.outcome ? ` — ${clean(b.outcome, 160)}` : ''}`);
    // Optionally schedule the next one in the same step
    if (b.next_due_at && Number(b.next_due_at) > 1e9) {
      await env.DB.prepare('INSERT INTO followups (lead_id, partner_code, assigned_to, created_by, kind, due_at, note, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(f.lead_id, f.partner_code, f.assigned_to, me.code, FU_KINDS.includes(b.next_kind) ? b.next_kind : f.kind, Number(b.next_due_at), clean(b.next_note, 1000) || null, 'open', t).run();
      await log(env, me, 'followup_add', f.lead_id ? 'lead' : 'partner', f.lead_id || f.partner_code, 'Planned the next follow-up');
    }
  } else if (b.due_at) {
    await env.DB.prepare('UPDATE followups SET due_at=? WHERE id=?').bind(Number(b.due_at), id).run();
    await log(env, me, 'followup_reschedule', f.lead_id ? 'lead' : 'partner', f.lead_id || f.partner_code, 'Rescheduled a follow-up');
  }
  return json({ ok: true });
}

// ---------- Users: team & channel partners ----------

async function listUsers(env, me, url) {
  const role = url.searchParams.get('role');
  const rows = (await env.DB.prepare(
    `SELECT u.*, cb.name AS created_by_name,
       (SELECT COUNT(*) FROM leads l WHERE l.first_ref = u.code) AS clients,
       (SELECT COUNT(DISTINCT o.device) FROM link_opens o WHERE o.sales_code = u.code AND o.by_lead IS NULL) AS link_opens,
       (SELECT COUNT(*) FROM followups f WHERE f.assigned_to = u.code AND f.status = 'open') AS open_followups,
       (SELECT MAX(ts) FROM staff_activity s WHERE s.user_code = u.code) AS last_activity
     FROM salespeople u LEFT JOIN salespeople cb ON cb.code = u.created_by ORDER BY u.active DESC, u.name`
  ).all()).results.map((u) => ({ ...u, role: u.role || 'sales' }));
  let visible = rows;
  if (me.role !== 'super_admin') visible = rows.filter((u) => u.role === 'channel_partner' || u.code === me.code || u.role === 'sales');
  if (role) visible = visible.filter((u) => u.role === role);
  // Sales see teammates' names (for assigning), but not their phone numbers
  if (me.role !== 'super_admin') visible = visible.map((u) => (u.role === 'channel_partner' || u.code === me.code ? u : { ...u, phone: null }));
  return json({ users: visible.map((u) => ({ ...publicUser(u), created_by_name: u.created_by_name, clients: u.clients, link_opens: u.link_opens, open_followups: u.open_followups, last_activity: u.last_activity })), siteUrl: env.SITE_URL || '' });
}

async function saveUser(request, env, me) {
  const b = await readJson(request);
  const isSuper = me.role === 'super_admin';
  const role = ROLES.includes(b.role) ? b.role : 'channel_partner';
  if (!isSuper && role !== 'channel_partner') return bad('Sales team can add channel partners only.', 403);
  const name = clean(b.name, 80);
  const phone = normalisePhone(b.phone);
  if (!name) return bad('Name is required.');
  if (!phone) return bad('Enter a valid 10-digit mobile number.');
  const company = clean(b.company, 120) || null;
  const active = b.active === false ? 0 : 1;
  const clash = await env.DB.prepare('SELECT code FROM salespeople WHERE phone=? AND code != ?').bind(phone, b.code || '').first();
  if (clash) return bad('Another user already has this mobile number.');

  if (b.code) {
    const u = await env.DB.prepare('SELECT * FROM salespeople WHERE code=?').bind(clean(b.code, 16)).first();
    if (!u) return bad('User not found', 404);
    if (!isSuper && (u.role || 'sales') !== 'channel_partner') return bad('Sales team can edit channel partners only.', 403);
    if (u.code === me.code && (role !== 'super_admin' || !active)) return bad("You can't remove your own super admin access.");
    await env.DB.prepare('UPDATE salespeople SET name=?, phone=?, role=?, company=?, active=? WHERE code=?').bind(name, phone, role, company, active, u.code).run();
    const changes = [];
    if ((u.role || 'sales') !== role) changes.push(`role ${u.role || 'sales'} → ${role}`);
    if (!!u.active !== !!active) changes.push(active ? 'reactivated' : 'deactivated');
    await log(env, me, 'user_edit', 'user', u.code, `Edited ${name}${changes.length ? ` (${changes.join(', ')})` : ''}`);
    return json({ ok: true, code: u.code });
  }
  const prefix = role === 'channel_partner' ? 'CP' : role === 'super_admin' ? 'SA' : 'S';
  let code;
  for (let i = 0; i < 5; i++) {
    code = prefix + newShareId().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (!(await env.DB.prepare('SELECT 1 FROM salespeople WHERE code=?').bind(code).first())) break;
  }
  await env.DB.prepare('INSERT INTO salespeople (code, name, phone, role, company, active, share_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(code, name, phone, role, company, active, newShareId(), me.code, now()).run();
  await log(env, me, 'user_add', 'user', code, `Added ${role.replace('_', ' ')} ${name}${company ? ` (${company})` : ''}`);
  return json({ ok: true, code });
}

async function userDetail(env, me, code) {
  const u = await env.DB.prepare('SELECT u.*, cb.name AS created_by_name FROM salespeople u LEFT JOIN salespeople cb ON cb.code = u.created_by WHERE u.code=?').bind(code).first();
  if (!u) return bad('User not found', 404);
  u.role = u.role || 'sales';
  if (me.role !== 'super_admin' && u.role !== 'channel_partner' && u.code !== me.code) return bad('Only super admins can see team members’ activity.', 403);
  const clients = (await env.DB.prepare('SELECT id, name, phone, status, created_at, last_seen, sessions FROM leads WHERE first_ref=? ORDER BY created_at DESC LIMIT 500').bind(code).all()).results;
  u.client_record = u.phone ? await env.DB.prepare('SELECT id, name, created_at FROM leads WHERE phone=?').bind(u.phone).first() : null;
  const assigned = u.role === 'channel_partner' ? [] : (await env.DB.prepare('SELECT id, name, status, last_seen FROM leads WHERE assigned_to=? ORDER BY last_seen DESC LIMIT 500').bind(code).all()).results;
  const opens = (await env.DB.prepare("SELECT COUNT(DISTINCT device) n, COUNT(DISTINCT CASE WHEN verified_lead IS NULL THEN device END) u FROM link_opens WHERE sales_code=? AND by_lead IS NULL").bind(code).first());
  const followups = (await env.DB.prepare(
    `SELECT f.*, l.name AS lead_name, a.name AS assigned_name FROM followups f LEFT JOIN leads l ON l.id = f.lead_id LEFT JOIN salespeople a ON a.code = f.assigned_to
     WHERE f.partner_code=? OR f.assigned_to=? ORDER BY CASE f.status WHEN 'open' THEN 0 ELSE 1 END, f.due_at DESC LIMIT 200`).bind(code, code).all()).results;
  const activity = (await env.DB.prepare(
    `SELECT s.*, x.name AS user_name FROM staff_activity s LEFT JOIN salespeople x ON x.code = s.user_code
     WHERE s.user_code=? OR (s.target_type IN ('partner','user') AND s.target_id=?) ORDER BY s.ts DESC LIMIT 200`).bind(code, code).all()).results;
  return json({ user: { ...publicUser(u), created_by_name: u.created_by_name, client_record: u.client_record }, clients, assigned, opens: opens.n, unverifiedOpens: opens.u, followups, activity, siteUrl: env.SITE_URL || '' });
}

// ---------- Requests, activity, export ----------

async function listRequests(env) {
  const rows = (await env.DB.prepare(
    `SELECT r.*, l.name, l.phone, l.first_ref, a.name AS assigned_name FROM requests r JOIN leads l ON l.id=r.lead_id LEFT JOIN salespeople a ON a.code = l.assigned_to
     ORDER BY r.handled, r.created_at DESC LIMIT 500`).all()).results;
  return json({ requests: rows });
}

async function markRequest(env, me, id) {
  const r = await env.DB.prepare('SELECT * FROM requests WHERE id=?').bind(id).first();
  if (!r) return bad('Not found', 404);
  await env.DB.prepare('UPDATE requests SET handled=1 WHERE id=?').bind(id).run();
  await log(env, me, 'request_done', 'lead', r.lead_id, `Handled ${r.kind === 'site_visit' ? 'site visit' : 'callback'} request`);
  return json({ ok: true });
}

async function listActivity(env, url) {
  const who = url.searchParams.get('user');
  const rows = (await env.DB.prepare(
    `SELECT s.*, u.name AS user_name, u.role AS user_role, l.name AS lead_name, p.name AS partner_name
     FROM staff_activity s LEFT JOIN salespeople u ON u.code = s.user_code
     LEFT JOIN leads l ON s.target_type='lead' AND l.id = CAST(s.target_id AS INTEGER)
     LEFT JOIN salespeople p ON s.target_type IN ('partner','user') AND p.code = s.target_id
     ${who ? 'WHERE s.user_code = ?' : ''} ORDER BY s.ts DESC LIMIT 500`).bind(...(who ? [who] : [])).all()).results;
  return json({ activity: rows });
}

async function exportCsv(env, me) {
  const { leads } = await (await listLeads(env, me, new URL('https://x/api/admin/leads'))).json();
  const cols = ['id', 'name', 'phone', 'profession', 'source_user_name', 'source_user_role', 'assigned_name', 'referred_by_name', 'referrals', 'link_opens', 'source', 'status', 'score', 'priority', 'sessions', 'questions', 'next_followup', 'created_at', 'last_seen', 'notes'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const iso = (t) => (t ? new Date(t * 1000).toISOString() : '');
  const lines = [cols.join(',')].concat(leads.map((l) => cols.map((c) => esc(['created_at', 'last_seen', 'next_followup'].includes(c) ? iso(l[c]) : l[c])).join(',')));
  await log(env, me, 'export', null, null, 'Exported clients CSV');
  return new Response(lines.join('\n'), { headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="unity-clients.csv"' } });
}

// Super admin only: remove a client and everything recorded about them
async function deleteLead(env, me, id) {
  const lead = await env.DB.prepare('SELECT id, name, phone FROM leads WHERE id=?').bind(id).first();
  if (!lead) return bad('Client not found.', 404);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM events WHERE lead_id=?').bind(id),
    env.DB.prepare('DELETE FROM chats WHERE lead_id=?').bind(id),
    env.DB.prepare('DELETE FROM requests WHERE lead_id=?').bind(id),
    env.DB.prepare('DELETE FROM followups WHERE lead_id=?').bind(id),
    env.DB.prepare('DELETE FROM link_opens WHERE by_lead=?').bind(id),
    env.DB.prepare('UPDATE link_opens SET verified_lead=NULL WHERE verified_lead=?').bind(id),
    env.DB.prepare('UPDATE leads SET referred_by=NULL WHERE referred_by=?').bind(id),
    env.DB.prepare("DELETE FROM otps WHERE phone=? AND COALESCE(purpose,'buyer')='buyer'").bind(lead.phone),
    env.DB.prepare('DELETE FROM leads WHERE id=?').bind(id),
  ]);
  await log(env, me, 'lead_delete', 'lead', id, `deleted client ${lead.name} (+91 ${lead.phone})`);
  return json({ ok: true });
}

// Super admin only: remove a team member or channel partner. Their clients stay; open follow-ups move to the super admin.
async function deleteUser(env, me, code) {
  const u = await env.DB.prepare('SELECT * FROM salespeople WHERE code=?').bind(code).first();
  if (!u) return bad('User not found.', 404);
  if (u.code === me.code) return bad("You can't delete your own account.");
  const owners = [env.SUPER_ADMIN_PHONE, env.SUPER_ADMIN_PHONES].filter(Boolean).join(',').split(',').map(normalisePhone).filter(Boolean);
  if (owners.includes(u.phone)) return bad('This is an owner number and always stays a super admin.');
  if (u.role === 'super_admin') {
    const n = await env.DB.prepare("SELECT COUNT(*) n FROM salespeople WHERE role='super_admin' AND active=1 AND code != ?").bind(code).first();
    if (!n.n) return bad('At least one super admin must remain.');
  }
  await env.DB.batch([
    env.DB.prepare('UPDATE leads SET assigned_to=NULL WHERE assigned_to=?').bind(code),
    env.DB.prepare("UPDATE followups SET assigned_to=? WHERE assigned_to=? AND status='open'").bind(me.code, code),
    env.DB.prepare('DELETE FROM followups WHERE partner_code=?').bind(code),
    env.DB.prepare('UPDATE salespeople SET created_by=? WHERE created_by=?').bind(me.code, code),
    env.DB.prepare("DELETE FROM otps WHERE phone=? AND purpose='staff'").bind(u.phone || ''),
    env.DB.prepare('DELETE FROM salespeople WHERE code=?').bind(code),
  ]);
  await log(env, me, 'user_delete', 'user', code, `deleted ${u.role === 'channel_partner' ? 'channel partner' : u.role === 'sales' ? 'sales user' : 'super admin'} ${u.name}${u.phone ? ` (+91 ${u.phone})` : ''}`);
  return json({ ok: true });
}

// Turn a client into a channel partner: they get a CP account (tracked share link) and leave the client list.
async function leadToPartner(request, env, me, id) {
  const lead = await env.DB.prepare('SELECT id, name, phone FROM leads WHERE id=?').bind(id).first();
  if (!lead) return bad('Client not found', 404);
  const b = await readJson(request);
  const existing = await env.DB.prepare('SELECT code, name, role FROM salespeople WHERE phone=?').bind(lead.phone).first();
  if (existing) return bad(`This number already belongs to ${existing.name} (${(existing.role || 'sales').replace('_', ' ')}).`);
  const company = clean(b.company, 120) || null;
  let code;
  for (let i = 0; i < 5; i++) {
    code = 'CP' + newShareId().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (!(await env.DB.prepare('SELECT 1 FROM salespeople WHERE code=?').bind(code).first())) break;
  }
  await env.DB.prepare("INSERT INTO salespeople (code, name, phone, role, company, active, share_id, created_by, created_at) VALUES (?,?,?,'channel_partner',?,1,?,?,?)")
    .bind(code, lead.name, lead.phone, company, newShareId(), me.code, now()).run();
  await env.DB.prepare('UPDATE leads SET internal=0 WHERE id=?').bind(id).run();
  await log(env, me, 'user_add', 'user', code, `Marked client ${lead.name} as channel partner${company ? ` (${company})` : ''}`);
  return json({ ok: true, code });
}

// Add many channel partners at once (from a pasted list or spreadsheet). Existing numbers are returned, not duplicated.
async function bulkPartners(request, env, me) {
  const b = await readJson(request);
  const rows = Array.isArray(b.partners) ? b.partners.slice(0, 300) : [];
  if (!rows.length) return bad('No partners in the list.');
  const site = env.SITE_URL || '';
  const out = [];
  let added = 0;
  for (const r of rows) {
    const name = clean(r.name, 80), phone = normalisePhone(r.phone), company = clean(r.company, 120) || null;
    if (!name || !phone) { out.push({ name: name || String(r.name || ''), phone: String(r.phone || ''), status: 'skipped', reason: !name ? 'Name missing' : 'Invalid mobile number' }); continue; }
    const ex = await env.DB.prepare('SELECT code, name, role, share_id, company FROM salespeople WHERE phone=?').bind(phone).first();
    if (ex) { out.push({ name: ex.name, phone, company: ex.company, code: ex.code, status: 'existing', role: ex.role || 'sales', link: ex.share_id ? `${site}?r=${ex.share_id}` : '' }); continue; }
    let code;
    for (let i = 0; i < 5; i++) {
      code = 'CP' + newShareId().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
      if (!(await env.DB.prepare('SELECT 1 FROM salespeople WHERE code=?').bind(code).first())) break;
    }
    const share = newShareId();
    await env.DB.prepare("INSERT INTO salespeople (code, name, phone, role, company, active, share_id, created_by, created_at) VALUES (?,?,?,'channel_partner',?,1,?,?,?)")
      .bind(code, name, phone, company, share, me.code, now()).run();
    added++;
    out.push({ name, phone, company, code, status: 'added', role: 'channel_partner', link: `${site}?r=${share}` });
  }
  if (added) await log(env, me, 'user_add', null, null, `Imported ${added} channel partner${added === 1 ? '' : 's'}`);
  return json({ ok: true, added, results: out });
}
