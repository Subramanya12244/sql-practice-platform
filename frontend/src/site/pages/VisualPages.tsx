import { Suspense, lazy, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Container, PageHeader, Skeleton } from "../components/ui";
import { Seo, breadcrumbs } from "../lib/seo";
import { PythonTimeMachine } from "../components/visual/PythonTimeMachine";
import { ApiStudio } from "../components/visual/ApiStudio";
import { EtlPlayback } from "../components/visual/EtlPlayback";
import { ChartExplorer } from "../components/visual/ChartExplorer";
import { TEMPLATES } from "../lib/visual/dailyVisual";
import { VisualHelp } from "../components/visual/VisualHelp";
import type { HelpId } from "../lib/visual/helpContent";
import { TreeExplorer } from "../components/visual/TreeExplorer";
import { GraphExplorer } from "../components/visual/GraphExplorer";
import { ExcelLab } from "../components/visual/ExcelLab";
import { LinuxLab } from "../components/visual/LinuxLab";
import { GitLab } from "../components/visual/GitLab";
import { StatsLab } from "../components/visual/StatsLab";
import { BusinessLab } from "../components/visual/BusinessLab";
import { InterviewLab } from "../components/visual/InterviewLab";

const CodeEditor = lazy(() => import("../components/CodeEditor"));

const crumb = (name: string, path: string) => breadcrumbs([{ name: "Home", path: "/" }, { name: "Visual Learning", path: "/visual" }, ...(path === "/visual" ? [] : [{ name, path }])]);

export function VisualHubPage() {
  const cards = [
    { ...TEMPLATES.sql, name: "SQL Query Cinema", to: "/query-visualizer" },
    { ...TEMPLATES.python, name: "Python Code Time Machine", to: "/visual/python" },
    { ...TEMPLATES.data, name: "Pandas and NumPy Studio", to: "/visual/data" },
    { ...TEMPLATES.api, name: "API Request Studio", to: "/visual/api" },
    { ...TEMPLATES.etl, name: "ETL Pipeline Playback", to: "/visual/etl" },
    { ...TEMPLATES.chart, name: "Data Visualization Explorer", to: "/visual/charts" },
    { ...TEMPLATES.tree, name: "Tree Explorer", to: "/visual/tree" },
    { ...TEMPLATES.graph, name: "Graph Explorer", to: "/visual/graph" },
    { ...TEMPLATES.excel, name: "Excel Lab", to: "/visual/excel" },
    { ...TEMPLATES.linux, name: "Linux Terminal Lab", to: "/visual/linux" },
    { ...TEMPLATES.git, name: "Git Lab", to: "/visual/git" },
    { ...TEMPLATES.stats, name: "Statistics Lab", to: "/visual/stats" },
    { ...TEMPLATES.business, name: "Business Analytics Lab", to: "/visual/business" },
    { ...TEMPLATES.interview, name: "Interview Walkthrough", to: "/visual/interview" },
  ];
  return (
    <Container>
      <Seo title="Visual Learning Engine" description="Watch SQL, Python, pandas, NumPy, APIs, ETL pipelines and charts execute step by step, using your own code and real results." path="/visual" jsonLd={[crumb("Visual Learning", "/visual")]} />
      <PageHeader eyebrow="Visual Learning" title="Watch your code run" intro="Step through real execution instead of only reading about it. Each tool says what is real (your code actually ran), what is a teaching model, and what is a simulation." />
      <ul className="grid gap-3 pb-16 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <li key={c.to}><Link to={c.to} className="block h-full rounded-card border border-surface-border bg-surface-raised p-4 transition-colors hover:border-accent/50">
            <h2 className="font-display text-base font-bold text-ink">{c.name}</h2><p className="mt-1 text-sm text-ink-muted">{c.blurb}</p></Link></li>
        ))}
      </ul>
    </Container>
  );
}

interface Preset { label: string; code: string }

function CodeLab({ presets, mode, intro }: { presets: Preset[]; mode: "variables" | "data"; intro: string }) {
  const [code, setCode] = useState(presets[0].code);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div className="space-y-3 pb-16">
      <p className="text-sm text-ink-muted">{intro}</p>
      <div className="flex flex-wrap gap-2">{presets.map((p) => <button key={p.label} type="button" onClick={() => setCode(p.code)} aria-pressed={code === p.code} className="rounded-lg border border-surface-border px-3 py-1.5 text-sm text-ink-muted hover:text-ink aria-pressed:border-accent aria-pressed:text-ink">{p.label}</button>)}</div>
      {mounted ? <Suspense fallback={<Skeleton className="h-[220px]" />}><CodeEditor value={code} onChange={setCode} onRun={() => undefined} height={220} language="python" label="Python code to trace" /></Suspense> : <Skeleton className="h-[220px]" />}
      <PythonTimeMachine key={code} code={code} mode={mode} />
    </div>
  );
}

