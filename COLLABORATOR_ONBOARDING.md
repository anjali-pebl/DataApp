# DataApp — Collaborator Onboarding & Handoff

This document gives you everything you need to run, edit, and deploy the **PEBL DataApp**
(Next.js + Supabase + Vercel). Work through it top to bottom.

> ℹ️ **Secrets are redacted below.** The real key values are intentionally replaced with
> placeholders so this file is safe to keep in the repo. Get the actual values from Anjali
> (or from the Supabase/Vercel dashboards) when filling in your local `.env.local`.

---

## 1. Access you need to be granted

Ask Anjali (anjali@pebl-cic.co.uk) to invite you to all three. You cannot do anything
useful until these land in your inbox:

| Service   | What to request                                             | Where it's used                    |
|-----------|-------------------------------------------------------------|------------------------------------|
| GitHub    | Collaborator (write) on the repo `anjali-pebl/DataApp`      | Source code, PRs                   |
| Supabase  | Member on the `DataApp` project (org invite)                | DB, auth, storage, migrations      |
| Vercel    | **Anjali's Vercel login (shared credentials)** — see §8      | Production deploys, env vars, logs |
| Secrets   | The `SUPABASE_SERVICE_ROLE_KEY` value (sent securely)       | Local `.env.local` (see §5)        |

**Repo URL:** https://github.com/anjali-pebl/DataApp
(Note: `package.json` still references an older `christian-pebl/DataApp` origin — ignore it;
the live remote is `anjali-pebl/DataApp`.)

**Production URL:** https://data-app-gamma.vercel.app
**Supabase project ref:** `tujjhrliibqgstbrohfn`
**Supabase URL:** https://tujjhrliibqgstbrohfn.supabase.co

---

## 2. ⚠️ Critical: which folder is the real app

When you clone the repo, the **root of the repo IS the application**. Everything you edit
lives under `src/` at the root.

There is a subfolder named `DataApp/` inside the repo. **Do not use it.** It is a stale,
untracked fork with older code and different config (different map tiles, different map-style
toggle). A dev server accidentally started from `DataApp/` will silently serve obsolete code
and ignore your edits to the real `src/`.

- ✅ Canonical app: repo root — `src/`, root `package.json`, root `next.config.ts`
- ❌ Ignore: the nested `DataApp/` directory

Always run `npm run dev` from the **repo root**.

---

## 3. Prerequisites

- **Node.js 18+** (the maintainer runs v24; anything ≥18 works)
- **npm** (ships with Node)
- **Git**
- **Supabase CLI** (optional, only if you want to run migrations from the terminal):
  `npm install -g supabase`
- A code editor (VS Code recommended)

---

## 4. First-time local setup

```bash
# 1. Clone (root of clone = the app)
git clone https://github.com/anjali-pebl/DataApp.git
cd DataApp        # this is the repo root — the real app lives here

# 2. Install dependencies
npm install

# 3. Create your env file (see §5 for contents)
#    On Windows PowerShell:  New-Item .env.local
#    Then paste in the variables.

# 4. Start the dev server (runs on port 9002, NOT 3000)
npm run dev

# 5. Open the app
#    http://localhost:9002
```

You'll be redirected to `/auth` to log in. Sign up with an email or use an existing test
account (ask Anjali for test credentials).

---

## 5. Environment variables (`.env.local`)

Create a file named `.env.local` in the **repo root** with the following. The placeholder
values (`<...>`) must be filled in with the real keys — get them from Anjali or from the
Supabase dashboard (**Project Settings → API**). The Supabase URL, anon key, and
`NEXT_PUBLIC_*` map keys are client-safe (they ship to the browser anyway); the
**service-role key is a full-admin secret** and must never be committed.

