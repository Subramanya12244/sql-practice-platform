/**
 * API Request and Response Studio engine. A deterministic mock server and a client that talks to it on a virtual clock.
 * No network is ever used and learners cannot enter URLs: every request is built from fixed endpoints and a few options.
 * Frames are what a client would see, in order: request, auth, response, parsing, retries, pagination.
 */
export type Method = "GET" | "POST";

export interface Req { method: Method; url: string; headers: Record<string, string>; query: Record<string, string>; body?: unknown }
export interface Res { status: number; statusText: string; headers: Record<string, string>; body?: unknown; ms: number; timedOut?: boolean }

export type ApiPhase = "request" | "auth" | "response" | "parse" | "retry" | "wait" | "page" | "done" | "error";

export interface ApiFrame {
  phase: ApiPhase;
  title: string;
  detail: string;
  /** Virtual time in ms since the first request. */
  at: number;
  req?: Req;
  res?: Res;
  /** Data parsed so far (pagination collects here). */
  collected?: number;
}

export type ScenarioId = "ok-200" | "created-201" | "bad-400" | "unauth-401" | "forbidden-403" | "notfound-404" | "ratelimit-429" | "server-500" | "timeout" | "page-offset" | "page-cursor";

export interface Options {
  /** What the client sends as credentials. */
  token: "valid" | "missing" | "expired" | "readonly";
  maxRetries: number;
  baseDelayMs: number;
  /** Follow the server's Retry-After instead of the client's own backoff. */
  honorRetryAfter: boolean;
  /** Send an Idempotency-Key on the POST and repeat the POST (as a retry after a lost response would). */
  idempotencyKey: boolean;
  pageSize: number;
  timeoutMs: number;
}

export const DEFAULT_OPTIONS: Options = { token: "valid", maxRetries: 3, baseDelayMs: 200, honorRetryAfter: true, idempotencyKey: true, pageSize: 4, timeoutMs: 1000 };

export const SCENARIOS: { id: ScenarioId; label: string; status: string; teaches: string }[] = [
  { id: "ok-200", label: "200 OK", status: "200", teaches: "A successful read: request, response, JSON parsing." },
  { id: "created-201", label: "201 Created and idempotency", status: "201", teaches: "A POST that creates a record, and why an Idempotency-Key makes a repeated POST safe." },
  { id: "bad-400", label: "400 Bad Request", status: "400", teaches: "The server rejects a malformed body; retrying the same request cannot help." },
  { id: "unauth-401", label: "401 Unauthorized", status: "401", teaches: "Missing or expired credentials: fix the token, do not retry blindly." },
  { id: "forbidden-403", label: "403 Forbidden", status: "403", teaches: "A valid identity that lacks permission: a new token with the right scope is needed." },
  { id: "notfound-404", label: "404 Not Found", status: "404", teaches: "The resource does not exist; treat it as a result, not a transient failure." },
  { id: "ratelimit-429", label: "429 Too Many Requests", status: "429", teaches: "Rate limiting and the Retry-After header." },
  { id: "server-500", label: "500 and exponential backoff", status: "500", teaches: "A flaky server: retry with growing delays, then give up." },
  { id: "timeout", label: "Timeout", status: "—", teaches: "No response before the client's deadline, and what a retry risks." },
  { id: "page-offset", label: "Offset pagination", status: "200", teaches: "Page by page with page and per_page until the last page." },
  { id: "page-cursor", label: "Cursor pagination", status: "200", teaches: "Follow next_cursor; stable when rows are added while paging." },
];

// ── The mock server ──────────────────────────────────────────────────────
const USERS = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: ["Ana", "Ben", "Chen", "Dia", "Eli", "Fay", "Gus", "Hana", "Ivo", "Jun"][i] }));
const EVENTS = Array.from({ length: 9 }, (_, i) => ({ id: `evt_${String(i + 1).padStart(3, "0")}`, type: i % 2 ? "click" : "view" }));

interface ServerState { hits: Record<string, number>; created: Record<string, unknown>; nextOrder: number }
const fresh = (): ServerState => ({ hits: {}, created: {}, nextOrder: 1001 });

const STATUS_TEXT: Record<number, string> = { 200: "OK", 201: "Created", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 429: "Too Many Requests", 500: "Internal Server Error" };
const res = (status: number, body: unknown, ms = 40, headers: Record<string, string> = {}): Res => ({ status, statusText: STATUS_TEXT[status] ?? "", headers: { "content-type": "application/json", ...headers }, body, ms });