const PY_PRESETS: Preset[] = [
  { label: "Loop and total", code: "total = 0\nfor n in [3, 1, 4]:\n    total += n\nprint(total)\n" },
  { label: "List aliasing", code: "a = [1, 2]\nb = a\nb.append(3)\nc = a.copy()\nc.append(4)\nprint(a, c)\n" },
  { label: "Dictionary", code: "stock = {}\nstock['apple'] = 3\nstock['apple'] += 2\ndel stock['apple']\nprint(stock.get('apple', 0))\n" },
  { label: "Recursion", code: "def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\n\nprint(fact(4))\n" },
  { label: "Generator", code: "def count_up(limit):\n    i = 0\n    while i < limit:\n        yield i\n        i += 1\n\ng = count_up(3)\nprint(next(g))\nprint(next(g))\n" },
  { label: "Exception", code: "scores = [90, 80]\ntotal = 0\nfor i in range(3):\n    total += scores[i]\n" },
  { label: "Linked list", code: "class Node:\n    def __init__(self, value, nxt=None):\n        self.value = value\n        self.next = nxt\n\nhead = Node(1, Node(2, Node(3)))\nnode = head\nwhile node:\n    print(node.value)\n    node = node.next\n" },
  { label: "Stack and queue", code: "from collections import deque\nstack = []\nstack.append(1)\nstack.append(2)\ntop = stack.pop()\nqueue = deque([1, 2, 3])\nfirst = queue.popleft()\n" },
];

const DATA_PRESETS: Preset[] = [
  { label: "Filter and sort", code: "import pandas as pd\ndf = pd.DataFrame({'city': ['Oslo', 'Rome', 'Lima', 'Kyiv'], 'sales': [120, 75, 200, 90]})\nbig = df[df['sales'] > 80]\nbig = big.sort_values('sales', ascending=False)\n" },
  { label: "GroupBy and aggregate", code: "import pandas as pd\ndf = pd.DataFrame({'team': ['a', 'b', 'a', 'b', 'a'], 'pts': [3, 5, 4, 1, 2]})\ntotals = df.groupby('team')['pts'].sum()\navg = df.groupby('team')['pts'].mean().reset_index()\n" },
  { label: "Merge", code: "import pandas as pd\nusers = pd.DataFrame({'id': [1, 2, 3], 'name': ['Ana', 'Ben', 'Chen']})\norders = pd.DataFrame({'user_id': [1, 1, 3], 'amount': [10, 20, 5]})\njoined = users.merge(orders, left_on='id', right_on='user_id', how='left')\n" },
  { label: "Missing values and types", code: "import pandas as pd\ndf = pd.DataFrame({'a': ['1', '2', 'x'], 'b': [1.5, None, 3.0]})\ndf['b'] = df['b'].fillna(0)\ndf['a'] = pd.to_numeric(df['a'], errors='coerce')\nclean = df.dropna()\n" },
  { label: "Pivot and melt", code: "import pandas as pd\nlong = pd.DataFrame({'m': ['Jan', 'Jan', 'Feb', 'Feb'], 'k': ['x', 'y', 'x', 'y'], 'v': [1, 2, 3, 4]})\nwide = long.pivot(index='m', columns='k', values='v')\nback = wide.reset_index().melt(id_vars='m')\n" },
  { label: "Duplicates and concat", code: "import pandas as pd\na = pd.DataFrame({'id': [1, 2, 2], 'v': [10, 20, 20]})\nb = pd.DataFrame({'id': [3], 'v': [30]})\nall_rows = pd.concat([a, b], ignore_index=True)\nunique = all_rows.drop_duplicates()\n" },
  { label: "NumPy broadcasting", code: "import numpy as np\na = np.arange(6).reshape(2, 3)\nb = np.array([10, 20, 30])\nc = a + b\ncol = np.array([[100], [200]])\nd = a + col\n" },
  { label: "Masks, slicing, aggregation", code: "import numpy as np\nx = np.array([[1, 5, 9], [2, 6, 3]])\nmask = x > 4\nbig = x[mask]\nrow = x[0, :]\ncol_sums = x.sum(axis=0)\nflat = x.reshape(6)\n" },
];

function Page({ title, path, description, help, children }: { title: string; path: string; description: string; help: HelpId; children: React.ReactNode }) {
  return (
    <Container wide>
      <Seo title={title} description={description} path={path} jsonLd={[crumb(title, path)]} />
      <PageHeader eyebrow="Visual Learning" title={title} intro={description} />
      <VisualHelp id={help} className="mb-4" />
      {children}
    </Container>
  );
}

