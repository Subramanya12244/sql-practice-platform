import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Cloud, Eye, EyeOff, KeyRound, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { Container } from "../components/ui";
import { BrandMark } from "../../components/BrandMark";
import { BRAND } from "../../brand";
import { Seo } from "../lib/seo";
import { useAuth } from "../lib/auth";
import { USERNAME_RE } from "../lib/account";
import { setPublicProfile } from "../lib/community";
import { useProgress } from "../lib/progress";
import { markReviewsSeen, reviewsSeenAt, useMyReviews } from "../lib/reviews";
import { ClipboardCheck } from "lucide-react";

const input =
  "mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 aria-[invalid=true]:border-danger";
const primary = "w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60";
const card = "rounded-card border border-surface-border bg-surface-raised p-5 shadow-panel";

/** Rough strength from length and character variety: 0 (too short) … 4 (strong). */
export function passwordStrength(pw: string): { score: number; label: string } {
  if (pw.length < 8) return { score: 0, label: pw ? "Too short" : "" };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  const score = Math.min(4, (pw.length >= 12 ? 2 : 1) + (kinds >= 3 ? 2 : kinds >= 2 ? 1 : 0));
  return { score, label: ["Too short", "Weak", "Fair", "Good", "Strong"][score] };
}

/** Only same-site paths are allowed as a post-login destination. */
export function safeNext(search: string): string | null {
  const n = new URLSearchParams(search).get("next");
  return n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/login") && !n.startsWith("/signup") ? n : null;
}

