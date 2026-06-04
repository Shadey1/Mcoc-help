# Deploying to Cloudflare Pages

Static site at `apps/web/out/` plus Pages Functions at `functions/`. Setup
is one-time at the Cloudflare dashboard; every push to `main` deploys
automatically after that.

## Prerequisites

- Domain `mcoc.help` registered at Cloudflare (done)
- Code pushed to a GitHub repo
- A Cloudflare account (free tier covers everything)

## One-time setup

### 1. Create the KV namespace for shared rosters

Before connecting Pages, create the KV namespace that the share feature
needs.

- Cloudflare dashboard → Workers & Pages → KV
- Create namespace, name it `ROSTERS_PROD`
- Note the namespace ID for the binding step below

### 2. Connect Cloudflare Pages to the GitHub repo

- Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git
- Select the GitHub repo
- Set the build configuration:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Build command | `pnpm install --frozen-lockfile && pnpm -F @prestige-tools/engine build && pnpm -F web build` |
| Build output directory | `apps/web/out` |
| Root directory | (leave blank — repo root) |
| Environment variables | `NODE_VERSION=20`, `PNPM_VERSION=9` |

### 3. Bind the KV namespace

After the first deploy succeeds:

- Pages project → Settings → Functions → KV namespace bindings → Add binding
- Variable name: `ROSTERS`
- KV namespace: select `ROSTERS_PROD`
- Save and redeploy

The functions need the binding to work. Without it, share creation will 500.

The same `ROSTERS` namespace also stores user-submitted BHR calibration
reports (key prefix `calib:`) and rate-limit counters (`rl:`). No
additional namespace needed.

### 3b. Set the admin token (for calibration reports)

To review user-submitted calibration reports at `/admin/calibrations`:

- Pages project → Settings → Environment variables → Add variable (Production)
- Variable name: `ADMIN_TOKEN`
- Value: a long random string — generate one with
  `node -e "console.log(crypto.randomBytes(24).toString('base64url'))"`
- Save and redeploy

Without this env var, `GET /api/calibration-report` returns 503 and the
admin page shows "not configured". POST submissions still work (users
can still send reports); only the read-back is gated.

Paste the token into the admin page on first visit; it's stored in
localStorage so you don't need to re-enter it every session.

### 4. Bind the custom domain

- Pages project → Custom domains → Set up a custom domain
- Enter `mcoc.help`
- Cloudflare handles the DNS and SSL automatically (domain is already in
  your Cloudflare account)

### 5. Enable Web Analytics (optional, recommended)

- Cloudflare dashboard → Analytics & Logs → Web Analytics → Add a site
- Choose `mcoc.help`
- Copy the snippet for later integration (Phase 2 polish; the dashboard
  works without it for basic traffic data)

## Per-deploy

Every `git push origin main` triggers a build. The Cloudflare dashboard shows
build logs, build duration, and a preview URL for each commit. Build budget
on free tier is 500 builds/month, 100k Functions requests/day, 100k KV
reads/day, 1k KV writes/day, unlimited bandwidth. We won't hit any of these
at soft-launch scale.

## Local development with Functions

The Next.js dev server (`pnpm dev`) does NOT run Pages Functions. To test
the share feature locally:

```bash
pnpm -F @prestige-tools/engine build
pnpm -F web build
npx wrangler pages dev apps/web/out --kv ROSTERS
```

Wrangler's `--kv` flag creates an in-memory KV namespace for local testing.
The functions will hit it just like production.

To test without functions (the rest of the app works fine without them):

```bash
pnpm dev
```

Just the share modal and `/r/?id=` page will fail when trying to call
`/api/share`. Everything else (roster picker, recommendations, champion
grid) works unaffected.

## Local pre-flight before pushing

```bash
pnpm install
pnpm -F @prestige-tools/engine build
pnpm test
pnpm -F web build   # confirms the static export builds cleanly
```

If `pnpm -F web build` succeeds locally it'll succeed on Cloudflare.
Catches most issues that would otherwise cause a failed deploy: typically
unhandled `window` / `localStorage` references in server components, or
dynamic route params missing from `generateStaticParams`.
