# Daily Learning: curriculum and architecture proposal

Status: proposal for approval. No application code has been changed.
Date: 2026-11-11.

## 1. What the codebase already has

Checked in `frontend/src/site/` (the public static site, prerendered, with optional Supabase sync).

| Resource | Amount | Where |
|---|---|---|
| SQL notes | 65, in 8 categories | `content/notes/<category>/` |
| SQL lessons | 18 | `content/lessons/` |
| SQL questions | 150 | `public/data/index.json`, `q/` |
| SQL patterns | 22 | `content/patterns/` |
| Python notes | 21 (fundamentals through pandas, numpy, APIs, ETL) | `content/notes/python/` |
| Python exercises | 150, run in the browser | `content/python/` |
| Data engineering notes | ETL 15, Airflow 14, Spark 15, dbt 11, cloud 13, warehousing 13 | `content/notes/<track>/` |
| Projects | 12 (CSV to Postgres, REST API to Postgres, incremental loading, data validation, star schema, and others) | `content/projects/` |
| Mind maps | 17 | `content/mindmaps/` |
| Tracks | 8 topic lists | `content/tracks.json`, `lib/tracks.ts` |
| Progress, revision, mistakes, timer, streak, XP | exist | `lib/progress.ts`, `lib/revision.ts`, `lib/gamification.ts`, `components/SolveTimer.tsx` |

Stack: React 18, react-router, Tailwind 3, Vite static prerender, PGlite and Pyodide in the browser, Supabase sync through the `profiles.state` JSON blob (no migration needed to add fields).
The site has no animation library. `components/Motion.tsx` has only `Reveal` and `CountUp`.

### Gaps (content that does not exist yet)

- Statistics, EDA, Matplotlib, Seaborn, Plotly: no notes, no exercises.
- Git and Linux: nothing.
- Excel processing: nothing.
- Interview prep outside SQL questions: thin.
- Python and pandas are one note each. A day-sized lesson on each pandas topic (groupby, merge, pivot, rolling) does not exist.
- Day-level runnable examples, expected outputs and knowledge checks: none for any topic.

### Open technical checks before building

1. Pyodide worker (`lib/pyodide.worker.ts`): confirm numpy, pandas, matplotlib load. Seaborn and Plotly may not run in-browser. If not, those days use read-only code with pre-rendered output images, or a "run locally" note.
2. `requests` does not work in Pyodide. API days need a mocked HTTP layer (pre-recorded responses) in the browser, with a "run locally" variant.
3. PostgreSQL loading days run on PGlite, which is isolated per browser tab.

## 2. Sequence change from your proposal

Your order puts SQL at days 61 to 90, after Pandas. I propose moving SQL to days 31 to 60, right after Python, for these reasons:
- SQL is the strongest existing content, so the learner reaches real material sooner.
- Pandas `merge`, `groupby` and `rolling` are easier once joins, GROUP BY and window functions are known.
- NumPy then sits directly in front of Pandas, where it is needed.
- Git and Linux go to day 30 so the learner has them before the project days.

Statistics, EDA and visualisation keep their order. The project sequences you listed (CSV, Excel, API, SQL plus Python, incremental ETL, data quality) become explicit multi-day blocks. Total stays 180 days.

## 3. Day-by-day curriculum

"Reuse" says what exists. "New" means content must be written.

### Phase 1: Python fundamentals (days 1 to 15). Reuse: python notes, py exercises
1. Install Python, REPL, first script
2. Variables and data types
3. Numbers and operators
4. Strings
5. String formatting, input and output
6. Booleans and comparisons
7. Conditional statements
8. Lists
9. Tuples and sets
10. Dictionaries
11. for loops and range
12. while loops, break, continue
13. Nested loops and loop patterns
14. Functions: parameters and return values
15. Checkpoint project: expense summariser

### Phase 2: Intermediate Python (days 16 to 30). Reuse: python notes, py exercises
16. Scope, default and keyword arguments, `*args`, `**kwargs`
17. Lambda, `map`, `filter`, `sorted(key=)`
18. Comprehensions
19. File handling
20. CSV and JSON modules
21. Exceptions
22. Modules, packages, standard library (`collections`, `itertools`)
23. Dates and times
24. OOP 1: classes and objects
25. OOP 2: inheritance, dunder methods, dataclasses
26. Iterators and generators
27. Decorators and context managers
28. Regular expressions and text cleaning
29. Virtual environments, pip, logging
30. Git and Linux command line (New)