export const PythonVisualPage = () => (
  <Page title="Python Code Time Machine" path="/visual/python" help="python" description="Run your Python and step through every line: variables, call stack, objects, recursion, generators and exceptions, recorded from a real run.">
    <CodeLab presets={PY_PRESETS} mode="variables" intro="Edit the code or pick an example, then press Explain visually. The trace is recorded from a real run in your browser; the memory view is a simplified teaching model." />
  </Page>
);
export const DataVisualPage = () => (
  <Page title="Pandas and NumPy Visual Studio" path="/visual/data" help="data" description="Watch DataFrames and arrays change step by step, with before and after tables, changed cells, shapes, dtypes and missing values.">
    <CodeLab presets={DATA_PRESETS} mode="data" intro="Each step shows the real table or array your code produced. Changed cells are highlighted, with shape and dtype changes explained." />
  </Page>
);
export const ApiVisualPage = () => (
  <Page title="API Request and Response Studio" path="/visual/api" help="api" description="Follow a request from URL and headers to response, status, JSON parsing, pagination, retries and backoff on a safe mock server.">
    <div className="pb-16"><ApiStudio /></div>
  </Page>
);
export const EtlVisualPage = () => (
  <Page title="ETL Pipeline Playback" path="/visual/etl" help="etl" description="Play a pipeline from source to target, then break it on purpose: watermarks, deduplication, quarantine, retries, dead letters, SCD2 and CDC.">
    <div className="pb-16"><EtlPlayback /></div>
  </Page>
);
export const ChartsVisualPage = () => (
  <Page title="Data Visualization Explorer" path="/visual/charts" help="charts" description="Change dimensions, measures, aggregations and filters and watch the chart change, with advice on when a chart fits and when it misleads.">
    <div className="pb-16"><ChartExplorer /></div>
  </Page>
);

/** The lesson links a tool with ?preset=<id> to start on the example that matches it. */
const usePreset = () => useSearchParams()[0].get("preset") ?? undefined;
function PresetPage({ title, path, help, description, children }: { title: string; path: string; help: HelpId; description: string; children: (preset?: string) => React.ReactNode }) {
  const preset = usePreset();
  return <Page title={title} path={path} help={help} description={description}><div className="pb-16">{children(preset)}</div></Page>;
}
export const TreeVisualPage = () => <PresetPage title="Tree Explorer" path="/visual/tree" help="tree" description="Build binary and binary search trees, then watch insertion, search, deletion and traversals step by step.">{(p) => <TreeExplorer preset={p} />}</PresetPage>;
export const GraphVisualPage = () => <PresetPage title="Graph Explorer" path="/visual/graph" help="graph" description="Run BFS, DFS, shortest paths, cycle detection and connected components, with the queue or stack and visited set on screen.">{(p) => <GraphExplorer preset={p} />}</PresetPage>;
export const ExcelVisualPage = () => <PresetPage title="Excel Lab" path="/visual/excel" help="excel" description="An interactive spreadsheet: evaluate formulas, try lookups, build a pivot, apply conditional formatting and clean data.">{(p) => <ExcelLab preset={p} />}</PresetPage>;
export const LinuxVisualPage = () => <PresetPage title="Linux Terminal Lab" path="/visual/linux" help="linux" description="A simulated terminal over safe sample files: navigate, move files, use pipes and redirection, change permissions, inspect processes.">{(p) => <LinuxLab preset={p} />}</PresetPage>;
export const GitVisualPage = () => <PresetPage title="Git Lab" path="/visual/git" help="git" description="See commits, branches, merges and rebases as a graph, the staging area and working tree, and resolve a conflict.">{(p) => <GitLab preset={p} />}</PresetPage>;
export const StatsVisualPage = () => <PresetPage title="Statistics Lab" path="/visual/stats" help="stats" description="Move data and watch the mean, median, spread, probability, sampling, confidence intervals, tests and regression respond.">{(p) => <StatsLab preset={p} />}</PresetPage>;
export const BusinessVisualPage = () => <PresetPage title="Business Analytics Lab" path="/visual/business" help="business" description="KPI dashboards, revenue and profit, cohorts, funnels and decision simulations on a sample business.">{(p) => <BusinessLab preset={p} />}</PresetPage>;
export const InterviewVisualPage = () => <PresetPage title="Interview Walkthrough" path="/visual/interview" help="interview" description="Walk through interview questions with progressive hints, example answers and follow-up questions.">{(p) => <InterviewLab preset={p} />}</PresetPage>;