```env
# --- Supabase ---
NEXT_PUBLIC_SUPABASE_URL=https://tujjhrliibqgstbrohfn.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<supabase-anon-key>

# SECRET — get the real value from Anjali; do NOT commit this line filled in
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>

# --- Map tiles ---
NEXT_PUBLIC_MAPTILER_API_KEY=<maptiler-api-key>
NEXT_PUBLIC_ESRI_API_KEY=<esri-api-key>

# --- Ocean-ML integration (OPTIONAL — only for the video/ML features) ---
OCEAN_ML_BACKEND_URL=http://localhost:8001
NEXT_PUBLIC_OCEAN_ML_BACKEND_URL=http://localhost:8001
NEXT_PUBLIC_OCEANML_PROTOCOL=oceanml

# --- Optional: OpenAI (AI features only) ---
# OPENAI_API_KEY=your_openai_key
```

> If you'd rather not depend on Anjali for the secret, a project member can mint a fresh
> service-role key from **Supabase → Project Settings → API → Service role**. Rotating it
> there invalidates the old one, so coordinate before doing so.

`.env.local` is already in `.gitignore` — keep it that way.

---

## 6. Tech stack overview

| Layer          | Tech                                                    |
|----------------|---------------------------------------------------------|
| Framework      | Next.js 15 (App Router, Turbopack dev)                  |
| UI             | React 18, Tailwind CSS, shadcn/ui (Radix primitives)    |
| Auth           | Supabase Auth (email/password + OAuth)                  |
| Database       | Supabase Postgres with Row Level Security (RLS)         |
| Storage        | Supabase Storage (bucket: `pin-files`)                  |
| Data fetching  | @tanstack/react-query                                   |
| Maps           | Leaflet (Esri + MapTiler tiles, custom bathymetry tiles)|
| Charts         | Recharts                                                |
| CSV/Excel      | papaparse, xlsx                                         |
| Error tracking | Sentry (`@sentry/nextjs`)                               |
| ML (optional)  | Python CV scripts (`cv_scripts/`), YOLOv8, Modal.com    |

**Key source directories:**
- `src/app/` — pages & API routes (`map-drawing/`, `data-explorer/`, `api/`)
- `src/components/` — React components (`map/`, `pin-data/`, `auth/`, `ui/`)
- `src/lib/supabase/` — browser/server Supabase clients + services
- `src/lib/` — parsers, date/timezone utils, curve fitting, etc.
- `src/hooks/` — React hooks (e.g. `use-map-data.ts`)
- `supabase/migrations/` — canonical SQL migrations (39 files, ordered by timestamp)

---

## 7. Supabase (database, auth, storage)

### Dashboard
Log in at https://supabase.com → the `DataApp` project (ref `tujjhrliibqgstbrohfn`).
Core areas you'll use: **Table Editor**, **SQL Editor**, **Authentication**, **Storage**.

### Schema / migrations
All schema lives in `supabase/migrations/*.sql`, applied in filename order. Core tables:
`projects`, `pins`, `lines`, `areas`, `tags`, `pin_files`, plus sharing, saved plots,
analytics, and CV/ML tables.

To apply migrations to a fresh or updated DB:
- **Easiest:** open **SQL Editor** in the dashboard, paste the migration SQL, Run.
- **CLI:**
  ```bash
  supabase link --project-ref tujjhrliibqgstbrohfn
  supabase db push
  ```

After adding tables/columns/types, run this once so the API sees them:
```sql
NOTIFY pgrst, 'reload schema';
```

### Storage
Files (CSV/data uploads) live in the **`pin-files`** bucket (private). If it's missing on a
new project:
```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('pin-files', 'pin-files', false)
ON CONFLICT (id) DO NOTHING;
```

### RLS — important gotchas (learned the hard way)
- **Never** use `EXISTS (SELECT 1 FROM user_profiles WHERE ...)` inside an RLS policy on
  another table — it breaks the RLS evaluation chain and queries silently return `{}`.
  Instead use the `SECURITY DEFINER` helper `public.get_my_role()` and compare
  `public.get_my_role() = 'pebl'`.
- **Type casts:** `project_id` on `pins`/`lines`/`areas`/`pin_files` is `text`, but
  `projects.id` and `project_shares.project_id` are `uuid`. Cast with `::text` when joining.
