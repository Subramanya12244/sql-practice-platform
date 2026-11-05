# DataForge

**Learn. Practice. Build. Master Data.** DataForge is an interactive learning platform for SQL, Python, data engineering and data analytics.

Live site: **https://dataforge.dataforge-learn.workers.dev**

The repository keeps its original name, `sql-practice-platform`. It holds two applications that share one frontend codebase:

| | Public site | Local workspace |
|---|---|---|
| What it is | The DataForge website anyone can use | A personal tool for your own ChatGPT history, datasets and GitHub repo |
| Entry | `frontend/site.html` → `frontend/src/site/` | `frontend/index.html` → `frontend/src/main.tsx` |
| SQL engine | PostgreSQL in the browser ([PGlite](https://pglite.dev), WebAssembly) | FastAPI → your PostgreSQL |
| Python engine | Pyodide in a sandboxed browser worker | n/a |
| Accounts | Optional, Supabase (username or email + password) | Single local user |
| Hosting | Cloudflare Workers static assets, free tier | Your machine or Docker |

---

## Public site

Every page is prerendered to static HTML with JSON-LD, a sitemap and `robots.txt`. Nothing runs on a server: queries and Python run in the visitor's browser. Without an account, progress stays in `localStorage`.

### What's on it

**Learn**
- `/learn`: dashboard with daily goal, revision queue, recommendations and bookmarks.
- `/notes`: 65 SQL theory notes. `/patterns`: 22 problem-solving patterns. `/mindmaps`: 17 interactive mind maps. `/shortcuts`: quick reference and comparisons. `/flashcards`.
- `/data-engineering`: 7 tracks with 102 topics (Python, ETL/ELT, data warehousing, Spark, Airflow, dbt, cloud). Each topic has notes, an architecture diagram, exercises and interview questions. The registry is `frontend/src/site/content/tracks.json`.

**Practice**
- `/questions`: 150 graded SQL questions on Northwind (50 Easy, 60 Medium, 40 Hard). A result is correct when its rows match the reference result on the visible data and on hidden test rows added in a rolled-back transaction, so hard-coded answers fail.
- `/practice/python`: 150 Python problems (PY-001 to PY-150; 50 Easy, 60 Medium, 40 Hard), graded by visible and hidden tests in Pyodide (10 s limit, in-memory files, no network, `js` and `micropip` imports blocked). Each has input/output format, constraints, examples, hints and an explanation shown after you pass. `scripts/check_python_blocks.py` proves every solution passes and every starter fails.
- `/interview`: question sets by role. `/scenarios`: 16 business scenarios. `/challenge`: weekly challenge.
- `/playground`: six practice databases, each isolated, with schema explorer, ER diagram, history and export.

**Projects and data quality**
- `/projects-lab`: 12 projects with 69 tasks. SQL tasks run in one rolled-back transaction; Python tasks run against tests. A project is Completed when every automated check passes. A project with manual steps is Completed only after an admin approves it.
- `/data-quality`: NULL, duplicate, key, type, schema, date, outlier, reconciliation, row-count and business rules, with a score, failing records and run comparison.
- `/data-generator`: reproducible datasets with controllable NULLs, duplicates, orphans and invalid values.

**Query intelligence** (all in the browser)
- **Visualize query** and **History** tabs on every SQL question and scenario. Each step is labelled Executed (real rows from your own clauses), Parsed (from a PostgreSQL AST) or Plan (from EXPLAIN). Queries using `random()`, `now()` and similar get explanations only, never derived rows.
- `/ai-tutor` (query helper): 5-level hints, rule-based explanations and database-verified result checks. There is no AI chat and no AI API.
- `/query-visualizer`, `/solution-comparison`, `/readiness`.

**Career**
- `/career/planner`: week-by-week plan for data analyst, data engineer or analytics engineer roles. Items tick off only from evidence: a note read, a question solved, a project completed.
- `/career/companies`: how interviews tend to differ at product companies, startups, services firms, banks and retailers. General guidance; no company is named.
- `/career/answers`: more than 400 interview questions from the notes. Answer first, compare with the model answer, rate yourself; missed questions come back sooner.
- `/portfolio`: your verified record, with imported solves listed separately and reviewer approval shown on projects. Export to Markdown, print to PDF, or copy a public share link.

Site-wide search opens with ⌘K. Content is Markdown and JSON under `frontend/src/site/content/`, in the format in [docs/CONTENT_SPEC.md](docs/CONTENT_SPEC.md).

### Develop and build

```bash
# Regenerate question data after editing ../northwind-sql-practice
backend/.venv/bin/python scripts/build_public_data.py

cd frontend
npm run dev:site            # http://localhost:5174
npm run build:site          # prerender to frontend/dist-site/
npm run preview:site        # http://localhost:4174
```

`scripts/build_public_data.py` writes `frontend/public/data/`. Commit that folder so hosting builds don't need the question repo. `scripts/build_datasets.py` regenerates the playground datasets.

---

## Accounts (optional, Supabase free tier)

Without Supabase the site works anonymously. With it:
- **Sign-in options.** Visitors sign in with a username or email and a password. Google sign-in is not offered.
- **Sync.** Progress, flashcards, lessons, mock interviews, visualization history, project progress and submissions, data quality runs, study plans and answer ratings sync across devices. Signing out removes the synced copy from that browser.
- **Password reset.** `/reset-password` emails a reset link. It works only for accounts created with an email; username-only accounts need an admin.
- **Review notifications.** When an admin reviews a project submission, the learner sees a badge in the header and the decision with its comment on `/account`.
- **Public profile.** Opt in on `/account`. `/profile?u=<username>` then shows solved counts, activity, the portfolio name and reviewer-approved projects, never the email. The same profile is listed on `/leaderboard`.
- **XP, levels and achievements.** `/achievements` shows level (Beginner to DataForge Master), XP, current and longest streak, a five-week calendar, daily and weekly missions and 12 achievements. Accounts earn XP on the server (migration 006), once per action; anonymous visitors see the same rules computed in the browser. `/leaderboard` ranks public profiles by weekly, monthly or all-time XP.
- **Admin dashboard.** `/admin` shows users, activity, roles, the audit log, comment moderation, the weekly challenge and project submission review (approve, request changes, reject, with history). Click a username to see that learner's solves by topic, project checks, submissions and recent activity. Users, the audit log and submissions export to CSV.

The database enforces every rule through row-level security (RLS). The frontend only hides what a visitor can't use.

### Setup

1. Create a project at [supabase.com](https://supabase.com).
2. In the **SQL Editor**, run each migration once, in order. Each is safe to re-run and only adds objects:
   1. `supabase/migrations/001_accounts.sql`: profiles, progress, mock sessions, audit log, admin functions
   2. `supabase/migrations/002_community.sql`: shared solutions, likes, comments, weekly challenge, leaderboard
   3. `supabase/migrations/003_dataforge.sql`: visualization sessions, project progress and submissions, data quality
   4. `supabase/migrations/004_submission_review.sql`: review comments, review history, reviewer stamping
   5. `supabase/migrations/005_public_portfolio.sql`: approved projects and portfolio name on public profiles
   6. `supabase/migrations/006_gamification.sql`: XP ledger, achievements, missions and XP leaderboard
3. **Authentication → Sign In / Providers → Email:** turn on email and turn off "Confirm email". Username accounts sign in with a synthetic `@users.sqlpractice.local` address that can't receive mail.
4. **Authentication → URL Configuration:** set the Site URL to the live site, and add `https://<site>/**` and `http://localhost:4176/**` as redirect URLs.
5. Create the owner and admin accounts from your own shell. Never commit these values:
   ```bash
   cd frontend
   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<secret key> \
   SEED_USER_PASSWORD='<owner password>' SEED_ADMIN_PASSWORD='<temporary admin password>' \
   node scripts/seed-accounts.mjs
   ```
   This creates `Subramanya.a` with the owner's solved questions imported, and `admin`, which must change its password at first sign-in.
6. Give the build the project URL and publishable key, as GitHub repo variables or in `frontend/.env.local`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` (the publishable key)

   The publishable key is public by design. **Never put the secret or service-role key in a `VITE_` variable**, in frontend code, or in chat.

Roles, the two-browser test procedure and known limits are in [docs/SUPABASE.md](docs/SUPABASE.md).

---

## Deploy

### Cloudflare Workers

The site is the `dataforge` worker, served at `https://dataforge.dataforge-learn.workers.dev`. Config: `frontend/wrangler.jsonc`.

Deploy by hand:
```bash
cd frontend
VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... npm run build:site
npx wrangler deploy -c wrangler.jsonc
```

### Automatic deploys (GitHub Actions)

`.github/workflows/deploy.yml` runs on every push to `main`. It runs the frontend tests and the Python content check, prerenders the site, then deploys. Run the backend tests locally. Set these under the repo's **Settings → Secrets and variables → Actions**:

| Name | Kind | Purpose |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | From Cloudflare → My Profile → API Tokens, "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Cloudflare account ID |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Variables | Turn accounts on |
| `VITE_GSC_TOKEN` | Variable | Google Search Console HTML-tag verification code |
| `VITE_CF_BEACON` | Variable | Cloudflare Web Analytics token (cookie-free) |

Without `CLOUDFLARE_API_TOKEN` the workflow still tests and builds, and skips the deploy.

### Search engines

Add `https://dataforge.dataforge-learn.workers.dev/` as a URL-prefix property in [Google Search Console](https://search.google.com/search-console). Choose HTML-tag verification, set `VITE_GSC_TOKEN`, redeploy, verify, then submit `sitemap.xml`. Do the same in Bing Webmaster Tools.

---

## Tests

```bash
cd frontend && npx vitest run        # frontend: 144 tests
cd backend && source .venv/bin/activate && pytest -q   # backend
python3 scripts/check_python_blocks.py                 # every Python example and task
```

The frontend suite includes:
- **Content contracts.** Every link resolves, and every SQL example runs in the browser database and returns rows.
- **Grading, visualizer, planner, data quality and sync logic.**
- **`supabaseRls.test.ts`.** It applies migrations 001–005 in order on PGlite (real PostgreSQL) and checks RLS as two learners, an admin and an anonymous visitor: user isolation, checklist rows, the submission review lifecycle and the public portfolio.

With PostgreSQL installed you can also run the SQL test scripts in `supabase/tests/` with `psql`.

---

## Local workspace

The local workspace is built around your own ChatGPT SQL-learning history.

> Import ChatGPT conversations, extract questions, SQL attempts, feedback, mistakes, scores and concepts, then practice in a Monaco SQL editor and track every mistake and concept.

### Connected repositories and databases

| Resource | Connection |
|----------|------------|
| **GitHub SQL repo** | [`Subramanya12244/northwind-sql-practice`](https://github.com/Subramanya12244/northwind-sql-practice) |
| **Local clone** | `NORTHWIND_REPO_PATH` (sibling `../northwind-sql-practice`) |
| **Practice DB** | PostgreSQL `northwind` via `DATABASE_URL` (read-only role) |
| **App DB** | PostgreSQL `sql_practice` via `APP_DATABASE_URL` |
| **Project DBs** | One PostgreSQL database per uploaded dataset, named `sqlp_<slug>` |

Sync pulls existing `Q*.md` and linked `Q*.sql` files, preserves the folder structure (`01_Aggregations` … `11_Set_Operators`) and Q-numbering. **Nothing is pushed to GitHub unless you explicitly confirm.**

#### Repository questions count as solved

A question with **both** a `.md` and a `.sql` file in the repo is treated as already solved, so you never re-solve documented work. Sync writes an `attempts` row with `solved_source = 'github_import'`, and the dashboard keeps the two apart:

| Counter | Meaning |
|---------|---------|
| `solved` | Everything solved, from the repo or the editor |
| `solved_from_repo` | Imported because the repo documents it |
| `solved_in_practice` | You submitted a correct query in the editor |

Questions you add yourself start **unsolved** and stay that way until a correct submission. Re-running sync never downgrades or overwrites practice history.

```bash
# Pull questions from your local clone / GitHub
curl -X POST http://localhost:8000/api/github/sync

# Preview docs for a question (no push)
curl http://localhost:8000/api/github/docs/86/preview

# Write docs locally only
curl -X POST http://localhost:8000/api/github/docs/confirm \
  -H 'Content-Type: application/json' \
  -d '{"question_number": 86, "push_to_github": false}'

# Push requires push_to_github: true AND GITHUB_TOKEN set
```

### Architecture

| Layer | Responsibility |
|-------|----------------|
| **Frontend** | React + Vite + Monaco Editor + TanStack Query |
| **Backend** | FastAPI: question API, safe query execution, submission grading, ChatGPT import, dataset upload |
| **Practice DB** | PostgreSQL `northwind`: Northwind tables, **read-only** role |
| **App DB** | PostgreSQL `sql_practice`: questions, attempts, solutions, progress, imports, mistakes, concepts |
| **Project DBs** | PostgreSQL `sqlp_<slug>`: one per uploaded dataset |
| **Questions** | Synced from `northwind-sql-practice` `.md`/`.sql` (fallback: `questions/questions.json`) |

```text
Browser ──► FastAPI ──► sql_practice (metadata + import data)
                │
                ├──► northwind  via sql_readonly (SELECT only)
                └──► sqlp_*     via sql_readonly (SELECT only)
```

Provisioning needs `POSTGRES_ADMIN_URL` to point at a role with `CREATEDB`; query execution never uses it.

#### Query execution security

1. **AST validation** with `sqlglot`: only `SELECT`, `WITH` and set operations are allowed.
2. **Keyword fallback** rejects `INSERT/UPDATE/DELETE/DROP/...`.
3. **Single statement only.** Multi-statement payloads are rejected.
4. **PostgreSQL read-only role**, plus `BEGIN READ ONLY` and `statement_timeout`.
5. Errors are sanitized, so credentials and hosts never leak.

Submit runs your SQL and the hidden `reference_query`, then compares result sets. Ordering is enforced only when `sort_required` is true.

### ChatGPT import

To export from ChatGPT:
1. Open ChatGPT → **Settings** → **Data Controls**.
2. Click **Export data** and confirm.
3. Wait for the download email (usually minutes).
4. Extract the ZIP. You need **`conversations.json`**.
5. Upload it at `/import/chatgpt`.

The import scans every conversation and ranks it by SQL relevance. You pick the conversation with your SQL practice and preview what was detected: questions, attempts, scores, feedback, mistakes and concepts, and which questions already exist (skip, update or import). After you confirm, review the results in `/questions`, `/mistakes` and `/concepts`.

| Item | Source |
|------|--------|
| Questions (number, title, business problem, requirements, tables) | Assistant messages |
| My SQL attempts (exact SQL preserved) | User messages containing SQL |
| Approach notes ("we can use multiple CTEs…") | User messages before SQL |
| ChatGPT feedback (correct / incorrect / hint / concept / mistake) | Assistant messages |
| Mistakes (category + description + correction) | Assistant messages |
| Scores (9/10, 9.8/10, ⭐⭐⭐) | Assistant messages |
| Concepts (CTE, UNION, conditional aggregation, …) | Assistant messages |

**Nothing is invented.** If difficulty, topic or score is not stated, it is stored as `null`. Suggested values are labelled `Suggested`.

```bash
cd backend
source .venv/bin/activate
python -m app.parsers.chatgpt_import \
  --file /path/to/conversations.json \
  --start-question 59
```

### SQL projects (dataset upload)

Upload your own data and the workspace builds a dedicated PostgreSQL database for it, then makes those tables available in the SQL editor.

Supported files: `.csv`, `.tsv`, `.txt`, `.xlsx`, `.xls`, `.json`, `.sql`. Upload several at once and they become related tables.

On upload:
1. Each file (or Excel sheet, or JSON key) becomes a table, with headers sanitized into safe identifiers.
2. Column types are inferred: integer, bigint, numeric, boolean, timestamp, varchar, text.
3. A primary key is chosen from columns that are unique and non-null, preferring `*_id` names.
4. Foreign keys are proposed where a column name matches another table's primary key **and** every value exists in it.
5. `CREATE DATABASE sqlp_<slug>` runs, tables are created, rows copied in, and constraints added last.
6. Row counts are compared against the source files, and mismatches are reported as warnings.
7. `schema.sql` and `er_diagram.mmd` are written to `projects/<slug>/`, beside the original files.
8. The read-only role is granted `SELECT`, so the editor can query the data but not modify it.

If any step fails, the database is dropped and the project row removed, so a failed upload never leaves a half-built project.

```text
projects/
└── sales_analytics/
    ├── data/          # your original uploads
    ├── schema.sql     # generated DDL
    ├── er_diagram.mmd # mermaid ER diagram
    └── questions/
```

Pick the active project from the header dropdown. It controls which database **Run**, **Schema** and **Test solution** use; *Northwind* keeps the original behaviour. Manage projects at `/projects`. Questions are not auto-generated: paste your own question and solution via **Add**, and use *Test solution* before saving.

### Quick start (Docker)

```bash
cd sql-practice-platform
cp .env.example .env
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000 (docs at http://localhost:8000/docs)
- Postgres: localhost:5432

Default Docker credentials:

| Role | User | Password | Database |
|------|------|----------|----------|
| Read-only queries | `sql_readonly` | `readonly_pass` | `northwind` |
| App metadata | `sql_app` | `app_pass` | `sql_practice` |
| Admin | `postgres` | `postgres` | — |

### Local development

1. **PostgreSQL.** Run `docker compose up postgres -d`, or point `.env` at your existing Northwind database (see below).
2. **Backend.**
   ```bash
   cd backend
   python -m venv .venv
   source .venv/bin/activate   # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   cp ../.env.example ../.env  # edit as needed
   uvicorn app.main:app --reload --port 8000
   ```
   On startup the API creates app tables, seeds the local user, and loads `questions/questions.json` if the question table is empty.
3. **Frontend.** `cd frontend && npm install && npm run dev`, then open http://localhost:5173. Vite proxies `/api` to the backend.

### Environment variables

Copy `.env.example` to `.env`. Never commit `.env`.

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Practice DB (asyncpg). Use the **read-only** user. |
| `APP_DATABASE_URL` | App metadata DB. |
| `DATABASE_ADMIN_URL` | Optional admin URL for setup scripts. |
| `APP_DATABASE_ADMIN_URL` | Optional admin URL for the app DB. |
| `GITHUB_REPOSITORY` | `owner/repo` for question sync (optional). |
| `GITHUB_TOKEN` | GitHub PAT, **backend only**, never in frontend code. |
| `GITHUB_BRANCH` | Branch to read (default `main`). |
| `GITHUB_QUESTIONS_PATH` | Path to JSON in the repo (default `questions/questions.json`). |
| `QUERY_TIMEOUT_SECONDS` | Statement timeout (default `5`). |
| `QUERY_MAX_ROWS` | Max rows returned to the UI (default `1000`). |
| `CORS_ORIGINS` | Comma-separated allowed origins. |
| `BACKEND_PORT` / `FRONTEND_PORT` | Documented ports. |
| `DEFAULT_USER_ID` / `DEFAULT_USER_NAME` | The single local user. |
| `QUESTIONS_FILE_PATH` | Path to the local `questions.json`. |
| `POSTGRES_ADMIN_URL` | Server-level connection used **only** to `CREATE DATABASE` for new projects. Needs `CREATEDB`. |
| `PROJECT_DB_HOST` / `PROJECT_DB_PORT` | Host and port for per-project URLs. |
| `PROJECT_DB_OWNER` / `PROJECT_DB_OWNER_PASSWORD` | Role that owns project databases and runs the import. |
| `PROJECT_DB_READONLY_USER` / `PROJECT_DB_READONLY_PASSWORD` | Role granted `SELECT` on every project database. |
| `PROJECT_DB_PREFIX` | Prefix for provisioned databases (default `sqlp_`). |
| `PROJECTS_ROOT` | Where uploaded files and generated `schema.sql` are stored. |
| `MAX_UPLOAD_MB` | Total upload size limit (default `200`). |

The public site's build variables (`VITE_*`) are listed under [Deploy](#automatic-deploys-github-actions).

### Connect to your existing PostgreSQL / Northwind

1. Make sure the Northwind tables exist: `customers`, `employees`, `suppliers`, `products`, `categories`, `orders`, `order_details`, `shippers`.
2. Create a **read-only** role:
   ```sql
   CREATE ROLE sql_readonly LOGIN PASSWORD 'your_password';
   GRANT CONNECT ON DATABASE your_db TO sql_readonly;
   GRANT USAGE ON SCHEMA public TO sql_readonly;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO sql_readonly;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO sql_readonly;
   ```
3. Create a separate app database. Don't mix metadata with the Northwind tables:
   ```sql
   CREATE DATABASE sql_practice;
   CREATE ROLE sql_app LOGIN PASSWORD 'your_app_password';
   GRANT ALL PRIVILEGES ON DATABASE sql_practice TO sql_app;
   -- connect to sql_practice:
   GRANT ALL ON SCHEMA public TO sql_app;
   GRANT CREATE ON SCHEMA public TO sql_app;
   ```
4. Set in `.env`:
   ```env
   DATABASE_URL=postgresql+asyncpg://sql_readonly:your_password@localhost:5432/your_db
   APP_DATABASE_URL=postgresql+asyncpg://sql_app:your_app_password@localhost:5432/sql_practice
   ```
5. Skip the Docker `postgres` service and run the backend and frontend locally. Apply `database/schema.sql` and `database/seed.sql` if you need a fresh practice dataset.

### API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/questions` | List questions (`difficulty`, `topic`, `status`, `search`) |
| `POST` | `/api/questions` | Create a question manually (starts unsolved) |
| `GET` | `/api/questions/{id}` | Question detail (**no** `reference_query`) |
| `POST` | `/api/query/execute` | Run read-only SQL (`project_id` selects the database) |
| `POST` | `/api/questions/{id}/submit` | Grade by result comparison |
| `GET` | `/api/questions/{id}/attempts` | Attempt history |
| `GET` | `/api/progress` | Dashboard stats |
| `GET` | `/api/topics` | Topic list |
| `GET` | `/api/schema` | Table schemas (`?tables=a,b`, `?project_id=`) |
| `POST` | `/api/github/sync` | Sync questions, marking documented ones solved |
| `GET` | `/api/projects` | List SQL projects |
| `POST` | `/api/projects` | Upload datasets and provision a project database |
| `GET` | `/api/projects/{id}` | Project detail with inferred tables and ER diagram |
| `DELETE` | `/api/projects/{id}` | Delete a project and drop its database |
| `POST` | `/api/projects/validate-solution` | Run a pasted solution and return its rows |

### Questions and GitHub

- The canonical file is [`questions/questions.json`](./questions/questions.json). Rebuild it from your `northwind-sql-practice` Markdown and SQL pairs with `python questions/build_questions.py`.
- Sync with the **Sync** button or `POST /api/github/sync`. Set `GITHUB_REPOSITORY` and `GITHUB_TOKEN` on the **backend** only.
- To add a question, use the **Add** page (it assigns the next Q number and lets you *Test solution* before saving), or append to `questions.json` and sync. Never put reference SQL in frontend code.

After **3 consecutive correct** submissions the suggested level goes up (`Beginner → Intermediate → Advanced → Senior → Expert`); after **5 consecutive incorrect** it goes down one step. Questions are never skipped automatically.

The upload pipeline has a smoke test that provisions a throwaway database, queries it through the read-only role, checks writes are blocked, then drops it: `cd backend && python scripts/smoke_project_upload.py`.

`⌘/Ctrl + Enter` runs the query. The editor also has Format, Reset, Clear and Copy.

---

## Project structure

```text
sql-practice-platform/
├── frontend/          # React + TypeScript + Vite (public site in src/site/, local app in src/)
├── backend/           # FastAPI application (local workspace)
├── supabase/          # migrations 001–005 and SQL tests for accounts
├── docs/              # content spec, Supabase guide, intelligence and learning plans
├── scripts/           # data and dataset builders, Python content checks
├── questions/         # questions.json and its build script
├── database/          # Northwind schema, seed and init
├── .github/workflows/ # CI and deploy
└── docker-compose.yml
```

Existing practice materials live in the sibling `northwind-sql-practice` folder.
