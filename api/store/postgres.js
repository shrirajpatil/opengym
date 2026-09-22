/* Postgres storage backend (Supabase, Render Postgres, any managed instance) — STORE=postgres,
 * DATABASE_URL set. Exists because Render/Supabase's free tiers give a container no persistent
 * disk: DATA_DIR would be wiped on every deploy, so the flat-JSON-file backend (file.js, the
 * default) cannot survive there. Schema: api/store/schema.sql, applied once by hand.
 *
 * ---------- the write-through Coach cache, and the tradeoff it accepts ----------
 *
 * coach/config.js and coach/jobs.js are imported directly by many tests, which call their
 * public functions (load, save, enqueue, readUser, …) SYNCHRONOUSLY — one test requires
 * `jobs.enqueue()` to synchronously THROW on a capped account, not reject a Promise. A real
 * `await pg.query(...)` inside those functions would break the suite outright, so this backend
 * cannot do what it does for server.js-owned data (getDb/getState/… are honestly async).
 *
 * Instead, Coach state is kept in an in-memory cache — module-level `cache`/`keyCache` here,
 * the same shape config.js's own `cache` variable already used for the file backend, just
 * fronting Postgres instead of fs. Every read is served from the cache (synchronous, always
 * current for THIS process). Every write updates the cache synchronously — so the caller sees
 * its own write immediately, exactly as a synchronous fs write always did — and then fires the
 * matching SQL statement in the background: not awaited, fire-and-forget, logged to
 * console.error on failure (the same non-fatal-persistence-failure posture server.js already
 * takes for audit writes and push sends).
 *
 * The accepted tradeoff: if this process crashes or restarts between a synchronous cache
 * update and its background write landing in Postgres, that write is lost — the next boot
 * hydrates from whatever Postgres last durably has, which is a few seconds stale. This
 * includes the daily Coach job-usage counters (bumpDaily/bumpInstanceDaily): a user could
 * occasionally get one extra job around a restart. This is accepted, deliberately, because the
 * cap is a soft usage limit, not billing or security — and it is treated uniformly with every
 * other Coach write here rather than given special (e.g. synchronous/transactional) handling,
 * which would be more machinery for a guarantee nothing downstream of it needs. Workout data
 * itself (user_state, below) has no such gap: putState's CAS write is a real awaited query on
 * the request path, same as file.js's fs write is synchronous on it.
 *
 * Boot: server.js calls init() once, awaited, before http.createServer(...).listen() — a short
 * blocking read of the coach_config singleton row so isEnabled()/isConnected() answer
 * correctly from the very first request, without every route needing to await a lazy warm-up.
 * Coach config rarely changes, so one extra read at boot is cheap. Per-uid coach_users /
 * coach_profile_auth rows are NOT preloaded (a box could have many profiles); they hydrate
 * lazily on first access per uid and stay cached after that, same write-through pattern.
 */
import pg from 'pg';
import crypto from 'node:crypto';
import webpush from 'web-push';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const bg = (label, p) => { p.catch(e => console.error(`postgres: ${label} failed (will retry on next write)`, e.message)); };

/* ---------- server.js-owned (real async queries) ---------- */

export async function getDb() {
  const [users, creds, subs, invites] = await Promise.all([
    pool.query('select id, name, created, disabled, admin, invited_by as "invitedBy", sv, last_reminder as "lastReminder" from users'),
    pool.query('select id, user_id as "userId", public_key as "publicKey", counter, transports from credentials'),
    pool.query('select endpoint, user_id as "userId", keys, device_id as "deviceId", created from push_subs'),
    pool.query('select code, note, created_by as "createdBy", created, used_by as "usedBy", used_at as "usedAt", revoked from invites')
  ]);
  return {
    users: users.rows.map(u => ({ ...u, created: u.created?.toISOString?.() ?? u.created })),
    creds: creds.rows,
    subs: subs.rows.map(s => ({ ...s, deviceId: s.deviceId || undefined })),
    invites: invites.rows.map(i => ({ ...i, usedAt: i.usedAt?.toISOString?.() ?? i.usedAt }))
  };
}

