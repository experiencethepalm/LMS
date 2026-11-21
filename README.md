# The Palm Unity — private project page & lead tracker

An in-house version of a "verify-to-view" project page (like Veya), owned by The Palm Group.
The agency-managed thepalm.in is not touched.

```
Buyer opens link (?ref=SALESPERSON)
   → enters name + WhatsApp number → 6-digit OTP
   → page unlocks: floor plans, payment plan, specs, location, brochure, AI assistant, Book visit
   → every section viewed, plan opened, question asked is logged against that buyer
Sales team opens /admin
   → leads ranked by intent score (P0 hot … P4 cold), "why this score", suggested opening line,
     chat transcript, visit/callback requests, status & notes, CSV export
```

| Part | Where it runs | Folder |
|---|---|---|
| Project page + admin dashboard (static HTML/JS) | GitHub Pages (free) | `site/` |
| API: OTP, leads, tracking, scoring, AI, admin | Cloudflare Worker (free tier is enough to start) | `worker/` |
| Database | Cloudflare D1 | `worker/schema.sql` |
| AI assistant | Claude API, answers only from `worker/content/knowledge.md` | `worker/src/chat.js` |

---

## 1. One-time setup (≈ 30 minutes)

You need: a GitHub account, a Cloudflare account, Node.js 18+ on your computer.

### a) Deploy the API to Cloudflare
```bash
cd worker
npm install
npx wrangler login                       # opens browser, sign in to Cloudflare
npx wrangler d1 create palm-leads        # copy the database_id it prints into wrangler.toml
npm run db:remote                        # creates the tables
npx wrangler secret put TOKEN_SECRET     # paste a long random string (e.g. from passwordsgenerator.net, 40+ chars)
npx wrangler secret put ADMIN_PASSWORD   # owner dashboard password
npx wrangler secret put ANTHROPIC_API_KEY  # from console.anthropic.com (for the AI assistant)
npm run deploy                           # prints your API URL, e.g. https://palm-unity-api.<you>.workers.dev
```

### b) Publish the page on GitHub Pages
1. Create a repository (e.g. `palm-unity`) and push this folder.
2. In `site/config.js` set `API_BASE` to the Worker URL from step (a), and fill in the sales phone/WhatsApp.
3. Repo → Settings → Pages → Source: **GitHub Actions**. The included workflow (`.github/workflows/pages.yml`) publishes the `site/` folder on every push.
4. Your page: `https://<github-username>.github.io/palm-unity/` · Dashboard: `…/palm-unity/admin/`
5. Back in `worker/wrangler.toml`, set `SITE_URL` and `ALLOWED_ORIGINS` to that GitHub Pages address, then `npm run deploy` again.

Optional custom domain such as `unity.thepalm.in`: add it under GitHub Pages settings and ask whoever manages thepalm.in DNS to add one CNAME record. Nothing else on the main site changes.

### c) Add the sales team
Open `/admin/` → **Owner** tab → sign in with `ADMIN_PASSWORD` → **Team & share links** → add each salesperson with a code (e.g. `RAHUL`) and a PIN.
Each person gets a link like `…/palm-unity/?ref=RAHUL`. Salespeople sign in with code + PIN and see only their own leads; the owner sees everything.

---

## 2. Turning on real WhatsApp OTP

Until this is done, keep `OTP_PROVIDER = "dev"`: the code is shown on screen (for testing only — **do not share the link publicly in dev mode**).

**Option A — WhatsApp (recommended, matches the Veya experience)**
1. Meta Business Manager → verify the business → WhatsApp Manager → add a phone number for The Palm Group (a number not already on the WhatsApp app).
2. Create a message template: category **Authentication**, name `unity_otp`, language English, with the "Copy code" button. Approval usually takes minutes to a day.
3. Create a System User with a permanent access token (`whatsapp_business_messaging` permission).
4. Set the secrets and switch the provider:
   ```bash
   npx wrangler secret put WA_ACCESS_TOKEN
   npx wrangler secret put WA_PHONE_NUMBER_ID
   # in wrangler.toml: OTP_PROVIDER = "whatsapp"
   npm run deploy
   ```
Cost: Meta charges per authentication message (a few paise each in India — check Meta's current rate card).

**Option B — SMS via MSG91**: needs a DLT-registered OTP template. Set `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, and `OTP_PROVIDER = "msg91"`.

Built-in abuse limits: 3 codes per number per 15 min, 10 per network per hour, 5 wrong attempts per code, code expires in 10 min.

---

## 3. Everyday editing

| To change… | Edit | Then |
|---|---|---|
| Floor plans, highlights, amenities, specs, payment plan, landmarks, brochure link, RERA, possession | `worker/content/unity.json` | `npm run deploy` (in `worker/`) |
| What the AI assistant knows | `worker/content/knowledge.md` | `npm run deploy` |
| AI rules (no prices, no Skyvillas, language…) | `worker/src/chat.js` | `npm run deploy` |
| Photos / plan images / hero | `site/assets/img/` (file names referenced in `unity.json`) | push to GitHub |
| Phone, WhatsApp, colours, layout | `site/config.js`, `site/styles.css`, `site/index.html` | push to GitHub |
| Score weights | `worker/src/score.js` | `npm run deploy` |

Anything marked **TBC** in `unity.json` shows as "To be announced" on the page — fill these before launch:
RERA number, possession date, payment plan milestones, specifications, landmark distances, walkthrough YouTube ID, brochure PDF, photos and floor-plan images.

Note: gated text (plans data, payment plan, specs) is only sent after verification. Image files in `site/assets/` are public URLs if someone guesses the path — put sensitive files (e.g. the brochure PDF) in a private Cloudflare R2 bucket or an unlisted link if that matters.

---

## 4. Lead scoring (how P0–P4 is decided)

Points (capped per item), total 0–100:
- Time on floor plans / payment plan / specs / location (up to 30)
- Distinct floor plans opened (up to 15) · brochure opened (up to 12) · walkthrough played (up to 6)
- Questions asked to the AI (up to 12) · return visits (up to 18) · tapped Call/WhatsApp (up to 12)
- Site visit requested (+25) · callback requested (+15)
- Minus up to 20 when inactive for more than 14 days

P0 ≥ 70 · P1 ≥ 50 · P2 ≥ 30 · P3 ≥ 12 · P4 below. The dashboard shows the breakdown for every lead.

Optional alerts: set `ALERT_WEBHOOK_URL` (Google Chat space webhook, Slack, or Discord) to get a message whenever someone requests a site visit or callback.

---

## 5. Local testing
```bash
cd worker
printf 'TOKEN_SECRET=dev-secret\nADMIN_PASSWORD=owner123\n' > .dev.vars
npm run db:local
npm run dev                      # API on http://localhost:8787
# in another terminal, from the repo root:
npx serve site -l 8080           # page on http://localhost:8080, admin on /admin/
```

## 6. Running costs (at launch scale)
- GitHub Pages, Cloudflare Workers & D1: free tiers cover thousands of visitors/month.
- WhatsApp OTP: per-message Meta fee.
- AI assistant: per-question Claude API usage (small; capped at 40 questions per buyer per day).
