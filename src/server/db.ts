import { Pool, type PoolClient } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";

/**
 * THE DATA LAYER.
 *
 * Every query runs through a connection that has become `authenticated` and carries
 * the signed-in user's id as a JWT claim. From that moment Postgres applies exactly
 * the same row-level policies the REST API applies.
 *
 * That is the whole point: a server-rendered page cannot accidentally read a school
 * the user is not allowed to see, because the database refuses, not because a
 * component remembered to check. The app connects as `mintrix_app`, which is not a
 * superuser and owns nothing — so a code path that forgets to establish a user
 * context fails closed instead of reading everything.
 */

const CONNECTION = process.env.DATABASE_URL;
if (!CONNECTION && process.env.NODE_ENV !== "test") {
  // Deliberately loud. A missing connection string must not silently fall back to
  // some other database.
  console.warn("DATABASE_URL is not set — every query will fail.");
}

/**
 * Supabase's pooler terminates TLS with its own chain. Given its CA (a PEM, or a path
 * to one) the certificate is verified; without it the connection is still encrypted
 * but the server is not authenticated — acceptable locally, not in production.
 */
function tls() {
  const raw = process.env.DATABASE_SSL_CA?.trim();
  if (!raw) return { rejectUnauthorized: false };
  const ca = raw.includes("-----BEGIN")
    ? raw.replace(/\\n/g, "\n")
    : fs.readFileSync(raw, "utf8");
  return { ca, rejectUnauthorized: true };
}

let pool: Pool | null = null;
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: CONNECTION,
      ssl: tls(),
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    });
    pool.on("error", (e) => console.error("pg pool error", e.message));
  }
  return pool;
}

export type Row = Record<string, any>;

interface Ctx {
  client: PoolClient;
  userId: string | null;
  /** Set while inside runTransaction, so nested calls join rather than nest. */
  inTransaction: boolean;
}
const store = new AsyncLocalStorage<Ctx>();

/** The connection the current request is using, if one has been established. */
function ctx(): Ctx {
  const c = store.getStore();
  if (!c) {
    throw new Error(
      "No database context. Every query must run inside withUser() or asService().");
  }
  return c;
}

export const currentUserId = () => store.getStore()?.userId ?? null;

/**
 * Check out a connection, retrying once.
 *
 * Supabase's pooler closes sockets that have been idle, and node-postgres can hand
 * back a client that died between being pooled and being used. That surfaced as
 * "Connection terminated unexpectedly" on the first request after a quiet spell —
 * a 500 for a user who did nothing wrong. One retry gets a fresh socket.
 */
async function connect(): Promise<PoolClient> {
  try {
    return await getPool().connect();
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (!/terminated|ECONNRESET|EPIPE|socket|timeout/i.test(msg)) throw e;
    console.warn("pg connect retrying after:", msg);
    return await getPool().connect();
  }
}

/**
 * Run `fn` with the database acting as this user. Everything inside is subject to
 * row level security.
 */
export async function withUser<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
  const client = await connect();
  try {
    // Session-level, NOT inside a transaction. Wrapping a whole request in one
    // transaction meant a single failed statement aborted everything after it —
    // Postgres refuses further commands until rollback — so an expected error (a
    // refused stage move, a duplicate) poisoned the rest of the page.
    //
    // Safe because every checkout sets the context before running anything, and
    // because a query with no context at all throws rather than running.
    await client.query("set role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, false)",
                       [JSON.stringify({ sub: userId, role: "authenticated" })]);
    return await store.run({ client, userId, inTransaction: false }, fn);
  } finally {
    // Never hand a connection back still carrying somebody's identity.
    try {
      await client.query("reset role");
      await client.query("select set_config('request.jwt.claims', '', false)");
    } catch { /* the connection is going away anyway */ }
    client.release();
  }
}

/**
 * Run with RLS bypassed, as Supabase's `service_role` — which has bypassrls but is
 * NOT a superuser: it cannot alter roles, read server files or change the schema.
 *
 * Reserved for work that genuinely precedes a user: the sign-in lookup, the importer,
 * migrations. Never reachable from a request handler that already has a user.
 * Callers must say why, and the reason is recorded in the audit trail where it
 * matters.
 */
export async function asService<T>(why: string, fn: () => Promise<T>): Promise<T> {
  if (!why.trim()) throw new Error("asService requires a reason.");
  const client = await connect();
  try {
    await client.query("set role service_role");
    return await store.run({ client, userId: null, inTransaction: false }, fn);
  } finally {
    try { await client.query("reset role"); } catch { /* ignore */ }
    client.release();
  }
}

// --------------------------------------------------------------------------
// Queries
// --------------------------------------------------------------------------
/**
 * The existing codebase writes `?` placeholders. Postgres wants $1, $2. Translating
 * here means several hundred working queries survive the move instead of being
 * rewritten by hand, which is where the bugs would have come from.
 */
export function toPg(sql: string): string {
  let n = 0;
  let out = "";
  let inSingle = false, inDouble = false, inComment = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (inComment) { inComment = c !== "\n"; out += c; continue; }
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "-" && sql[i + 1] === "-" && !inSingle && !inDouble) inComment = true;
    if (c === "?" && !inSingle && !inDouble) { out += `$${++n}`; continue; }
    out += c;
  }
  return out;
}

