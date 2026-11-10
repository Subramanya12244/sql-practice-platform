import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, FileCode2, FolderGit2, Github, Loader2, Lock, Unlock } from "lucide-react";
import { usePage } from "../SiteApp";
import { Button, Card, Container, EmptyState, PageHeader } from "../components/ui";
import { Seo } from "../lib/seo";
import { useProgress } from "../lib/progress";
import { useAuth } from "../lib/auth";
import { accountsEnabled, getSupabase } from "../lib/supabase";
import { getExecs } from "../lib/vizHistory";
import { minePython } from "../lib/notes/generate";
import { getProjectProgress, loadAllProjects, projectStatus, type Project } from "../lib/projects";
import { PY_CATEGORIES } from "../lib/pyPractice";
import { GITHUB_ACCESS_TEXT, buildExport, githubScope, pushToGitHub, scopeAllows, zipFiles, type ExportSelection, type GithubAccess } from "../lib/portfolioExport";
import { downloadText } from "../lib/workspace";

const INPUT = "max-w-full rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm text-ink";
const cat = (slug: string) => PY_CATEGORIES.find((c) => c.slug === slug)?.short ?? slug;

/** Export selected solutions and project write-ups as a ZIP or to a GitHub repository (private by default). */
export function PortfolioExportPage() {
  const { data } = usePage();
  const progress = useProgress();
  const { profile, session } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("Data engineering portfolio");
  const [author, setAuthor] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [gh, setGh] = useState<{ token: string | null; checked: boolean }>({ token: null, checked: false });
  const [repo, setRepo] = useState("dataforge-portfolio");
  const [isPrivate, setIsPrivate] = useState(false);
  // What the learner agrees to share before connecting; asking for the smallest permission that works.
  const [access, setAccess] = useState<GithubAccess>("public");
  const [grantedAccess] = useState<GithubAccess | null>(() => { try { return (sessionStorage.getItem("sqlp.gh.access") as GithubAccess | null) ?? null; } catch { return null; } });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; url?: string } | null>(null);

  useEffect(() => { setMounted(true); void loadAllProjects().then(setProjects); }, []);
  useEffect(() => { if (profile?.username && !author) setAuthor(profile.username); }, [profile?.username]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!accountsEnabled || !session) return setGh({ token: null, checked: true });
    // GitHub's token exists only in this session, right after connecting; it is never stored by DataForge.
    void getSupabase().then((sb) => sb.auth.getSession()).then(({ data: s }) => setGh({ token: s.session?.provider_token ?? null, checked: true }));
  }, [session]);

  const sqlItems = useMemo(() => (mounted ? data.index.flatMap((q) => {
    const p = progress.questions[q.number];
    if (!p?.solvedAt) return [];
    const sql = getExecs(`q${q.number}`).find((e) => e.kind === "submit" && e.correct)?.sql ?? p.lastSql;
    return sql?.trim() ? [{ number: q.number, slug: q.slug, title: q.title, topic: q.topicLabel, difficulty: q.difficulty, objective: q.problemShort ?? q.takeaway ?? "", sql }] : [];
  }) : []), [mounted, data.index, progress.questions]);
  const pyItems = useMemo(() => (mounted ? (data.exercises ?? []).flatMap((e) => {
    if (!progress.lessons?.[`py:${e.slug}`]) return [];
    const source = minePython(e.slug);
    return source ? [{ code: e.code, slug: e.slug, title: e.title, category: cat(e.category), difficulty: e.difficulty, source }] : [];
  }) : []), [mounted, data.exercises, progress.lessons]);
  const projItems = useMemo(() => projects.flatMap((p) => {
    const pp = getProjectProgress(p.slug);
    const status = projectStatus(p, pp);
    return status === "Not started" ? [] : [{ project: p, status, tasksPassed: Object.entries(pp.tasks).filter(([, t]) => t.passed).map(([id]) => id), repoUrl: pp.submission?.url }];
  }), [projects]);

  const toggle = (k: string) => setPick((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const selection: ExportSelection = {
    title, author: author.trim() || "a DataForge learner",
    sql: sqlItems.filter((q) => pick.has(`sql:${q.number}`)),
    python: pyItems.filter((p) => pick.has(`py:${p.slug}`)),
    projects: projItems.filter((e) => pick.has(`project:${e.project.slug}`)),
  };
  const files = buildExport(selection);
  const count = selection.sql.length + selection.python.length + selection.projects.length;

  async function connect() {
    const sb = await getSupabase();
    const { error } = await sb.auth.linkIdentity({ provider: "github", options: { scopes: githubScope(access), redirectTo: `${location.origin}/portfolio/export` } });
    try { sessionStorage.setItem("sqlp.gh.access", access); } catch { /* the note below just will not know */ }
    if (error) setMsg({ ok: false, text: /manual linking|provider is not enabled|Unsupported provider/i.test(error.message) ? "GitHub isn't set up on this deployment yet (an admin must enable the GitHub provider and manual identity linking in Supabase)." : error.message });
  }
  async function push() {
    if (!gh.token) return;
    if (!confirm(`Create the ${isPrivate ? "PRIVATE" : "PUBLIC"} repository "${repo}" on your GitHub account with ${Object.keys(files).length} files?`)) return;
    setBusy("Creating the repository…"); setMsg(null);
    try {
      const r = await pushToGitHub(gh.token, { repo, private: isPrivate, description: title, files, message: "Add DataForge portfolio" });
      setMsg({ ok: true, text: `Created ${isPrivate ? "private" : "public"} repository.`, url: r.url });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(null);
  }

  const group = (label: string, items: { key: string; text: string; sub: string }[]) => (
    <Card pad="sm" as="section" aria-label={label} className="min-w-0">
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-ink">{label} ({items.length})</h2>
        {items.length > 0 && <button type="button" className="text-xs text-accent hover:underline" onClick={() => setPick((s) => { const n = new Set(s); const all = items.every((i) => n.has(i.key)); items.forEach((i) => (all ? n.delete(i.key) : n.add(i.key))); return n; })}>Select all</button>}</div>
      {items.length ? (
        <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm">{items.map((i) => <li key={i.key}><label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={pick.has(i.key)} onChange={() => toggle(i.key)} /><span className="min-w-0"><span className="block truncate text-ink">{i.text}</span><span className="text-xs text-ink-faint">{i.sub}</span></span></label></li>)}</ul>
      ) : <p className="mt-2 text-xs text-ink-muted">Nothing completed yet.</p>}
    </Card>
  );

  return (
    <Container wide className="pt-6">
      <Seo title="Export your portfolio" description="Export your solved SQL, Python solutions and project write-ups as a ZIP or to a private GitHub repository." path="/portfolio/export" noindex />
      <PageHeader eyebrow="Portfolio" title="Export your work" intro="Choose what to include, preview the files, then download a ZIP or create a repository on your GitHub account. Nothing is published unless you do it, and repositories are private by default." />
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mb-4 rounded-lg border px-3 py-2 text-sm ${msg.ok ? "border-success/30 bg-success-dim text-ink" : "border-danger/30 bg-danger-dim text-danger"}`}>{msg.text} {msg.url && <a href={msg.url} target="_blank" rel="noreferrer" className="text-accent underline">{msg.url}</a>}</p>}
      {mounted && !sqlItems.length && !pyItems.length && !projItems.length ? (
        <EmptyState icon={FolderGit2} title="Nothing to export yet">Solve some <Link to="/questions" className="text-accent hover:underline">SQL questions</Link> or <Link to="/practice/python" className="text-accent hover:underline">Python problems</Link>, or start a <Link to="/projects-lab" className="text-accent hover:underline">project</Link>.</EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            {group("SQL solutions", sqlItems.map((q) => ({ key: `sql:${q.number}`, text: `Q${q.number} ${q.title}`, sub: `${q.topic} · ${q.difficulty}` })))}
            {group("Python solutions", pyItems.map((p) => ({ key: `py:${p.slug}`, text: `${p.code} ${p.title}`, sub: `${p.category} · ${p.difficulty} · your last passing code` })))}
            {group("Projects", projItems.map((e) => ({ key: `project:${e.project.slug}`, text: e.project.title, sub: `${e.status} · README with architecture and design decisions` })))}
          </div>
          <div className="min-w-0 space-y-4">
            <Card pad="md" as="section" aria-label="Export">
              <label className="block text-sm text-ink-muted">Title<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} className={`${INPUT} mt-1 w-full`} /></label>
              <label className="mt-2 block text-sm text-ink-muted">Your name in the README<input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={80} className={`${INPUT} mt-1 w-full`} /></label>
              <p className="mt-3 text-xs text-ink-muted">{count} item{count === 1 ? "" : "s"} selected · {Object.keys(files).length} files</p>
              <ul className="mt-1 max-h-40 overflow-y-auto font-mono text-[11px] text-ink-muted">{Object.keys(files).map((f) => <li key={f}><button type="button" className="hover:text-accent" onClick={() => setPreview(f)}><FileCode2 className="mr-1 inline h-3 w-3" aria-hidden />{f}</button></li>)}</ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button disabled={!count || !!busy} onClick={async () => { const blob = await zipFiles(files, repo || "dataforge-portfolio"); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${repo || "dataforge-portfolio"}.zip`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }}><Download className="h-4 w-4" aria-hidden /> Download ZIP</Button>
                <Button variant="ghost" disabled={!count} onClick={() => downloadText("README.md", files["README.md"], "text/markdown")}>README only</Button>
              </div>
            </Card>
            <Card pad="md" as="section" aria-label="GitHub">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><Github className="h-4 w-4" aria-hidden /> GitHub</h2>
              {!accountsEnabled || !session ? <p className="mt-1 text-sm text-ink-muted"><Link to="/login?next=/portfolio/export" className="text-accent hover:underline">Sign in</Link> to connect GitHub. The ZIP works without an account.</p>
                : !gh.checked ? <p className="mt-1 text-sm text-ink-muted">Checking…</p>
                  : !gh.token ? (
                    <>
                      <p className="mt-1 text-sm text-ink-muted">Connect your GitHub account to create a repository from this export. DataForge never stores your GitHub token: it is used from this browser session only, and only when you press Create.</p>
                      <fieldset className="mt-2 space-y-1.5">
                        <legend className="text-sm font-medium text-ink">What should DataForge be allowed to do?</legend>
                        {(["public", "private"] as GithubAccess[]).map((a) => (
                          <label key={a} className="flex items-start gap-2 rounded-lg border border-surface-border p-2 text-sm">
                            <input type="radio" name="gh-access" className="mt-1" checked={access === a} onChange={() => { setAccess(a); setIsPrivate(a === "private"); }} />
                            <span><span className="font-medium text-ink">{GITHUB_ACCESS_TEXT[a].title}</span><span className="block text-xs text-ink-muted">{GITHUB_ACCESS_TEXT[a].detail}</span></span>
                          </label>
                        ))}
                      </fieldset>
                      <Button className="mt-2" variant="secondary" onClick={() => void connect()}><Github className="h-4 w-4" aria-hidden /> Connect GitHub</Button>
                    </>
                  ) : (
                    <>
                      <label className="mt-2 block text-sm text-ink-muted">Repository name<input value={repo} onChange={(e) => setRepo(e.target.value)} maxLength={100} className={`${INPUT} mt-1 w-full font-mono`} /></label>
                      <label className="mt-2 flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />{isPrivate ? <Lock className="h-3.5 w-3.5" aria-hidden /> : <Unlock className="h-3.5 w-3.5 text-warn" aria-hidden />} Private repository</label>
                      {!isPrivate && <p className="text-xs text-warn">A public repository is visible to everyone.</p>}
                      {!scopeAllows(grantedAccess, isPrivate) && grantedAccess !== null && <p role="alert" className="text-xs text-danger">You connected with public-only access, which cannot create a private repository. Disconnect GitHub in your account settings and connect again with private access, or choose a public repository.</p>}
                      <Button className="mt-3" disabled={!count || !!busy || !scopeAllows(grantedAccess ?? "private", isPrivate)} onClick={() => void push()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FolderGit2 className="h-4 w-4" aria-hidden />} Create repository</Button>
                      {busy && <p className="mt-1 text-xs text-ink-muted">{busy}</p>}
                    </>
                  )}
            </Card>
            {preview && files[preview] && (
              <Card pad="sm" as="section" aria-label="Preview" className="min-w-0">
                <div className="flex justify-between text-xs"><span className="font-mono text-ink">{preview}</span><button type="button" className="text-ink-muted hover:text-ink" onClick={() => setPreview(null)}>Close</button></div>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-surface-overlay p-2 font-mono text-[11px] text-ink">{files[preview]}</pre>
              </Card>
            )}
          </div>
        </div>
      )}
    </Container>
  );
}
