import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Container } from "../components/ui";
import { Seo } from "../lib/seo";
import { useAuth } from "../lib/auth";
import { USERNAME_RE } from "../lib/account";
import { setPublicProfile } from "../lib/community";

function PublicToggle() {
  const { session, profile } = useAuth();
  const [on, setOn] = useState(Boolean(profile?.public_profile));
  const [err, setErr] = useState<string | null>(null);
  if (!session || profile?.public_profile === undefined) return null;
  return (
    <div className="mt-6 border-t border-surface-border pt-4 text-sm">
      <label className="flex items-center gap-2 text-ink">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            const next = e.target.checked;
            setOn(next);
            setPublicProfile(session.user.id, next).catch((ex: Error) => { setOn(!next); setErr(ex.message); });
          }}
        />
        Public profile (appear on the leaderboard)
      </label>
      {on && <Link className="mt-1 block text-accent underline" to={`/profile?u=${encodeURIComponent(profile.username)}`}>View my public profile</Link>}
      {err && <p role="alert" className="text-danger">{err}</p>}
    </div>
  );
}

const input =
  "mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";
const primary = "w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60";

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Container className="flex justify-center py-12">
      <div className="w-full max-w-sm rounded-card border border-surface-border bg-surface-raised p-6 shadow-panel">
        <h1 className="font-display text-2xl font-bold text-ink">{title}</h1>
        {children}
      </div>
    </Container>
  );
}

function Disabled() {
  return (
    <p className="mt-4 text-sm text-ink-muted">
      Accounts are not enabled on this deployment. Your progress is still saved in this browser on the{" "}
      <Link className="text-accent underline" to="/progress">progress page</Link>.
    </p>
  );
}

function GoogleButton() {
  const { signInWithGoogle } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => signInWithGoogle().catch((e: Error) => setErr(e.message))}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-surface-border bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-hover/5"
      >
        <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden>
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.1 5.5c4.2-3.9 7.2-9.6 7.2-17z" />
          <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.6 10.7l7.9-6.1z" />
          <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.4-4.6 2.3-8.8 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
        </svg>
        Continue with Google
      </button>
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
      <p className="my-4 text-center text-xs uppercase tracking-wider text-ink-faint">or</p>
    </>
  );
}

/** After sign-in: forced password change first, otherwise progress. */
function useRedirectWhenSignedIn() {
  const { session, profile } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (session && profile) navigate(profile.must_change_password ? "/account" : "/progress", { replace: true });
  }, [session, profile, navigate]);
}

export function LoginPage() {
  const { enabled, signIn } = useAuth();
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
    <Card title="Sign in">
      <Seo title="Sign in" description="Sign in to sync your SQL practice progress." path="/login" noindex />
      {!enabled ? <Disabled /> : (
        <>
          <GoogleButton />
          <form onSubmit={submit} className="space-y-3">
            <label className="block text-sm font-medium text-ink">
              Username or email
              <input className={input} value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required />
            </label>
            <label className="block text-sm font-medium text-ink">
              Password
              <input className={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </label>
            {err && <p role="alert" className="text-sm text-danger">{err}</p>}
            <button className={primary} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          </form>
          <p className="mt-4 text-sm text-ink-muted">
            New here? <Link className="text-accent underline" to="/signup">Create an account</Link>
          </p>
        </>
      )}
    </Card>
  );
}

export function SignupPage() {
  const { enabled, signUp } = useAuth();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useRedirectWhenSignedIn();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!USERNAME_RE.test(username)) {
      setMsg({ ok: false, text: "Username: 3–32 letters, digits, dot, dash or underscore." });
      return;
    }
    if (password.length < 8) {
      setMsg({ ok: false, text: "Password must be at least 8 characters." });
      return;
    }
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
    <Card title="Create account">
      <Seo title="Create account" description="Create a free account to sync SQL practice progress." path="/signup" noindex />
      {!enabled ? <Disabled /> : (
        <>
          <GoogleButton />
          <form onSubmit={submit} className="space-y-3">
            <label className="block text-sm font-medium text-ink">
              Username
              <input className={input} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
            </label>
            <label className="block text-sm font-medium text-ink">
              Email <span className="font-normal text-ink-faint">(optional, for password reset)</span>
              <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
            <label className="block text-sm font-medium text-ink">
              Password
              <input className={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
            </label>
            {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-accent" : "text-danger"}`}>{msg.text}</p>}
            <button className={primary} disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
          </form>
          <p className="mt-4 text-sm text-ink-muted">
            Have an account? <Link className="text-accent underline" to="/login">Sign in</Link>
          </p>
        </>
      )}
    </Card>
  );
}

export function AccountPage() {
  const { enabled, ready, session, profile, changePassword, signOut } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (enabled && ready && !session) navigate("/login", { replace: true });
  }, [enabled, ready, session, navigate]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setMsg({ ok: false, text: "Use at least 8 characters." });
    if (password !== confirm) return setMsg({ ok: false, text: "Passwords do not match." });
    try {
      await changePassword(password);
      setPassword("");
      setConfirm("");
      setMsg({ ok: true, text: "Password updated." });
    } catch (ex) {
      setMsg({ ok: false, text: (ex as Error).message });
    }
  }

  return (
    <Card title="Account">
      <Seo title="Account" description="Manage your SQL Practice Lab account." path="/account" noindex />
      {!enabled ? <Disabled /> : !profile ? <p className="mt-4 text-sm text-ink-muted">Loading…</p> : (
        <>
          <p className="mt-2 text-sm text-ink-muted">
            Signed in as <strong className="text-ink">{profile.username}</strong>
            {profile.role === "admin" && <span className="ml-2 rounded bg-accent-dim px-1.5 py-0.5 text-xs text-accent">admin</span>}
          </p>
          {profile.must_change_password && (
            <p role="alert" className="mt-4 rounded-lg border border-accent/30 bg-accent-dim px-3 py-2 text-sm text-ink">
              Please set a new password before continuing.
            </p>
          )}
          <form onSubmit={submit} className="mt-4 space-y-3">
            <label className="block text-sm font-medium text-ink">
              New password
              <input className={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </label>
            <label className="block text-sm font-medium text-ink">
              Confirm password
              <input className={input} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </label>
            {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-accent" : "text-danger"}`}>{msg.text}</p>}
            <button className={primary}>Change password</button>
          </form>
          <PublicToggle />
          <button type="button" onClick={() => signOut().then(() => navigate("/"))} className="mt-6 text-sm text-ink-muted underline hover:text-ink">
            Sign out
          </button>
        </>
      )}
    </Card>
  );
}