### Phase 3: SQL fundamentals (days 31 to 45). Reuse: sql notes, lessons 1 to 16, questions
31. Relational model, PostgreSQL, the Northwind database
32. SELECT, aliases, expressions
33. WHERE, LIKE, IN, BETWEEN
34. ORDER BY, LIMIT, DISTINCT
35. NULL handling
36. Aggregate functions
37. GROUP BY and HAVING
38. CASE, string and numeric functions
39. Date and time functions
40. INNER JOIN
41. LEFT, RIGHT, FULL joins
42. Self joins, cross joins, multi-table joins
43. Subqueries
44. INSERT, UPDATE, DELETE
45. DDL, data types, constraints. Checkpoint quiz.

### Phase 4: Advanced SQL (days 46 to 60). Reuse: advanced notes, patterns, lessons 14 to 18, questions
46. CTEs
47. Set operators
48. EXISTS, NOT EXISTS, anti-joins
49. Window functions 1: OVER, PARTITION BY
50. ROW_NUMBER, RANK, DENSE_RANK, top N per group
51. LAG and LEAD
52. Running totals, moving averages, frames
53. NTILE, FIRST_VALUE, percentiles
54. Recursive CTEs
55. Deduplication, gaps and islands
56. Cohort, retention and funnel SQL
57. Indexes and EXPLAIN
58. Transactions and ACID
59. Views, materialised views, functions, JSON in PostgreSQL
60. SQL checkpoint: timed assessment (existing assessments and mock interview)

### Phase 5: NumPy (days 61 to 67). Reuse: python-numpy note. New: day lessons
61. ndarray basics
62. Indexing, slicing, boolean masks
63. Vectorisation and broadcasting
64. Aggregation and axes
65. Reshape, stack, sort
66. Random numbers and missing values
67. NumPy mini-project

### Phase 6: Pandas (days 68 to 87). Reuse: python-pandas note, py exercises. New: day lessons
68. Series and DataFrame
69. Reading and writing CSV, Excel, JSON
70. Inspecting data
71. `loc` and `iloc`
72. Boolean filtering and `query`
73. Sorting, new columns, `assign`
74. Missing values
75. Duplicates and dtype conversion
76. String methods
77. Datetime handling
78. `apply`, `map`, vectorisation
79. groupby 1
80. groupby 2: `agg`, `transform`
81. `merge` and join types
82. `concat`
83. `pivot`, `pivot_table`, `crosstab`
84. `melt` and reshaping
85. `rolling`, `expanding`, `shift`
86. Categoricals, memory, chunked reading
87. Project: clean a messy dataset

### Phase 7: Statistics (days 88 to 98). New
88. Mean, median, mode
89. Variance, standard deviation, IQR
90. Distributions and skew
91. Probability basics
92. Normal distribution, z-scores
93. Sampling and the central limit theorem
94. Confidence intervals
95. Hypothesis testing
96. t-tests and chi-square
97. Correlation, causation, simple regression
98. A/B testing project

### Phase 8: Exploratory data analysis (days 99 to 106). New
99. EDA workflow and asking questions
100. Univariate analysis
101. Bivariate analysis
102. Outliers
103. Derived metrics and time-series EDA
104. Segmentation and cohorts in pandas
105. Data storytelling
106. EDA project

### Phase 9: Data visualisation (days 107 to 116). New
107. Chart selection and design principles
108. Matplotlib 1
109. Matplotlib 2: subplots and styling
110. Seaborn 1
111. Seaborn 2: heatmaps, pair plots, facets
112. Plotly Express
113. Interactive Plotly
114. Time-series and distribution charts
115. Dashboard storytelling
116. Project: sales insights report

### Phase 10: CSV to PostgreSQL (days 117 to 121). Reuse: csv-to-postgres-etl project, python-csv-json, python-database-connectivity
117. Python to PostgreSQL connection
118. Design the target schema
119. Read and validate CSV in chunks
120. Idempotent load: COPY, `executemany`, `to_sql`
121. Validate the load with SQL

### Phase 11: Excel to DataFrame to PostgreSQL (days 122 to 126). New
122. Excel with pandas and openpyxl
123. Messy sheets: merged cells, headers, types
124. Multi-sheet to normalised tables
125. Load with keys and constraints
126. Reconciliation and reporting queries