function authorize(req: Req, needScope: "read" | "write"): Res | null {
  const h = req.headers.Authorization;
  if (!h) return res(401, { error: "missing_token" }, 15, { "www-authenticate": "Bearer" });
  if (h === "Bearer expired-token") return res(401, { error: "token_expired" }, 15, { "www-authenticate": 'Bearer error="invalid_token"' });
  if (h === "Bearer readonly-token" && needScope === "write") return res(403, { error: "insufficient_scope", needed: "write" }, 15);
  if (h !== "Bearer valid-token" && h !== "Bearer readonly-token") return res(401, { error: "invalid_token" }, 15);
  return null;
}

/** The server decides the response for one request. `n` is how many times this endpoint was hit before (for rate limits and flakiness). */
export function serve(req: Req, st: ServerState): Res {
  const key = `${req.method} ${req.url}`;
  const n = (st.hits[key] = (st.hits[key] ?? 0) + 1) - 1;
  switch (`${req.method} ${req.url}`) {
    case "GET /api/status": return res(200, { status: "ok" });
    case "GET /api/profile": return authorize(req, "read") ?? res(200, { id: 7, name: "Dana", plan: "pro" });
    case "POST /api/orders": {
      const denied = authorize(req, "write");
      if (denied) return denied;
      const b = req.body as { item?: unknown; qty?: unknown } | undefined;
      if (!b || typeof b.item !== "string" || typeof b.qty !== "number" || b.qty < 1) return res(400, { error: "invalid_body", fields: { item: "string required", qty: "integer >= 1 required" } }, 20);
      const idem = req.headers["Idempotency-Key"];
      if (idem && st.created[idem]) return res(200, st.created[idem], 30, { "idempotent-replay": "true" });
      const order = { id: st.nextOrder++, item: b.item, qty: b.qty };
      if (idem) st.created[idem] = order;
      return res(201, order, 60, { location: `/api/orders/${order.id}` });
    }
    case "GET /api/orders/999": return res(404, { error: "not_found", message: "No order 999" }, 20);
    case "GET /api/report": return n < 2 ? res(429, { error: "rate_limited" }, 10, { "retry-after": "2", "x-ratelimit-remaining": "0" }) : res(200, { rows: 128 });
    case "GET /api/flaky": return n < 3 ? res(500, { error: "upstream_failure" }, 80) : res(200, { ok: true });
    case "GET /api/slow": return { ...res(200, { ok: true }, req.headers["X-Server-Delay"] ? Number(req.headers["X-Server-Delay"]) : 5000) };
    case "GET /api/users": {
      const page = Math.max(1, Number(req.query.page ?? 1)), per = Math.max(1, Math.min(10, Number(req.query.per_page ?? 4)));
      const data = USERS.slice((page - 1) * per, page * per);
      return res(200, { data, page, per_page: per, total: USERS.length, has_more: page * per < USERS.length });
    }
    case "GET /api/events": {
      const lim = Math.max(1, Math.min(10, Number(req.query.limit ?? 4)));
      const start = req.query.cursor ? EVENTS.findIndex((e) => e.id === req.query.cursor) + 1 : 0;
      const data = EVENTS.slice(start, start + lim);
      return res(200, { data, next_cursor: start + lim < EVENTS.length ? data[data.length - 1].id : null });
    }
    default: return res(404, { error: "no_such_endpoint" }, 10);
  }
}

// ── The client ───────────────────────────────────────────────────────────
const TOKEN: Record<Options["token"], string | undefined> = { valid: "Bearer valid-token", missing: undefined, expired: "Bearer expired-token", readonly: "Bearer readonly-token" };

export interface ApiRun { frames: ApiFrame[]; summary: string; requests: number; finalStatus?: number; totalMs: number }

const retryable = (status: number) => status === 429 || status >= 500;
/** Exponential backoff: base × 2^attempt (attempt counts from 0). */
export const backoffDelay = (attempt: number, base: number) => base * 2 ** attempt;

