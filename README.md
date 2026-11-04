# DataForge

**Learn. Practice. Build. Master Data.** An integrated learning and development platform for SQL, Python, Data Engineering, Data Analytics and real-world data projects.

_The repository keeps its original name (`sql-practice-platform`) and the deployment URL is unchanged; the product is now called DataForge._

A production-quality **SQL interview practice** application built around your actual ChatGPT SQL-learning history.

> Import your ChatGPT conversations → extract questions, SQL attempts, feedback, mistakes, scores, concepts → practice new questions in a Monaco SQL editor → track every mistake and concept.

## Connected repositories & databases

| Resource | Connection |
|----------|------------|
| **GitHub SQL repo** | [`Subramanya12244/northwind-sql-practice`](https://github.com/Subramanya12244/northwind-sql-practice) |
| **Local clone** | `NORTHWIND_REPO_PATH` (sibling `../northwind-sql-practice`) |
| **Practice DB** | PostgreSQL `northwind` via `DATABASE_URL` (read-only role) |
| **App DB** | PostgreSQL `sql_practice` via `APP_DATABASE_URL` |
| **Project DBs** | One PostgreSQL database per uploaded dataset, named `sqlp_<slug>` |

Sync pulls existing `Q*.md` + linked `Q*.sql` files, preserves folder structure (`01_Aggregations` … `11_Set_Operators`) and Q-numbering. **Nothing is pushed to GitHub unless you explicitly confirm.**

### Repository questions count as solved

A question with **both** a `.md` and a `.sql` file in the repo is treated as already
solved — you never have to re-solve documented work. Sync writes an `attempts` row with
`solved_source = 'github_import'`, so the dashboard can still separate the two:

| Counter | Meaning |
|---------|---------|
| `solved` | Everything solved, from the repo or the editor |
| `solved_from_repo` | Imported because the repo documents it |
| `solved_in_practice` | You submitted a correct query in the editor |

Questions you add yourself start **unsolved** and stay that way until a correct
submission. Re-running sync never downgrades or overwrites practice history.

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

## Architecture

| Layer | Responsibility |
|-------|----------------|
| **Frontend** | React + Vite + Monaco Editor + TanStack Query |
| **Backend** | FastAPI — question API, safe query execution, submission grading, ChatGPT import |
| **Practice DB** | PostgreSQL `northwind` — Northwind tables, **read-only** role |
| **App DB** | PostgreSQL `sql_practice` — questions, attempts, solutions, progress, imports, mistakes, concepts |
| **Questions** | Synced from `northwind-sql-practice` `.md`/`.sql` (fallback: `questions/questions.json`) |

```text
Browser ──► FastAPI ──► sql_practice (metadata + import data)
                │
                └──► northwind via sql_readonly (SELECT only)
```

## ChatGPT Import

### How to export from ChatGPT

1. Open ChatGPT → **Settings** → **Data Controls**
2. Click **Export data** → confirm
3. Wait for the download email (usually minutes)
4. Extract the ZIP — you need **`conversations.json`**
5. Upload it at `/import/chatgpt`

### Import workflow

```text
Upload conversations.json
        ↓
Scan — all conversations ranked by SQL relevance score
        ↓
Select the SQL Practice conversation
        ↓
Preview:
  - Questions detected (Q59 → Q90)
  - Attempts per question
  - Scores, feedback, mistakes, concepts
  - Existing questions shown (skip / update / import)
        ↓
Confirm import
        ↓
Review in /questions, /mistakes, /concepts
```

### What is extracted

| Item | Source |
|------|--------|
| Questions (number, title, business problem, requirements, tables) | Assistant messages |
| My SQL attempts (exact SQL preserved) | User messages containing SQL |
| Approach notes ("we can use multiple CTEs…") | User messages before SQL |
| ChatGPT feedback (correct / incorrect / hint / concept / mistake) | Assistant messages |
| Mistakes (category + description + correction) | Assistant messages |
| Scores (9/10, 9.8/10, ⭐⭐⭐) | Assistant messages |
| Concepts (CTE, UNION, conditional aggregation, …) | Assistant messages |

**Nothing is invented.** If difficulty/topic/score is not explicitly stated, it is stored as `null`. Suggested values are clearly labelled as `Suggested`.

### CLI importer

```bash
cd backend
source .venv/bin/activate
python -m app.parsers.chatgpt_import \
  --file /path/to/conversations.json \
  --start-question 59
```



## SQL Projects (dataset upload)

Upload your own data and the platform builds a dedicated PostgreSQL database for it,
then makes those tables available in the SQL editor.

Supported files: `.csv`, `.tsv`, `.txt`, `.xlsx`, `.xls`, `.json`, `.sql`. Upload several
at once and they become several related tables.

What happens on upload:

1. Each file (or Excel sheet, or JSON key) becomes a table; headers are sanitized into safe identifiers.
2. Column types are inferred — integer, bigint, numeric, boolean, timestamp, varchar, text.
3. A primary key is chosen from columns that are unique and non-null, preferring `*_id` names.
4. Foreign keys are proposed where a column name matches another table's primary key **and** every value exists in it.
5. `CREATE DATABASE sqlp_<slug>` runs, then tables are created, rows copied in, and constraints added last.
6. Row counts are compared against the source files and mismatches are reported as warnings.
7. `schema.sql` and `er_diagram.mmd` are written to `projects/<slug>/`, alongside the original files.
8. The read-only role is granted `SELECT`, so the editor can query it but cannot modify it.

If any step fails, the database is dropped and the project row removed — a failed upload
never leaves a half-built project behind.

```text
projects/
└── sales_analytics/
    ├── data/          # your original uploads
    ├── schema.sql     # generated DDL
    ├── er_diagram.mmd # mermaid ER diagram
    └── questions/
```

Pick the active project from the header dropdown. It controls which database **Run**,
**Schema** and **Test solution** hit; leaving it on *Northwind* keeps the original
behaviour. Projects are managed at `/projects`, where you can inspect inferred types,
keys and relationships, or delete a project along with its database.

Questions are not auto-generated — paste your own question and solution via **Add**, and
use *Test solution* to confirm the SQL runs against the selected database before saving.

---

## Architecture

| Layer | Responsibility |
|-------|----------------|
| **Frontend** | React + Vite + Monaco Editor + TanStack Query |
| **Backend** | FastAPI — question API, safe query execution, submission grading |
| **Practice DB** | PostgreSQL `northwind` — Northwind tables, **read-only** role |
| **App DB** | PostgreSQL `sql_practice` — questions, attempts, solutions, progress |
| **Project DBs** | PostgreSQL `sqlp_<slug>` — one per uploaded dataset |
| **Questions** | Versioned in `questions/questions.json` (optional GitHub sync) |

```text
Browser ──► FastAPI ──► sql_practice (metadata)
                │
                ├──► northwind  via sql_readonly (SELECT only)
                └──► sqlp_*     via sql_readonly (SELECT only)
```

Provisioning needs `POSTGRES_ADMIN_URL` to point at a role with `CREATEDB`; query
execution never uses it.

### Query execution security

1. **AST validation** with `sqlglot` — only `SELECT` / `WITH` / set ops allowed  
2. **Keyword fallback** rejects `INSERT/UPDATE/DELETE/DROP/...`  
3. **Single statement only** — multi-statement payloads rejected  
4. **PostgreSQL read-only role** + `BEGIN READ ONLY` + `statement_timeout`  
5. Errors sanitized (no credentials/hosts leaked)

### Answer evaluation

Submit runs your SQL and the hidden `reference_query`, then compares result sets (not SQL text). Ordering is enforced only when `sort_required` is true.

---

## Project structure

```text
sql-practice-platform/
├── frontend/          # React + TypeScript + Vite
├── backend/           # FastAPI application
├── questions/         # questions.json (+ build script from northwind-sql-practice)
├── database/          # Northwind schema + seed + init
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Public website (static, free hosting)

The same frontend also builds a public, SEO-friendly site that needs **no server**:
SQL runs in the visitor's browser on a real PostgreSQL ([PGlite](https://pglite.dev), WebAssembly)
loaded with the Northwind data, and progress is kept in `localStorage`.

| | Local app (`npm run dev`) | Public site (`npm run build:site`) |
|---|---|---|
| Entry | `frontend/index.html` → `src/main.tsx` | `frontend/site.html` → `src/site/` |
| SQL engine | FastAPI → PostgreSQL | PGlite in a Web Worker |
| Features | Everything, incl. ChatGPT import, uploads, GitHub sync, git lab | Learning path (18 lessons), 133 questions, mock interview, playground, concept guides, cheat sheet, flashcards, progress, optional accounts + admin |
| Rendering | Client-side SPA | Every page prerendered to HTML + JSON-LD, sitemap, robots |

```bash
# 1. Regenerate question data after editing ../northwind-sql-practice
backend/.venv/bin/python scripts/build_public_data.py

# 2. Develop the public site (http://localhost:5174)
cd frontend && npm run dev:site

# 3. Build + prerender → frontend/dist-site/
VITE_SITE_URL=https://<your-name>.pages.dev npm run build:site
npm run preview:site   # http://localhost:4174
```

**Learning library:** the public site has a set of connected learning modules:
- `/learn`: a dashboard with your daily goal, revision queue, recommendations, bookmarks and progress by concept.
- `/notes`: 65 theory notes.
- `/patterns`: 22 problem-solving patterns.
- `/shortcuts`: a searchable quick reference, side-by-side comparisons and an interview revision page.
- `/mindmaps`: 10 interactive mind maps.

Site-wide search opens with ⌘K. Notes, patterns, maps and questions all link to each other. The content is Markdown and JSON under `frontend/src/site/content/`, in the format defined in [docs/CONTENT_SPEC.md](docs/CONTENT_SPEC.md). `src/test/siteContent.test.ts` checks that every link resolves and that every runnable SQL example runs in the browser database. The gap analysis and next phases are in [docs/LEARNING_PLATFORM_PLAN.md](docs/LEARNING_PLATFORM_PLAN.md).

**DataForge Phase 3:**
- `/data-engineering`: 7 learning tracks with 102 topics: Python, ETL/ELT, data warehousing, Spark, Airflow, dbt and cloud. Every topic has notes, an architecture diagram, exercises and interview questions, and each track has a mind map and a flashcard deck. The topic registry is `frontend/src/site/content/tracks.json`.
- `/practice/python`: 20 Python exercises graded by tests in **Pyodide**, which runs in a sandboxed browser worker:
  - 10 s limit
  - in-memory filesystem only
  - imports of `js`, the network and `micropip` blocked
  - no server involved
- `/projects-lab`: 12 projects with 69 tasks. SQL tasks are checked on a dataset in one rolled-back transaction, and Python tasks by tests. Status is derived from the evidence: Completed only when every automated check passes. Manual steps stay Under evaluation.
- `/data-quality`: rules (NULL, duplicate, PK, FK, type, schema, date, outlier, missing records, reconciliation, row count, business rule) run on any sample or generated dataset, with a score, failing records, CSV/JSON reports and run comparison.
- **Visualize query** and **History** tabs on every SQL question and scenario:
  - logical steps with **Executed** rows (built only from your own clauses)
  - **Parsed** structure from a PostgreSQL AST: CTE data flow and set-operation branches
  - the **Plan** from EXPLAIN, with EXPLAIN ANALYZE only on request
  - queries that use `random()`/`now()` and similar get explanations only, never derived rows
  - sessions are saved per attempt
- `scripts/check_python_blocks.py` runs every Python example and task. CI runs it too.
- Supabase migration `003_dataforge.sql` adds tables for visualization sessions, project progress and submissions, and data quality rules and runs, each with RLS. When signed in, this data syncs to the account. Migration `004_submission_review.sql` adds admin review of submissions; see [docs/SUPABASE.md](docs/SUPABASE.md).

**Career tools (Phase 4):** these are all built from existing content and your own records.
- `/career/planner`: a week-by-week plan for the data analyst, data engineer or analytics engineer role. It fits your weekly hours, and items tick off from evidence (note read, question solved, project completed).
- `/career/companies`: what interviews at product companies, startups, services firms, banks and retailers tend to focus on, linked to notes, sets, scenarios and projects. This is general guidance, with no company named.
- `/career/answers`: more than 400 interview questions taken from the notes. You answer first, then compare with the model answer and a key-term check, and rate yourself. Missed questions come back sooner.
- `/portfolio`: your verified record (independent and assisted solves, imported solves listed separately, projects with reviewer approval, checks). Export it as Markdown or print it.
- Plan, answer ratings and portfolio name sync through the account's profile state. Answer text stays on the device.

**SQL intelligence tools:** these all run in the browser on PGlite.
- `/ai-tutor`: 5-level hints that record when you used help, rule-based query explanations, a schema check, and result checks verified by the database. The AI chat is off unless `VITE_TUTOR_ENDPOINT` points to a server-side proxy; see [docs/INTELLIGENCE_PLAN.md](docs/INTELLIGENCE_PLAN.md).
- `/query-visualizer`: steps through the logical processing order with real intermediate rows.
- `/solution-comparison`: compares two queries side by side for equivalence, plans and timing.
- `/readiness`: an evidence-based readiness estimate.
- `/playground`: six practice databases (Northwind, HR, Sales, E-commerce, Banking, Inventory), each isolated in its own instance. It has a schema explorer, ER diagram, history, saved queries and export. Regenerate the datasets with `python3 scripts/build_datasets.py`.
- `/data-generator`: builds reproducible practice datasets with controllable NULLs, duplicates, orphans and invalid values.
- `/scenarios`: 16 business scenarios, graded by result.

`scripts/build_public_data.py` writes `frontend/public/data/` (`index.json`, `topics.json`,
one `q/<slug>.json` per question, `northwind.sql`). Commit that folder so hosting builds
don't need the question repo. Concept guides live in `frontend/src/site/content/*.md`.

### Deploy on Cloudflare (free)

Live: https://sql-practice-lab.sql-practice-frontend.workers.dev. To deploy by hand: `cd frontend && npm run build:site && npx wrangler deploy -c wrangler.jsonc`.

Alternatively, Cloudflare Pages (`*.pages.dev`):

1. Push this repo to GitHub (`.env` is git-ignored; check `git status` before the first commit).
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick the repo.
3. Build settings: root directory `frontend`, build command `npm ci && npm run build:site`,
   output directory `dist-site`. Add env var `VITE_SITE_URL=https://<project>.pages.dev`.
4. Deploy. `public/_headers` sets caching and the WASM content type; `404.html` is served for unknown URLs.
5. In [Google Search Console](https://search.google.com/search-console) add the site and submit
   `https://<project>.pages.dev/sitemap.xml` (same in Bing Webmaster Tools).

### Accounts, Google login and admin (optional, Supabase free tier)

Without Supabase the site works anonymously, and progress stays in the browser. When it is configured:
- visitors can sign in with a username/email and password, or with Google
- progress, flashcards, lessons and mock interviews sync across devices
- admins get `/admin`, showing user counts, activity, every user's solved count, role changes and the audit log

The schema and RLS policies are in `supabase/migrations/001_accounts.sql`:
- users can read and write only their own rows
- the audit log is append-only
- only admins can change roles

1. Create a project at [supabase.com](https://supabase.com). Then open **SQL editor**, paste and run `supabase/migrations/001_accounts.sql`.
2. **Authentication → Providers → Email:** turn on email, and turn off "Confirm email". Usernames sign in with a synthetic `@users.sqlpractice.local` address.
3. **Google:**
   - In Google Cloud Console → APIs & Services → Credentials, create an OAuth client ID (type: Web).
   - Add the authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`.
   - Paste the client ID and secret into Supabase **Authentication → Providers → Google**.
4. **Authentication → URL configuration:** set the Site URL to `https://<project>.pages.dev`, and add `http://localhost:4174/**` for local testing.
5. Seed the owner and admin accounts and import the owner's solved questions. Every non-🆕 question is marked solved. Run this from your own shell, and never commit these values:
   ```bash
   cd frontend
   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
   SEED_USER_PASSWORD='<owner password>' SEED_ADMIN_PASSWORD='<temporary admin password>' \
   node scripts/seed-accounts.mjs
   ```
   This creates `Subramanya.a` (user) and `admin` (admin). The admin must change its password at first sign-in.
6. Add these to the Cloudflare Pages env, and to `frontend/.env.local` for local builds:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

   The anon key is public by design, and RLS protects the data. Never put the service-role key in a `VITE_` variable.

7. **Community features:** run `supabase/migrations/002_community.sql` as well. It adds:
   - shared solutions (visible only to people who solved the question) and likes
   - comments, with a limit of 20 per hour; admins can hide them, which is logged in the audit log
   - the weekly challenge, set from `/admin`
   - public profiles (opt-in on `/account`) and the `/leaderboard`
8. **DataForge sync and submission review:** run `003_dataforge.sql`, then `004_submission_review.sql`. Setup, roles and the two-browser test are in [docs/SUPABASE.md](docs/SUPABASE.md).

You can test the RLS policies locally against plain Postgres:
```bash
createdb authtest && psql -d authtest -f supabase/tests/auth_stub.sql \
  && psql -d authtest -f supabase/migrations/001_accounts.sql && psql -d authtest -f supabase/migrations/002_community.sql \
  && psql -d authtest -f supabase/tests/rls_test.sql && psql -d authtest -f supabase/tests/rls_test_002.sql
```
Without Postgres installed, `cd frontend && npx vitest run src/test/supabaseRls.test.ts` applies 001–004 on PGlite and checks RLS, isolation and the review workflow.

### Automatic deploys (GitHub Actions)

`.github/workflows/deploy.yml` runs on every push to `main`: it tests, prerenders, and then deploys with `wrangler deploy -c frontend/wrangler.jsonc`. To set it up, go to the repo's **Settings → Secrets and variables → Actions**:
- **Secrets:**
  - `CLOUDFLARE_API_TOKEN`: create it in Cloudflare → My Profile → API Tokens, from the "Edit Cloudflare Workers" template.
  - `CLOUDFLARE_ACCOUNT_ID`
- **Variables (optional):**
  - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
  - `VITE_GSC_TOKEN`: the Search Console HTML-tag verification code
  - `VITE_CF_BEACON`: the Cloudflare Web Analytics token, which is cookie-free

If the token secret is missing, the workflow still tests and builds, and skips the deploy.

---

## Quick start (Docker)

```bash
cd sql-practice-platform
cp .env.example .env
docker compose up --build
```

- Frontend: http://localhost:5173  
- Backend API: http://localhost:8000  
- API docs: http://localhost:8000/docs  
- Postgres: localhost:5432  

Default practice credentials (Docker):

| Role | User | Password | Database |
|------|------|----------|----------|
| Read-only queries | `sql_readonly` | `readonly_pass` | `northwind` |
| App metadata | `sql_app` | `app_pass` | `sql_practice` |
| Admin | `postgres` | `postgres` | — |

---

## Local development

### 1. PostgreSQL

Either use Docker for Postgres only:

```bash
docker compose up postgres -d
```

Or point `.env` at your existing Northwind database (see below).

### 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp ../.env.example ../.env  # edit as needed
uvicorn app.main:app --reload --port 8000
```

On startup the API creates app tables, seeds the local user, and loads `questions/questions.json` if the question table is empty.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 — Vite proxies `/api` to the backend.

---

## Environment variables

Copy `.env.example` → `.env`. Never commit `.env`.

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Practice DB (asyncpg). Use the **read-only** user. |
| `APP_DATABASE_URL` | App metadata DB. |
| `DATABASE_ADMIN_URL` | Optional admin URL for setup scripts. |
| `APP_DATABASE_ADMIN_URL` | Optional admin URL for app DB. |
| `GITHUB_REPOSITORY` | `owner/repo` for question sync (optional). |
| `GITHUB_TOKEN` | GitHub PAT — **backend only**, never in frontend. |
| `GITHUB_BRANCH` | Branch to read (default `main`). |
| `GITHUB_QUESTIONS_PATH` | Path to JSON in repo (default `questions/questions.json`). |
| `QUERY_TIMEOUT_SECONDS` | Statement timeout (default `5`). |
| `QUERY_MAX_ROWS` | Max rows returned to UI (default `1000`). |
| `CORS_ORIGINS` | Comma-separated allowed origins. |
| `BACKEND_PORT` / `FRONTEND_PORT` | Documented ports. |
| `DEFAULT_USER_ID` / `DEFAULT_USER_NAME` | Single local user until auth is added. |
| `QUESTIONS_FILE_PATH` | Path to local `questions.json`. |
| `POSTGRES_ADMIN_URL` | Server-level connection used **only** to `CREATE DATABASE` for new projects. Needs `CREATEDB`. |
| `PROJECT_DB_HOST` / `PROJECT_DB_PORT` | Host and port used to build per-project URLs. |
| `PROJECT_DB_OWNER` / `PROJECT_DB_OWNER_PASSWORD` | Role that owns project databases and runs the import. |
| `PROJECT_DB_READONLY_USER` / `PROJECT_DB_READONLY_PASSWORD` | Role granted `SELECT` on every project database. |
| `PROJECT_DB_PREFIX` | Prefix for provisioned databases (default `sqlp_`). |
| `PROJECTS_ROOT` | Where uploaded files and generated `schema.sql` are stored. |
| `MAX_UPLOAD_MB` | Total upload size limit (default `200`). |

---

## Connect to your existing PostgreSQL / Northwind

1. Ensure Northwind-style tables exist: `customers`, `employees`, `suppliers`, `products`, `categories`, `orders`, `order_details`, `shippers`.
2. Create a **read-only** role:

```sql
CREATE ROLE sql_readonly LOGIN PASSWORD 'your_password';
GRANT CONNECT ON DATABASE your_db TO sql_readonly;
GRANT USAGE ON SCHEMA public TO sql_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO sql_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO sql_readonly;
```

3. Create a separate app database (do **not** mix metadata with Northwind tables):

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

5. Skip the Docker `postgres` service (or leave it unused) and run backend/frontend locally.

You can still apply `database/schema.sql` + `database/seed.sql` if you need a fresh practice dataset.

---

## API

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

---

## Questions & GitHub

- Canonical file: [`questions/questions.json`](./questions/questions.json)  
- Rebuild from your `northwind-sql-practice` markdown/SQL pairs:

```bash
python questions/build_questions.py
```

- Sync via UI **Sync** button or `POST /api/github/sync`  
- Set `GITHUB_REPOSITORY` + `GITHUB_TOKEN` on the **backend** only  

To add a question you can either use the **Add** page in the UI (auto-assigns the next Q
number, optional reference SQL, *Test solution* before saving) or append an object to
`questions.json` and sync. Do not put reference SQL in frontend code.

Seeded content includes your Self Join / Cross Join / Set Operator progression (≈Q61–Q86) plus conditional aggregation practice (Q87–Q91).

---

## Difficulty progression

After **3 consecutive correct** submissions, suggested level increases  
(`Beginner → Intermediate → Advanced → Senior → Expert`).  
After **5 consecutive incorrect**, level decreases one step.  
Use **Continue** / **Choose Question** after a correct submit — questions are never auto-skipped.

---

## Tests

```bash
# Backend
cd backend && source .venv/bin/activate
pytest -q

# Frontend
cd frontend && npm test
```

Coverage includes SQL validation, destructive rejection, result comparison, difficulty
helpers, dataset schema inference (types, primary keys, foreign keys, DDL, ER diagram),
and UI result/submit rendering.

The upload pipeline also has a smoke test that provisions a throwaway database from
generated CSVs, queries it through the read-only role, checks writes are blocked, then
drops it:

```bash
cd backend && source .venv/bin/activate
python scripts/smoke_project_upload.py
```

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘/Ctrl + Enter` | Run query |

Editor also supports Format, Reset, Clear, and Copy.

---

## Responsibility

Code for DataForge lives in the `sql-practice-platform` repository. Existing practice materials live in the sibling `northwind-sql-practice` folder and can be imported via `questions/build_questions.py`.