### Phase 12: REST API to PostgreSQL (days 127 to 136). Reuse: rest-api-to-postgres project, python-api-integration
127. Understand REST APIs
128. HTTP methods and status codes
129. API requests with Python
130. Parse JSON responses
131. Pagination and error handling
132. Clean API data with pandas
133. Load into PostgreSQL
134. Validate loaded records
135. Analytical SQL queries
136. Visualise and explain business insights

### Phase 13: SQL and Python combined analytics (days 137 to 141). New
137. Parameterised queries and `read_sql`
138. SQL or pandas: where to do the work
139. SQL plus pandas analysis workflow
140. Window and cohort SQL, charts in Python
141. Analytics mini-project

### Phase 14: ETL and incremental loading (days 142 to 148). Reuse: etl notes, incremental-loading project
142. ETL versus ELT, architecture
143. Modular extract and transform code
144. Batch processing, full load, idempotency
145. Incremental loading and watermarks
146. Upserts with `ON CONFLICT`, CDC concepts
147. Error handling, retries, logging, monitoring
148. Incremental ETL project

### Phase 15: Data quality and validation (days 149 to 154). Reuse: data-validation-pipeline project, etl-data-validation note, DataQualityPage
149. Data quality dimensions
150. Validation rules in pandas
151. Schema checks and data contracts
152. SQL quality checks and constraints
153. Testing pipelines with pytest (New)
154. Project: validation pipeline with report

### Phase 16: Databases and warehousing (days 155 to 160). Reuse: warehousing notes, star-schema-warehouse and hr-analytics-warehouse projects
155. OLTP versus OLAP
156. Dimensional modelling: facts and dimensions
157. Star schema design
158. Slowly changing dimensions
159. Build and load a star schema
160. Analytical queries on the warehouse

### Phase 17: Orchestration and Spark (days 161 to 168). Reuse: airflow notes, spark notes, airflow-etl-pipeline and pyspark-transformation projects
161. Airflow concepts: DAGs and tasks
162. Operators, schedules, dependencies
163. Retries, backfill, idempotent DAGs
164. Pipeline in Airflow
165. Spark fundamentals: lazy evaluation, DataFrames
166. PySpark transformations
167. Spark SQL, joins, partitions
168. PySpark ETL mini-project

### Phase 18: Interview preparation (days 169 to 172). Reuse: mock interview, interview sets, patterns, career pages
169. SQL interview sprint
170. Python and pandas interview sprint
171. Data modelling and pipeline design interviews
172. Mock interview, portfolio review

### Phase 19: Capstone (days 173 to 180). Reuse: end-to-end-pipeline, sales-analytics-pipeline projects
173. Plan and choose a dataset
174. Ingestion
175. Cleaning and validation
176. Model and load the warehouse
177. Analytical SQL
178. Visualisation and insights
179. Orchestration, tests, documentation
180. Presentation and retrospective

## 4. Per-day content shape

One JSON or Markdown file per day, with the 17 fields you listed. Each day has:
- Time budget, which varies per day. The default is 25 / 20 / 25 / 45 / 15 minutes (130 total). Project days shift to about 20 / 10 / 15 / 90 / 15. Theory-heavy days (statistics) shift to about 40 / 25 / 25 / 25 / 15.
- Runnable examples (SQL on PGlite, Python on Pyodide), each tested in CI like existing notes.
- Guided exercises with progressive hints, independent exercises, expected outputs, 4 to 6 knowledge-check questions.
- References by id only (note slug, question number, exercise slug, project slug, mind map id).

## 5. Architecture

Folder: `frontend/src/site/content/daily/`

```
daily/
  curriculum.json        phases and the ordered day list (id, title, phase, minutes, prerequisites)
  days/
    001-install-python.md       frontmatter + sections (Understand, Examples, Guided, Independent, Check, Review)
    002-variables-types.md
  exercises/<day>.json   guided and independent exercises, expected output, hints
  checks/<day>.json      knowledge-check questions and answers
```

Frontmatter links reuse existing content by reference: `notes`, `questions`, `pyExercises`, `projects`, `mindmaps`, `patterns`. No question is copied.