export function runScenario(id: ScenarioId, options: Partial<Options> = {}): ApiRun {
  const o: Options = { ...DEFAULT_OPTIONS, ...options };
  const st = fresh();
  const frames: ApiFrame[] = [];
  let clock = 0, requests = 0, lastStatus: number | undefined;
  const push = (f: Omit<ApiFrame, "at">) => frames.push({ ...f, at: clock });

  const send = (req: Req, label: string): Res => {
    const withAuth: Req = { ...req, headers: { ...req.headers, ...(TOKEN[o.token] ? { Authorization: TOKEN[o.token]! } : {}) } };
    requests++;
    push({ phase: "request", title: `${label}: ${withAuth.method} ${withAuth.url}`, detail: `Headers, query and body the client sends${withAuth.headers.Authorization ? ". Credentials go in the Authorization header." : ". No credentials are sent."}`, req: withAuth });
    let r = serve(withAuth, st);
    if (r.ms > o.timeoutMs) {
      clock += o.timeoutMs;
      r = { status: 0, statusText: "Timeout", headers: {}, ms: o.timeoutMs, timedOut: true };
      push({ phase: "error", title: "Timeout: no response in time", detail: `The server needed longer than the client's ${o.timeoutMs} ms deadline, so the client gave up. The server may still have processed the request.`, req: withAuth, res: r });
      return r;
    }
    clock += r.ms;
    lastStatus = r.status;
    if (r.status === 401 || r.status === 403) push({ phase: "auth", title: `Authentication: ${r.status} ${r.statusText}`, detail: r.status === 401 ? "The server could not identify the caller (no, expired or invalid token). Get a valid token; repeating the same request fails the same way." : "The caller is known but is not allowed to do this. It needs a token with more permission.", req: withAuth, res: r });
    else push({ phase: "response", title: `Response: ${r.status} ${r.statusText}`, detail: statusMeaning(r.status), req: withAuth, res: r });
    return r;
  };

  /** Retry loop: only for retryable statuses, honouring Retry-After when allowed, otherwise exponential backoff. */
  const withRetries = (req: Req, label: string): Res => {
    let attempt = 0;
    for (;;) {
      const r = send(req, attempt === 0 ? label : `${label}, retry ${attempt}`);
      if (!(retryable(r.status) || r.timedOut)) return r;
      if (attempt >= o.maxRetries) { push({ phase: "error", title: "Giving up", detail: `${attempt} retries used (limit ${o.maxRetries}). The caller must report the failure instead of retrying forever.` }); return r; }
      const ra = r.headers["retry-after"];
      const delay = o.honorRetryAfter && ra ? Number(ra) * 1000 : backoffDelay(attempt, o.baseDelayMs);
      push({ phase: "wait", title: `Wait ${delay} ms`, detail: o.honorRetryAfter && ra ? `The server said Retry-After: ${ra} s, so the client waits exactly that long.` : `Exponential backoff: ${o.baseDelayMs} ms × 2^${attempt} = ${delay} ms. Waiting longer each time gives a struggling server room to recover.` });
      clock += delay;
      attempt++;
      push({ phase: "retry", title: `Retry ${attempt} of ${o.maxRetries}`, detail: "Sending the same request again." });
    }
  };

  const parse = (r: Res, what: string) => push({ phase: "parse", title: "Parse the JSON body", detail: r.body === undefined ? "No body." : `Turn the response text into data the program can use${what ? `: ${what}` : ""}.`, res: r });
  const finish = (summary: string): ApiRun => { push({ phase: "done", title: "Done", detail: summary }); return { frames, summary, requests, finalStatus: lastStatus, totalMs: clock }; };

  switch (id) {
    case "ok-200": { const r = send({ method: "GET", url: "/api/profile", headers: { Accept: "application/json" }, query: {} }, "Fetch profile"); if (r.status === 200) parse(r, "read the name and plan fields"); return finish(r.status === 200 ? "Profile loaded in one request." : `Request ended with ${r.status}.`); }
    case "created-201": {
      const body = { item: "keyboard", qty: 1 };
      const headers: Record<string, string> = { "Content-Type": "application/json", ...(o.idempotencyKey ? { "Idempotency-Key": "order-abc-1" } : {}) };
      const a = send({ method: "POST", url: "/api/orders", headers, query: {}, body }, "Create order");
      if (a.status >= 400) return finish(`Order was not created (${a.status}).`);
      push({ phase: "retry", title: "The response was lost; the client sends the same POST again", detail: "A network drop after the server created the order looks like a failure to the client. Retrying a POST is only safe if the server can recognise the repeat." });
      const b = send({ method: "POST", url: "/api/orders", headers, query: {}, body }, "Repeat order");
      return finish(o.idempotencyKey ? `Same Idempotency-Key, so the server returned order ${(b.body as { id: number }).id} again (replay) and only one order exists.` : `No Idempotency-Key: the server created a second order (${(a.body as { id: number }).id} and ${(b.body as { id: number }).id}). The customer is charged twice.`);
    }
    case "bad-400": { const r = send({ method: "POST", url: "/api/orders", headers: { "Content-Type": "application/json" }, query: {}, body: { item: "keyboard", qty: 0 } }, "Create order with qty 0"); return finish(`${r.status}: the body is invalid. A 4xx like this is not retried; the request itself must be fixed.`); }
    case "unauth-401": { const r = send({ method: "GET", url: "/api/profile", headers: {}, query: {} }, "Fetch profile"); return finish(r.status === 200 ? "The chosen token is valid, so the request succeeded. Choose Missing or Expired to see a 401." : `${r.status}: authenticate first.`); }
    case "forbidden-403": { const r = send({ method: "POST", url: "/api/orders", headers: { "Content-Type": "application/json" }, query: {}, body: { item: "keyboard", qty: 1 } }, "Create order"); return finish(r.status === 403 ? "403: the read-only token cannot write." : `Result ${r.status}. Choose the read-only token to see a 403.`); }
    case "notfound-404": { const r = send({ method: "GET", url: "/api/orders/999", headers: {}, query: {} }, "Fetch order 999"); return finish(`${r.status}: a missing resource is a normal answer; do not retry.`); }
    case "ratelimit-429": { const r = withRetries({ method: "GET", url: "/api/report", headers: {}, query: {} }, "Fetch report"); if (r.status === 200) parse(r, "read the row count"); return finish(r.status === 200 ? `Succeeded after ${requests} requests and ${clock} ms in total.` : `Still limited after ${requests} requests.`); }
    case "server-500": { const r = withRetries({ method: "GET", url: "/api/flaky", headers: {}, query: {} }, "Fetch data"); if (r.status === 200) parse(r, ""); return finish(r.status === 200 ? `Recovered on request ${requests}.` : `Failed after ${requests} requests; ${o.maxRetries} retries were not enough.`); }
    case "timeout": { const r = withRetries({ method: "GET", url: "/api/slow", headers: { "X-Server-Delay": String(o.timeoutMs * 2) }, query: {} }, "Fetch slow report"); return finish(r.timedOut ? `Every attempt timed out (${requests} requests). Retrying a slow GET is usually safe; retrying a POST that may have succeeded is not.` : "The server answered in time."); }
    case "page-offset": {
      let page = 1, total = 0;
      for (;;) {
        const r = send({ method: "GET", url: "/api/users", headers: {}, query: { page: String(page), per_page: String(o.pageSize) } }, `Page ${page}`);
        if (r.status !== 200) break;
        const b = r.body as { data: unknown[]; has_more: boolean };
        total += b.data.length;
        push({ phase: "page", title: `Collected ${total} users so far`, detail: b.has_more ? "has_more is true: ask for the next page." : "has_more is false: this was the last page.", res: r, collected: total });
        if (!b.has_more) break;
        page++;
      }
      return finish(`${total} users in ${requests} requests. Offset paging can skip or repeat rows if data changes between requests.`);
    }
    case "page-cursor": {
      let cursor: string | null = null, total = 0, n = 0;
      do {
        const r = send({ method: "GET", url: "/api/events", headers: {}, query: { limit: String(o.pageSize), ...(cursor ? { cursor } : {}) } }, `Page ${++n}`);
        if (r.status !== 200) break;
        const b = r.body as { data: unknown[]; next_cursor: string | null };
        total += b.data.length; cursor = b.next_cursor;
        push({ phase: "page", title: `Collected ${total} events so far`, detail: cursor ? `next_cursor is ${cursor}: the next request continues right after that record.` : "next_cursor is null: no more pages.", res: r, collected: total });
      } while (cursor);
      return finish(`${total} events in ${requests} requests. A cursor points at a record, so rows added meanwhile do not shift later pages.`);
    }
  }
}

export function statusMeaning(status: number): string {
  if (status >= 200 && status < 300) return status === 201 ? "201: the resource was created; the Location header says where." : "2xx: the request succeeded.";
  if (status === 400) return "400: the request is malformed. Fix it; do not retry as is.";
  if (status === 404) return "404: no such resource.";
  if (status === 429) return "429: too many requests. Wait (see Retry-After) and try again.";
  if (status >= 500) return "5xx: the server failed. These are often temporary, so a limited retry with backoff is reasonable.";
  return `${status}.`;
}

/** The schedule exponential backoff produces, for teaching the growth. */
export const backoffSchedule = (retries: number, base: number) => Array.from({ length: retries }, (_, i) => backoffDelay(i, base));