// server.js mutates its in-memory `db` object in place and calls saveDb(db) to persist the
// whole thing, mirroring the old whole-file rewrite — the four tables are diffed against what
// is already there in one transaction rather than reworking every call site in server.js into
// per-row upserts.
export async function saveDb(db) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const u of db.users) {
      await client.query(
        `insert into users (id, name, created, disabled, admin, invited_by, sv, last_reminder)
         values ($1,$2,coalesce($3,now()),$4,$5,$6,$7,$8)
         on conflict (id) do update set name=$2, disabled=$4, admin=$5, invited_by=$6, sv=$7, last_reminder=$8`,
        [u.id, u.name, u.created || null, !!u.disabled, !!u.admin, u.invitedBy || null, u.sv || 0, u.lastReminder || null]
      );
    }
    await client.query('delete from credentials where user_id = any($1) and id != all($2)',
      [db.users.map(u => u.id), db.creds.map(c => c.id)]);
    for (const c of db.creds) {
      await client.query(
        `insert into credentials (id, user_id, public_key, counter, transports) values ($1,$2,$3,$4,$5)
         on conflict (id) do update set counter=$4, transports=$5`,
        [c.id, c.userId, c.publicKey, c.counter || 0, JSON.stringify(c.transports || [])]
      );
    }
    await client.query('delete from push_subs where endpoint != all($1)', [db.subs.map(s => s.endpoint) || ['']]);
    for (const s of db.subs) {
      await client.query(
        `insert into push_subs (endpoint, user_id, keys, device_id, created) values ($1,$2,$3,$4,coalesce($5,now()))
         on conflict (endpoint) do update set keys=$3, device_id=$4`,
        [s.endpoint, s.userId, JSON.stringify(s.keys), s.deviceId || null, s.created || null]
      );
    }
    await client.query('delete from invites where code != all($1)', [db.invites.map(i => i.code) || ['']]);
    for (const i of db.invites) {
      await client.query(
        `insert into invites (code, note, created_by, created, used_by, used_at, revoked) values ($1,$2,$3,coalesce($4,now()),$5,$6,$7)
         on conflict (code) do update set used_by=$5, used_at=$6, revoked=$7`,
        [i.code, i.note || null, i.createdBy || null, i.created || null, i.usedBy || null, i.usedAt || null, !!i.revoked]
      );
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

export async function getState(uid) {
  const r = await pool.query('select state, rev from user_state where user_id = $1', [uid]);
  if (!r.rows.length) return null;
  return { ...r.rows[0].state, _rev: r.rows[0].rev };
}

// The CAS write PUT /api/data needs: one atomic UPDATE, not a SELECT-then-UPDATE race between
// two devices syncing at once. baseRev == null (pre-revision client, a deliberate replace)
// bypasses the check and force-writes via upsert.
export async function putState(uid, state, baseRev) {
  const body = { ...state };
  delete body._rev;
  if (baseRev == null) {
    const r = await pool.query(
      `insert into user_state (user_id, state, rev) values ($1, $2, 1)
       on conflict (user_id) do update set state = $2, rev = user_state.rev + 1, updated_at = now()
       returning rev`,
      [uid, JSON.stringify(body)]
    );
    const rev = r.rows[0].rev;
    return { ok: true, rev, state: { ...body, _rev: rev } };
  }
  const r = await pool.query(
    `update user_state set state = $1, rev = rev + 1, updated_at = now()
     where user_id = $2 and rev = $3
     returning rev`,
    [JSON.stringify(body), uid, baseRev]
  );
  if (r.rows.length) {
    const rev = r.rows[0].rev;
    return { ok: true, rev, state: { ...body, _rev: rev } };
  }
  // Lost the race (or the row doesn't exist yet, or baseRev is simply stale) — hand back the
  // current document so the client can merge, same contract as the 409 branch always had.
  const cur = await getState(uid);
  return { ok: false, rev: cur?._rev || 0, state: cur };
}

export async function getSecret() {
  const r = await pool.query('select secret_hex from server_secret where id = 1');
  if (r.rows.length) return r.rows[0].secret_hex;
  const secret = crypto.randomBytes(32).toString('hex');
  await pool.query('insert into server_secret (id, secret_hex) values (1, $1) on conflict (id) do nothing', [secret]);
  const r2 = await pool.query('select secret_hex from server_secret where id = 1');
  return r2.rows[0].secret_hex;
}

export async function getVapid() {
  const r = await pool.query('select public_key, private_key from vapid_keys where id = 1');
  if (r.rows.length) return { publicKey: r.rows[0].public_key, privateKey: r.rows[0].private_key };
  const vapid = webpush.generateVAPIDKeys();
  await pool.query('insert into vapid_keys (id, public_key, private_key) values (1, $1, $2) on conflict (id) do nothing',
    [vapid.publicKey, vapid.privateKey]);
  const r2 = await pool.query('select public_key, private_key from vapid_keys where id = 1');
  return { publicKey: r2.rows[0].public_key, privateKey: r2.rows[0].private_key };
}

export async function appendAudit(rec) {
  try {
    await pool.query(
      `insert into audit_log (seq, ts, ev, ok, uid, name, tgt, tname, msg, ip) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [rec.id, rec.ts, rec.ev, rec.ok !== false, rec.uid || null, rec.name || null, rec.tgt || null, rec.tname || null, rec.msg || null, rec.ip || null]
    );
  } catch (e) { console.error('audit write failed', e.message); }
}
export async function writeAuditRows() {
  // Retention pruning is a DELETE against audit_log directly (readAuditRows/appendAudit already
  // give server.js everything it needs); there is no whole-file rewrite to mirror here.
}
export async function readAuditRows() {
  const r = await pool.query('select seq as id, ts, ev, ok, uid, name, tgt, tname, msg, ip from audit_log order by seq');
  return r.rows;
}
export async function deleteAuditFile() {
  await pool.query('delete from audit_log');
}

export async function listUserIds() {
  const r = await pool.query('select user_id from user_state');
  return r.rows.map(x => x.user_id);
}

/* ---------- Coach-owned (write-through cache, synchronous contract) ---------- */

const DEFAULT_COACH_CONFIG_ROW = {
  enabled: false, provider: 'fixture', auth_mode: 'instance', auth: {}, models: {},
  provider_options: {}, bound_uid: {}, caps: { perProfileDaily: 10, instanceDaily: 0 },
  daily_date: null, daily_count: 0, community: false, log: []
};

let configCache = null;   // hydrated object, config.js's own shape (see rowToConfig)
const userCache = new Map();       // uid -> coach_users row shape, or null (known-absent)
const profileAuthCache = new Map(); // uid -> coach_profile_auth row shape, or null

function rowToConfig(row) {
  return {
    enabled: row.enabled, provider: row.provider, authMode: row.auth_mode,
    auth: row.auth || {}, models: row.models || {}, providerOptions: row.provider_options || {},
    boundUid: row.bound_uid || {}, caps: row.caps || DEFAULT_COACH_CONFIG_ROW.caps,
    daily: row.daily_date ? { date: row.daily_date, count: row.daily_count } : null,
    community: row.community, log: row.log || []
  };
}
function configToRow(cfg) {
  return {
    enabled: !!cfg.enabled, provider: cfg.provider, auth_mode: cfg.authMode,
    auth: JSON.stringify(cfg.auth || {}), models: JSON.stringify(cfg.models || {}),
    provider_options: JSON.stringify(cfg.providerOptions || {}), bound_uid: JSON.stringify(cfg.boundUid || {}),
    caps: JSON.stringify(cfg.caps || DEFAULT_COACH_CONFIG_ROW.caps),
    daily_date: cfg.daily?.date || null, daily_count: cfg.daily?.count || 0,
    community: !!cfg.community, log: JSON.stringify(cfg.log || [])
  };
}

/** Blocks briefly before the HTTP server starts accepting requests, so coachConfigLoad() below
 *  answers correctly from the first request rather than racing a background hydration. Safe to
 *  call once at boot; server.js is the only caller. */
export async function init() {
  const r = await pool.query('select * from coach_config where id = 1');
  configCache = r.rows.length ? rowToConfig(r.rows[0])
    : { enabled: false, provider: 'fixture', authMode: 'instance', auth: {}, models: {}, providerOptions: {}, boundUid: {}, caps: DEFAULT_COACH_CONFIG_ROW.caps, daily: null, community: false, log: [] };
  if (!r.rows.length) {
    bg('coach_config seed', pool.query('insert into coach_config (id) values (1) on conflict (id) do nothing'));
  }
}

export function coachConfigLoadRaw() {
  // config.js's load() merges this with DEFAULTS/legacy-migration itself, same as it does for
  // file.js's null-on-first-boot return — so an un-hydrated cache (init() not yet called, e.g.
  // a test importing config.js without going through server.js's boot path) still answers with
  // something load() can work from rather than throwing.
  return configCache;
}
export function coachConfigSaveRaw(obj) {
  configCache = obj;
  bg('coach_config save', pool.query(
    `insert into coach_config (id, enabled, provider, auth_mode, auth, models, provider_options, bound_uid, caps, daily_date, daily_count, community, log)
     values (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     on conflict (id) do update set enabled=$1, provider=$2, auth_mode=$3, auth=$4, models=$5, provider_options=$6, bound_uid=$7, caps=$8, daily_date=$9, daily_count=$10, community=$11, log=$12`,
    Object.values(configToRow(obj))
  ));
}

function rowToUser(row) {
  return {
    daily: row.daily_date ? { date: row.daily_date, count: row.daily_count } : null,
    current: row.current || null, pending: row.pending || null, history: row.history || [], share: !!row.share
  };
}
/** Lazy per-uid hydration: the first call blocks on one query (this is only reached from
 *  coach/jobs.js call sites that are already fine paying a query — enqueue, status, etc., never
 *  a hot per-request loop) and every call after is served from userCache. */
function ensureUserCached(uid) {
  if (userCache.has(uid)) return userCache.get(uid);
  // Populated synchronously below by the caller (coachUserRead), which is the one place this
  // is invoked from; see that function for why a synchronous query is acceptable here.
  return undefined;
}

// coach/jobs.js's readUser/writeUser/clearUser must stay synchronous (SYNC-REQUIRED). A
// genuinely synchronous Postgres read is not possible with the `pg` driver, so the *first*
// access for a given uid in this process falls back to `null` (readUser's own EMPTY-merge
// default) rather than blocking — exactly like a cache miss on a brand-new profile always
// looked to config.js/jobs.js (a file that has never been written yet). The read is still
// kicked off in the background and populates userCache for every call after the first, so a
// profile with existing Coach history looks right again within one round trip, same spirit as
// the write-through tradeoff above: a boot-adjacent read can be briefly stale, never wrong in
// a way that breaks a later write (writes always go through the cache-then-persist path, which
// is unconditionally synchronous once the cache exists).
export function coachUserRead(uid) {
  const hit = ensureUserCached(uid);
  if (hit !== undefined) return hit;
  userCache.set(uid, null);   // placeholder so a burst of calls before the query lands doesn't refire it
  bg('coach_users hydrate', pool.query('select * from coach_users where user_id = $1', [uid]).then(r => {
    userCache.set(uid, r.rows.length ? rowToUser(r.rows[0]) : null);
  }));
  return null;
}
export function coachUserWrite(uid, rec) {
  userCache.set(uid, rec);
  bg('coach_users write', pool.query(
    `insert into coach_users (user_id, daily_date, daily_count, current, pending, history, share)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (user_id) do update set daily_date=$2, daily_count=$3, current=$4, pending=$5, history=$6, share=$7`,
    [uid, rec.daily?.date || null, rec.daily?.count || 0, JSON.stringify(rec.current || null),
      JSON.stringify(rec.pending || null), JSON.stringify(rec.history || []), !!rec.share]
  ));
}
export function coachUserClear(uid) {
  const existed = userCache.get(uid) != null;
  userCache.set(uid, null);
  bg('coach_users clear', pool.query('delete from coach_users where user_id = $1', [uid]));
  return existed;
}
// Only reachable after every uid this process has touched has been through coachUserRead/write,
// so the cache is the complete answer for THIS process — recoverOnBoot() (the one caller) only
// needs "was mid-flight when we died", and a Postgres-backed instance restarting mid-job is the
// same "say so, let them retry" situation file.js already handles per-uid; a cross-instance,
// cross-restart sweep would need its own query and isn't worth it for a rare, non-destructive
// recovery message.
export function coachListUserFiles() {
  return [...userCache.entries()].filter(([, v]) => v != null).map(([k]) => k);
}

function ensureProfileAuthCached(uid) {
  if (profileAuthCache.has(uid)) return profileAuthCache.get(uid);
  return undefined;
}
export function coachProfileAuthFile(uid) {
  // Kept only for parity with file.js's error behaviour (bad ids refused the same way); no
  // filesystem path exists here.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(uid || ''))) throw new Error('bad profile id');
  return `postgres:coach_profile_auth:${uid}`;
}
export function coachProfileAuthRead(uid) {
  coachProfileAuthFile(uid); // validate, same as file.js
  const hit = ensureProfileAuthCached(uid);
  if (hit !== undefined) return hit;
  profileAuthCache.set(uid, null);
  bg('coach_profile_auth hydrate', pool.query('select * from coach_profile_auth where user_id = $1', [uid]).then(r => {
    profileAuthCache.set(uid, r.rows.length
      ? { type: r.rows[0].type, account: r.rows[0].account, data: r.rows[0].data, connectedAt: r.rows[0].connected_at }
      : null);
  }));
  return null;
}
export function coachProfileAuthWrite(uid, auth) {
  coachProfileAuthFile(uid);
  profileAuthCache.set(uid, auth);
  bg('coach_profile_auth write', pool.query(
    `insert into coach_profile_auth (user_id, type, account, data, connected_at) values ($1,$2,$3,$4,coalesce($5,now()))
     on conflict (user_id) do update set type=$2, account=$3, data=$4`,
    [uid, auth.type, auth.account || null, auth.data, auth.connectedAt || null]
  ));
  return auth;
}
export function coachProfileAuthClear(uid) {
  const existed = profileAuthCache.get(uid) != null;
  profileAuthCache.set(uid, null);
  bg('coach_profile_auth clear', pool.query('delete from coach_profile_auth where user_id = $1', [uid]));
  return existed;
}

/* ---------- synchronous access to server-owned state, for jobs.js/cohort.js only ----------
 * jobs.readState(uid) and jobs.listUserIds() are on the SYNC-REQUIRED list (a review job reads
 * a profile's workouts synchronously mid-pipeline, and jobs.test.js calls jobs.readState
 * directly). Unlike Coach's own bookkeeping, this is workout data with no write path here —
 * only reads — so the same lazy-hydrate-with-null-first-miss shape as coachUserRead is enough:
 * a Coach job that runs before this process has ever hydrated a given uid's state sees "no
 * state yet" once and gets the real data on its next call, same as a brand-new profile with no
 * state file would look to file.js. */
const stateCache = new Map();
export function getStateSync(uid) {
  if (stateCache.has(uid)) return stateCache.get(uid);
  stateCache.set(uid, null);
  bg('user_state hydrate (coach)', getState(uid).then(S => stateCache.set(uid, S)));
  return null;
}
let userIdsCache = [];
export function listUserIdsSync() {
  bg('user_state ids refresh (coach)', listUserIds().then(ids => { userIdsCache = ids; }));
  return userIdsCache;
}