function Alert({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <p role={ok ? "status" : "alert"} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${ok ? "border-success/30 bg-success-dim text-ink" : "border-danger/30 bg-danger-dim text-danger"}`}>
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
      <span>{children}</span>
    </p>
  );
}

function PasswordField({ label, value, onChange, autoComplete, hint, invalid }: {
  label: string; value: string; onChange: (v: string) => void; autoComplete: string; hint?: ReactNode; invalid?: boolean;
}) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  return (
    <label className="block text-sm font-medium text-ink">
      {label}
      <span className="relative block">
        <input
          className={`${input} pr-10`} type={show ? "text" : "password"} value={value} autoComplete={autoComplete} required aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
          onKeyUp={(e) => setCaps(e.getModifierState?.("CapsLock") ?? false)}
        />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 mt-1 flex w-10 items-center justify-center text-ink-faint hover:text-ink">
          {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </span>
      {caps && <span className="mt-1 block text-xs font-normal text-warn">Caps Lock is on.</span>}
      {hint}
    </label>
  );
}

function StrengthMeter({ pw }: { pw: string }) {
  const s = passwordStrength(pw);
  if (!pw) return <span className="mt-1 block text-xs font-normal text-ink-faint">At least 8 characters. Longer is better.</span>;
  const tone = ["bg-danger", "bg-danger", "bg-warn", "bg-success", "bg-success"][s.score];
  return (
    <span className="mt-1.5 flex items-center gap-2" aria-live="polite">
      <span className="flex flex-1 gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => <span key={i} className={`h-1 flex-1 rounded-full ${i <= s.score ? tone : "bg-surface-soft"}`} />)}
      </span>
      <span className="w-16 text-right text-xs font-normal text-ink-muted">{s.label}</span>
    </span>
  );
}

const PERKS = [
  { icon: Cloud, text: "Progress, projects and reviews sync across your devices." },
  { icon: ShieldCheck, text: "Your data is private to you. Only you and admins can read it." },
  { icon: UserRound, text: "Optional public profile for the leaderboard." },
];

/** Two-column auth layout: brand panel (desktop) beside the form. */
function AuthShell({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <Container className="py-10 sm:py-14">
      <div className="mx-auto grid max-w-4xl overflow-hidden rounded-card border border-surface-border bg-surface-raised shadow-panel md:grid-cols-2">
        <aside className="hidden flex-col justify-between bg-[radial-gradient(80%_80%_at_0%_0%,rgb(var(--color-accent)/0.18),transparent)] p-8 md:flex">
          <div>
            <div className="flex items-center gap-2"><BrandMark size={32} /><span className="font-display text-xl font-bold text-ink">{BRAND.name}</span></div>
            <p className="mt-2 text-sm text-ink-muted">{BRAND.tagline}</p>
          </div>
          <ul className="mt-8 space-y-4">
            {PERKS.map((p) => (
              <li key={p.text} className="flex items-start gap-3 text-sm text-ink"><p.icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />{p.text}</li>
            ))}
          </ul>
          <p className="mt-8 text-xs text-ink-faint">No account needed to practise. Without one, progress stays in this browser.</p>
        </aside>
        <div className="p-6 sm:p-8">
          <div className="mb-4 flex items-center gap-2 md:hidden"><BrandMark size={24} /><span className="font-display font-bold text-ink">{BRAND.name}</span></div>
          <h1 className="font-display text-2xl font-bold text-ink">{title}</h1>
          <p className="mt-1 text-sm text-ink-muted">{intro}</p>
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </Container>
  );
}

function Disabled() {
  return (
    <p className="text-sm text-ink-muted">
      Accounts are not enabled on this deployment. Your progress is still saved in this browser on the{" "}
      <Link className="text-accent underline" to="/progress">progress page</Link>.
    </p>
  );
}

/** After sign-in: forced password change first, then the page the visitor came from, else progress. */
function useRedirectWhenSignedIn() {
  const { session, profile } = useAuth();
  const navigate = useNavigate();
  const { search } = useLocation();
  // The old page stays mounted while the next one loads, so redirect only once.
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !session || !profile) return;
    done.current = true;
    navigate(profile.must_change_password ? "/account" : safeNext(search) ?? "/progress", { replace: true });
  }, [session, profile, navigate, search]);
}

export function LoginPage() {
  const { enabled, signIn } = useAuth();
  const { search } = useLocation();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useRedirectWhenSignedIn();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await signIn(login, password);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Welcome back" intro="Sign in to pick up where you left off.">
      <Seo title="Sign in" description="Sign in to DataForge to sync your progress." path="/login" noindex />
      {!enabled ? <Disabled /> : (
        <>
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm font-medium text-ink">
              Username or email
              <input className={input} value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoFocus required />
            </label>
            <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" invalid={Boolean(err)} />
            <div className="flex justify-end text-sm"><Link to="/reset-password" className="text-accent hover:underline">Forgot password?</Link></div>
            {err && <Alert ok={false}>{err}</Alert>}
            <button className={primary} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          </form>
          <p className="mt-6 text-center text-sm text-ink-muted">
            New to {BRAND.name}? <Link className="font-semibold text-accent hover:underline" to={`/signup${search}`}>Create a free account</Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}

export function SignupPage() {
  const { enabled, signUp } = useAuth();
  const { search } = useLocation();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useRedirectWhenSignedIn();
  const nameBad = username.length > 0 && !USERNAME_RE.test(username);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!USERNAME_RE.test(username)) return setMsg({ ok: false, text: "Username: 3–32 letters, digits, dot, dash or underscore." });
    if (password.length < 8) return setMsg({ ok: false, text: "Password must be at least 8 characters." });
    if (password !== confirm) return setMsg({ ok: false, text: "Passwords do not match." });
    setBusy(true);
    setMsg(null);
    try {
      const { needsConfirm } = await signUp(username, password, email || undefined);
      if (needsConfirm) setMsg({ ok: true, text: "Check your inbox to confirm your email, then sign in." });
    } catch (ex) {
      setMsg({ ok: false, text: (ex as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Create your account" intro="Free. Keep your progress safe and in sync on every device.">
      <Seo title="Create account" description="Create a free DataForge account to sync your progress." path="/signup" noindex />
      {!enabled ? <Disabled /> : (
        <>
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm font-medium text-ink">
              Username
              <input className={input} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required aria-invalid={nameBad || undefined} />
              <span className={`mt-1 block text-xs font-normal ${nameBad ? "text-danger" : "text-ink-faint"}`}>3–32 characters: letters, digits, dot, dash or underscore. Shown on the leaderboard if you opt in.</span>
            </label>
            <label className="block text-sm font-medium text-ink">
              Email <span className="font-normal text-ink-faint">(optional)</span>
              <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              <span className="mt-1 block text-xs font-normal text-ink-faint">Needed only to reset a forgotten password. Never shown to others.</span>
            </label>
            <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="new-password" hint={<StrengthMeter pw={password} />} />
            <PasswordField label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={mismatch}
              hint={mismatch ? <span className="mt-1 block text-xs font-normal text-danger">Passwords do not match.</span> : undefined} />
            {msg && <Alert ok={msg.ok}>{msg.text}</Alert>}
            <button className={primary} disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
          </form>
          <p className="mt-6 text-center text-sm text-ink-muted">
            Already have an account? <Link className="font-semibold text-accent hover:underline" to={`/login${search}`}>Sign in</Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { enabled, resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await resetPassword(email);
      // Same message whether or not the address exists, so the form can't be used to probe accounts.
      setMsg({ ok: true, text: "If an account uses that email, a reset link is on its way. Open it on this device." });
    } catch (ex) {
      setMsg({ ok: false, text: (ex as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Reset your password" intro="Enter the email you added to your account and we'll send a link to set a new password.">
      <Seo title="Reset password" description="Reset your DataForge password." path="/reset-password" noindex />
      {!enabled ? <Disabled /> : (
        <>
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm font-medium text-ink">
              Email
              <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />
            </label>
            {msg && <Alert ok={msg.ok}>{msg.text}</Alert>}
            <button className={primary} disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
          </form>
          <p className="mt-4 text-sm text-ink-muted">Signed up with only a username? Email resets aren't possible for those accounts; ask an admin to help.</p>
          <p className="mt-6 text-center text-sm"><Link className="text-accent hover:underline" to="/login">Back to sign in</Link></p>
        </>
      )}
    </AuthShell>
  );
}

const REVIEW_TONE: Record<string, string> = { Completed: "text-success", "Changes requested": "text-warn", Rejected: "text-danger" };

/** Admin decisions on this learner's project submissions; viewing them clears the header badge. */
function MyReviews({ userId }: { userId: string }) {
  const { rows } = useMyReviews(userId);
  // What was "seen" before this visit, captured once the reviews arrive; then mark them all seen.
  const [baseline, setBaseline] = useState<string | null>(null);
  useEffect(() => {
    if (!rows.length || baseline !== null) return;
    setBaseline(reviewsSeenAt());
    markReviewsSeen(rows[0].reviewed_at);
  }, [rows, baseline]);
  return (
    <section className={card} aria-labelledby="acc-reviews">
      <h2 id="acc-reviews" className="flex items-center gap-2 font-display text-lg font-bold text-ink"><ClipboardCheck className="h-4 w-4 text-accent" aria-hidden /> Project reviews</h2>
      {rows.length ? (
        <ul className="mt-3 divide-y divide-surface-border text-sm">
          {rows.map((r) => (
            <li key={r.id} className="py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link to={`/projects-lab/${r.project_slug}`} className="font-semibold text-ink hover:underline">{r.project_slug}</Link>
                <span className={`text-xs font-semibold ${REVIEW_TONE[r.status] ?? "text-ink-muted"}`}>
                  {r.status}{baseline !== null && r.reviewed_at > baseline && <span className="ml-1 rounded bg-accent px-1 text-[10px] text-white">new</span>}
                </span>
              </div>
              {r.review_comment && <p className="mt-1 text-ink-muted">"{r.review_comment}"</p>}
              <p className="text-xs text-ink-faint">{new Date(r.reviewed_at).toLocaleString()}</p>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-ink-muted">No reviews yet. Submit a project from the <Link to="/projects-lab" className="text-accent underline">Projects Lab</Link> and an admin will review it.</p>}
    </section>
  );
}

function PublicToggle() {
  const { session, profile, refreshProfile } = useAuth();
  const [on, setOn] = useState(Boolean(profile?.public_profile));
  const [err, setErr] = useState<string | null>(null);
  if (!session || profile?.public_profile === undefined) return null;
  return (
    <div className="text-sm">
      <label className="flex items-center gap-2 text-ink">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            const next = e.target.checked;
            setOn(next);
            setPublicProfile(session.user.id, next).then(refreshProfile).catch((ex: Error) => { setOn(!next); setErr(ex.message); });
          }}
        />
        Public profile (appear on the leaderboard)
      </label>
      <p className="mt-1 text-xs text-ink-faint">Shows your username, solved count and active days. Never your email.</p>
      {on && <Link className="mt-1 block text-accent underline" to={`/profile?u=${encodeURIComponent(profile.username)}`}>View my public profile</Link>}
      {err && <p role="alert" className="text-danger">{err}</p>}
    </div>
  );
}

export function AccountPage() {
  const { enabled, ready, session, profile, changePassword, signOut } = useAuth();
  const progress = useProgress();
  const navigate = useNavigate();
  const { search } = useLocation();
  const fromReset = new URLSearchParams(search).has("reset");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const signingOut = useRef(false);
  useEffect(() => {
    if (enabled && ready && !session && !signingOut.current) navigate("/login?next=/account", { replace: true });
  }, [enabled, ready, session, navigate]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setMsg({ ok: false, text: "Use at least 8 characters." });
    if (password !== confirm) return setMsg({ ok: false, text: "Passwords do not match." });
    setBusy(true);
    try {
      await changePassword(password);
      setPassword("");
      setConfirm("");
      setMsg({ ok: true, text: "Password updated." });
    } catch (ex) {
      setMsg({ ok: false, text: (ex as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const solved = Object.values(progress.questions).filter((q) => q.solvedAt).length;
  const syntheticEmail = session?.user.email?.endsWith("@users.sqlpractice.local");

  return (
    <Container className="py-10">
      <Seo title="Account" description="Manage your DataForge account." path="/account" noindex />
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-3xl font-bold text-ink">Account</h1>
        {!enabled ? <div className="mt-4"><Disabled /></div> : !profile ? <p className="mt-4 text-sm text-ink-muted">Loading…</p> : (
          <div className="mt-6 space-y-5">
            {(profile.must_change_password || fromReset) && (
              <Alert ok={false}>{fromReset ? "Set a new password for your account below." : "Please set a new password before continuing."}</Alert>
            )}

            <section className={card} aria-labelledby="acc-profile">
              <div className="flex flex-wrap items-center gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-dim font-display text-lg font-bold text-accent" aria-hidden>{profile.username.slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <h2 id="acc-profile" className="truncate font-display text-lg font-bold text-ink">
                    {profile.username}
                    {profile.role === "admin" && <span className="ml-2 rounded bg-accent-dim px-1.5 py-0.5 align-middle text-xs text-accent">admin</span>}
                  </h2>
                  <p className="text-sm text-ink-muted">
                    {syntheticEmail ? "Username account (no email)" : session?.user.email}
                    {profile.created_at && ` · joined ${new Date(profile.created_at).toLocaleDateString()}`}
                  </p>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-surface p-3"><dt className="text-xs text-ink-faint">Solved</dt><dd className="font-display text-xl font-bold text-ink">{solved}</dd></div>
                <div className="rounded-lg bg-surface p-3"><dt className="text-xs text-ink-faint">Active days</dt><dd className="font-display text-xl font-bold text-ink">{progress.activeDays.length}</dd></div>
                <div className="rounded-lg bg-surface p-3"><dt className="text-xs text-ink-faint">Sync</dt><dd className="mt-1 flex items-center justify-center gap-1 text-sm font-semibold text-success"><Cloud className="h-4 w-4" aria-hidden /> On</dd></div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-3 text-sm">
                <Link to="/progress" className="text-accent hover:underline">Progress</Link>
                <Link to="/portfolio" className="text-accent hover:underline">Portfolio</Link>
                {profile.role === "admin" && <Link to="/admin" className="text-accent hover:underline">Admin dashboard</Link>}
              </div>
            </section>

            {session && <MyReviews userId={session.user.id} />}

            <section className={card} aria-labelledby="acc-password">
              <h2 id="acc-password" className="flex items-center gap-2 font-display text-lg font-bold text-ink"><KeyRound className="h-4 w-4 text-accent" aria-hidden /> Change password</h2>
              <form onSubmit={submit} className="mt-3 space-y-4">
                <PasswordField label="New password" value={password} onChange={setPassword} autoComplete="new-password" hint={<StrengthMeter pw={password} />} />
                <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={confirm.length > 0 && confirm !== password} />
                {msg && <Alert ok={msg.ok}>{msg.text}</Alert>}
                <button className={`${primary} sm:w-auto`} disabled={busy}>{busy ? "Updating…" : "Update password"}</button>
              </form>
            </section>

            <section className={card} aria-labelledby="acc-privacy">
              <h2 id="acc-privacy" className="flex items-center gap-2 font-display text-lg font-bold text-ink"><ShieldCheck className="h-4 w-4 text-accent" aria-hidden /> Privacy</h2>
              <div className="mt-3"><PublicToggle /></div>
            </section>

            <section className={card} aria-labelledby="acc-session">
              <h2 id="acc-session" className="flex items-center gap-2 font-display text-lg font-bold text-ink"><LogOut className="h-4 w-4 text-accent" aria-hidden /> Sign out</h2>
              <p className="mt-1 text-sm text-ink-muted">Signing out removes your synced data from this browser. It stays safe in your account.</p>
              <button type="button" onClick={() => { signingOut.current = true; void signOut().then(() => navigate("/")); }} className="mt-3 rounded-xl border border-surface-border px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-soft">
                Sign out
              </button>
            </section>
          </div>
        )}
      </div>
    </Container>
  );
}
