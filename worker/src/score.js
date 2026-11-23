// Buyer-intent score (0–100) and priority (P0 hottest … P4 coldest).
// Input `agg` is aggregated events: [{ type, target, n, v }] where n = count, v = summed value (seconds for dwell).
// Tune the weights here; the dashboard shows the breakdown so sales can see why a lead is hot.

const DWELL_WEIGHTS = {
  floorplans: 0.2,      // points per second spent in the section (2.5 min on plans ≈ 30 pts, the cap)
  payment: 0.25,
  specifications: 0.15,
  location: 0.1,
  amenities: 0.08,
  gallery: 0.05,
  highlights: 0.03,
};

export function scoreLead(lead, agg, chatCount, requests) {
  const parts = [];
  const add = (label, pts) => { if (pts > 0) parts.push({ label, pts: Math.round(pts) }); };
  const rows = (type, target) => agg.filter((e) => e.type === type && (!target || e.target === target));
  const count = (type, target) => rows(type, target).reduce((s, r) => s + r.n, 0);

  const dwell = {};
  for (const r of rows('dwell')) dwell[r.target] = Math.round((dwell[r.target] || 0) + (r.v || 0));
  let dwellPts = 0;
  for (const [sec, secs] of Object.entries(dwell)) dwellPts += (DWELL_WEIGHTS[sec] ?? 0.05) * secs;
  add('Time on floor plans, payment plan & specs', Math.min(dwellPts, 30));

  const plansOpened = rows('floorplan_open').length;
  add('Floor plans opened', Math.min(plansOpened * 5 + Math.max(count('floorplan_open') - plansOpened, 0) * 2, 15));
  add('Brochure opened', Math.min(count('brochure_open') * 8, 12));
  add('Walkthrough played', Math.min(count('walkthrough_play') * 4, 6));
  add('Checked commute & nearby places on the map', Math.min(rows('map').length * 2, 8));
  add('Questions asked to AI', Math.min(chatCount * 3, 12));
  add('Return visits', Math.min(((lead.sessions || 1) - 1) * 6, 18));
  add('Tapped Call / WhatsApp', Math.min((count('cta', 'call') + count('cta', 'whatsapp')) * 6, 12));
  // Sharing Unity with family/friends is one of the strongest buying signals
  add('Shared the link', Math.min(count('cta', 'share') * 4, 8));
  add('Family/friends opened their link', Math.min((lead.link_opens || 0) * 3, 9));
  add('Family/friends verified via their link', Math.min((lead.referrals || 0) * 8, 16));
  if (requests.some((r) => r.kind === 'site_visit')) add('Requested a site visit', 25);
  if (requests.some((r) => r.kind === 'callback')) add('Requested a callback', 15);

  let score = parts.reduce((s, p) => s + p.pts, 0);

  const daysIdle = (Date.now() / 1000 - lead.last_seen) / 86400;
  if (daysIdle > 14) {
    const cut = Math.min(Math.round(daysIdle - 14), 20);
    parts.push({ label: `Inactive ${Math.round(daysIdle)} days`, pts: -cut });
    score -= cut;
  }

  score = Math.max(0, Math.min(100, score));
  const priority = score >= 70 ? 'P0' : score >= 50 ? 'P1' : score >= 30 ? 'P2' : score >= 12 ? 'P3' : 'P4';
  const places = rows('map').filter((r) => (r.target || '').startsWith('place:')).map((r) => r.target.slice(6));
  return { score, priority, parts, dwell, places };
}