/**
 * One place where a SQL error is turned into something a human can act on. The
 * statement is logged for the developer; the message that escapes never contains a
 * raw driver string, because a rep must never be shown one.
 */
async function q(sql: string, args: unknown[]) {
  try {
    return await ctx().client.query(toPg(sql), args);
  } catch (e) {
    const err = e as Error & { code?: string; detail?: string };
    if (process.env.MINTRIX_SQL_DEBUG) {
      console.error(`SQL ${err.code ?? ""}: ${err.message}\n  ${sql.trim().slice(0, 300)}`);
    }
    throw err;
  }
}

export async function many(sql: string, args: unknown[] = []): Promise<Row[]> {
  return (await q(sql, args)).rows;
}

export async function one(sql: string, args: unknown[] = []): Promise<Row | null> {
  return (await q(sql, args)).rows[0] ?? null;
}

export async function run(sql: string, args: unknown[] = []) {
  const r = await q(sql, args);
  return { changes: r.rowCount ?? 0 };
}

export async function get(table: string, id: string | null | undefined): Promise<Row | null> {
  if (!id) return null;
  return one(`select * from ${ident(table)} where id = ?`, [id]);
}

/** Table and column names are never interpolated from user input, but be explicit. */
function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `"${name}"`;
}

export async function columns(table: string): Promise<Set<string>> {
  const rows = await many(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = ?`, [table]);
  return new Set(rows.map((r) => r.column_name as string));
}

// --------------------------------------------------------------------------
// Canonical ids. ACC-0001, SCH-0001 … kept from the original build so the data
// that migrated across is still addressable by the ids people have seen.
// --------------------------------------------------------------------------
const PREFIX: Record<string, string> = {
  accounts: "ACC", schools: "SCH", people: "CON", person_roles: "REL",
  opportunities: "OPP", opportunity_stakeholders: "OST",
  podcast_relationships: "POD", podcast_signals: "SIG",
  delivery_projects: "DEL", work_items: "TSK", activities: "ACT",
  blockers: "BLK", stage_transitions: "TRN", stage_slas: "SLA",
  stage_handoffs: "HOF", gate_evidence: "GAT", research: "RES",
  icp_assessments: "ICP", discoveries: "DSC", diagnostics: "DIA",
  pilots: "PIL", proposals: "PRO", contracts: "CTR", payments: "PAY",
  lead_imports: "IMP", duplicate_reviews: "DUP",
};

export async function newId(table: string): Promise<string> {
  const prefix = PREFIX[table];
  if (!prefix) throw new Error(`No id prefix for ${table}`);
  const r = await one(
    `select coalesce(max(cast(substring(id from '[0-9]+$') as integer)), 0) + 1 as n
       from ${ident(table)} where id like ?`, [`${prefix}-%`]);
  return `${prefix}-${String(r?.n ?? 1).padStart(4, "0")}`;
}

export async function insert(table: string, fields: Row): Promise<string> {
  const data = { ...fields };
  if (!data.id && PREFIX[table]) data.id = await newId(table);
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  const cols = keys.map(ident).join(", ");
  const ph = keys.map((_, i) => `$${i + 1}`).join(", ");
  const r = await q(`insert into ${ident(table)} (${cols}) values (${ph}) returning *`,
                    keys.map((k) => data[k]));
  return (r.rows[0]?.id as string) ?? (data.id as string);
}

export async function update(table: string, id: string, fields: Row): Promise<void> {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${ident(k)} = $${i + 1}`).join(", ");
  const hasUpdated = (await columns(table)).has("updated_at");
  await q(`update ${ident(table)} set ${sets}${hasUpdated ? ", updated_at = now()" : ""}
            where id = $${keys.length + 1}`,
          [...keys.map((k) => fields[k]), id]);
}

/**
 * A real transaction. This is what makes a stage move atomic: the stage, the history,
 * the SLA, the work and the audit event either all land or none do. Nested calls join
 * the outer transaction with a savepoint rather than opening a second one.
 */
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  const c = ctx();
  if (c.inTransaction) {
    const sp = `sp_${Math.random().toString(36).slice(2, 10)}`;
    await c.client.query(`savepoint ${sp}`);
    try {
      const out = await fn();
      await c.client.query(`release savepoint ${sp}`);
      return out;
    } catch (e) {
      await c.client.query(`rollback to savepoint ${sp}`);
      throw e;
    }
  }
  await c.client.query("begin");
  c.inTransaction = true;
  try {
    const out = await fn();
    await c.client.query("commit");
    return out;
  } catch (e) {
    try { await c.client.query("rollback"); } catch { /* already gone */ }
    throw e;
  } finally {
    c.inTransaction = false;
  }
}

// --------------------------------------------------------------------------
// Time. Postgres owns `now()`; these are for building values in JS.
// --------------------------------------------------------------------------
export const now = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);
export function plusDays(days: number, base?: Date): string {
  const d = base ? new Date(base) : new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
export function plusHours(hours: number, base?: Date): string {
  const d = base ? new Date(base) : new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}
export function daysBetween(from?: string | Date | null, to?: string | Date | null): number {
  if (!from) return 0;
  const a = new Date(from).getTime();
  const b = to ? new Date(to).getTime() : Date.now();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export async function close() {
  if (pool) { await pool.end(); pool = null; }
}