Code:
- `lib/daily.ts`: loaders and the curriculum graph (same style as `lib/learning.ts`).
- `lib/dailyProgress.ts`: pure functions for status, streak, calendar and mastery. Unit tested.
- `pages/DailyPages.tsx` (dashboard) and `pages/DailyLessonPage.tsx` (lesson), lazy loaded.
- `components/daily/`: `ProgressRing`, `TodayHero`, `PhaseRoadmap`, `DayCard`, `LearningCalendar`, `LessonStepper`, `ExerciseRunner`, `KnowledgeCheck`.
- Routes: `/daily` and `/daily/day/:n`. Add both to `routes.tsx` with `paths()` for prerendering, and add a top-level "Daily Learning" item in `lib/navigation.ts`. No existing item is removed.

### Progress model

One new optional field on `Progress`: `daily`. It rides the existing sync, so no database migration. `migrateProgress` defaults it when absent, so old saved progress still loads.

```
daily: {
  startedOn: "2026-11-12",
  days: {
    "42": {
      theory: true,                 // viewed (scrolled to end)
      examples: ["ex1","ex2"],      // run
      attempted: ["g1","i1"],
      passed: ["g1"],
      checkScore: 0.8,              // best and last kept
      reviewDone: false,
      completedAt: "2026-11-20",
      lastVisit, inProgress: true, minutesSpent
    }
  }
}
```

- Completion: theory viewed, all required guided exercises passed, check score of at least 60%, and independent exercises attempted. Optional items are flagged `optional` in the exercise file.
- Mastery is separate: check score of at least 80%, independent exercises passed, and revision done. A completed day can be below mastery.
- Reopening a completed day never clears history. Retries append to the attempt list.
- Exercise results reuse existing code paths: `recordAttempt` and `completeExercise` for questions, `schedulePython` for Python, `recordMistake` for failures, and `lib/revision.ts` for spaced review (a failed check marks the day "Revision required" and queues its linked items). The existing timer and analytics receive the same events, so no parallel tracking system is added.

### Statuses and scheduling

- Locked: the previous day is not complete. Optionally lenient: a learner can open any day after day N where N-1 is complete, or jump ahead with an "I know this" skip that records as skipped, not completed.
- Available, In progress, Completed, Revision required.
- Calendar: current day is the first incomplete day. A missed calendar day is shown neutral and never shifts or penalises anything. The streak counts days with any activity and has a grace day.

## 6. UI and animation

Design uses the existing DataForge tokens and Tailwind setup. I checked Watermelon (`mcp__watermelon__*`):
- It is shadcn and Tailwind based, and its animated components need `motion/react`.
- Relevant hits: `calendar-widget` (animated), `stats-1` to `stats-3` (stats blocks), calendar blocks. It has no roadmap-timeline or progress-ring entry. `compose_page` returned the same hero block for four different sections, so it is not a reliable layout planner.

Proposal:
- Add one dependency: `motion` (about 20 KB gzipped for the pieces used).
- Use Watermelon as source for the stats cards and calendar widget, restyled to DataForge tokens. Build the progress ring, phase roadmap, today hero and lesson stepper ourselves.
- Animations: animated progress ring and `CountUp` stats, staggered phase and day-card reveal, layout animation when a phase expands, animated connector line on the roadmap, calendar cell pop on completion, lesson stepper slide, a completion celebration (reuse `ProjectCelebration`). All respect `prefersReducedMotion()`.
- Prerendering: animated components must render a static state on the server, so the crawled HTML is correct.

## 7. Initial batch after approval (about 10 days of content plus the whole shell)

1. Content schema, `curriculum.json` with all 180 day entries (titles, phases, prerequisites, reuse links), and a test that checks every reference resolves.
2. `lib/daily.ts`, `lib/dailyProgress.ts`, `Progress.daily` with migration, and unit tests.
3. Navigation item, routes, dashboard and lesson page.
4. Full content for days 1 to 5 (Python) and days 31 to 35 (SQL, mostly reusing existing notes and questions), all examples executed in CI.
5. Days 6 to 180 show as "Content coming" with their title, topics and reuse links, so the roadmap is complete but no filler lessons exist.

Then content ships in batches by phase, each batch tested before merge.

## 8. Decisions needed

1. Approve the sequence change (SQL to days 31 to 60)?
2. Add `motion` as a dependency?
3. Day locking: strict, or open ahead with a recorded skip?
4. Seaborn, Plotly, `requests` cannot run in Pyodide as is: accept pre-rendered output plus "run locally" for those days?
5. Authoring rate: write the content here in batches by phase, with execution tests, or generate with review gates?