- RBAC roles migration: `supabase/migrations/20260209000000_rbac_roles.sql`.

### Auth config
In **Authentication → URL Configuration**, the allowed **Site URL** / **Redirect URLs**
must include both local and production:
- `http://localhost:9002` and `http://localhost:9002/auth/callback`
- `https://data-app-gamma.vercel.app` and `https://data-app-gamma.vercel.app/auth/callback`

---

## 8. Vercel (deployment)

- The app is hosted on the Vercel project **`anjali-pebl/DataApp`**. It is under Anjali's
  personal Vercel account (no team seats), so access is via **Anjali's shared login
  credentials** — she will send you the login over a secure channel. There is no separate
  member invite. (Sharing an account login is less clean than a team invite; if this becomes
  a regular thing, consider adding a Vercel team seat instead.)
- The repo is connected to that Vercel project; pushing to the deployment branch triggers a
  build automatically. Production is https://data-app-gamma.vercel.app.
- **Environment variables** must be set in **Vercel → Project → Settings → Environment
  Variables** (they are NOT read from your local `.env.local`). Mirror the same keys from §5:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `NEXT_PUBLIC_MAPTILER_API_KEY`, `NEXT_PUBLIC_ESRI_API_KEY`, and the Ocean-ML vars if used.
- Manual deploy from CLI (optional): `vercel --prod`.
- After changing the production domain, update Supabase Auth redirect URLs (§7).

---

## 9. Day-to-day commands

```bash
npm run dev          # dev server on http://localhost:9002 (run from repo ROOT)
npm run build        # production build (also the best local check before pushing)
npm start            # serve the production build locally
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit (TypeScript check)
npm run test         # Jest unit/integration
npm run test:e2e     # Playwright end-to-end tests
```

Recommended pre-push check: `npm run typecheck && npm run build`.

---

## 10. Git workflow

- Default/main branch for PRs: **`master`**.
- Branch per change: `git checkout -b fix/short-description` (current active branch is
  `bug-fixes`).
- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Open a PR into `master`; merging to the deploy branch ships to Vercel.

---

## 11. Gotchas & conventions worth knowing

- **Port is 9002**, not 3000. Some older docs say 3000 — ignore them.
- **Dates/timezones:** the app is UTC-sensitive. `parseISO`/`new Date("YYYY-MM-DD")` create
  UTC midnight, but date-fns `format()` uses local time and shifts dates back a day in
  negative-offset timezones. Use the UTC-aware helpers in `src/lib/timezone-utils.ts`
  (`parseDateToUTC`, `formatDateUTC`, `differenceInDaysUTC`, etc.). Display file dates in the
  pin's timezone (from lat/lng), not the viewer's local timezone.
- **CSV date formats:** source CSVs use UK `DD/MM/YYYY`; DB stores `YYYY-MM-DD`; UI shows
  `dd-MM-yy`. Parsing flows through `src/components/pin-data/csvParser.ts`.
- **SQL for Supabase:** paste raw SQL only — no leading comments — so it runs clean in the
  SQL Editor.
- The repo root has many one-off `*.sql`, `apply-*.js`, and `test-*.js` helper scripts
  accumulated over time. They're historical; the **authoritative** schema is
  `supabase/migrations/`.
- `CLAUDE.md` at the root has extended project notes and active-task tracking.

---

## 12. Onboarding checklist

- [ ] Accepted GitHub, Supabase, and Vercel invites
- [ ] Received `SUPABASE_SERVICE_ROLE_KEY` securely from Anjali
- [ ] Cloned repo; confirmed you're working in the **root**, not the `DataApp/` subfolder
- [ ] `npm install` completed
- [ ] `.env.local` created in the root with all values from §5
- [ ] `npm run dev` runs; app loads at http://localhost:9002
- [ ] Logged in and can see the map / create a pin (confirms Supabase auth + DB work)
- [ ] `npm run build` succeeds locally
- [ ] Can see the Vercel project dashboard and its env vars

---

*Questions: Anjali — anjali@pebl-cic.co.uk*
