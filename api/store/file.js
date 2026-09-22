/* Default storage backend: flat JSON files under DATA_DIR, exactly as server.js/config.js/
 * jobs.js/cohort.js always wrote them. Nothing here is new logic — every function is the
 * pre-existing fs code from those four files, moved so postgres.js can sit behind the same
 * interface. STORE=file (the default) picks this module; self-hosters who never set STORE see
 * byte-for-byte the same files in ./data as before this split existed.
 *
 * The async server-owned methods (getDb, putState, …) wrap plain synchronous fs calls in a
 * Promise — there is nothing to await, but the interface is shared with postgres.js so callers
 * in server.js don't branch on which backend is active.
 *
 * The Coach-owned methods are synchronous, per the interface contract — trivially true here
 * since fs.*Sync was always what these did. jobs.js/cohort.js also read server-owned state
 * (`readState`, `listUserIds`) synchronously, a constraint postgres.js has to work around with
 * a cache (see that file); file.js needs no such thing; getStateSync/listUserIdsSync below are
 * just readState/listUserIds's old bodies, kept sync for both call paths.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import webpush from 'web-push';

const DATA = process.env.DATA_DIR || '/data';
const COACH_DIR = path.join(DATA, 'coach');

function atomicWrite(file, content, mode) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

/* ---------- server.js-owned ---------- */

const dbFile = path.join(DATA, 'db.json');
function readDbSync() {
  let db = { users: [], creds: [], subs: [], invites: [] };
  try { db = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch { /* first boot */ }
  db.subs = db.subs || [];
  db.invites = db.invites || [];
  return db;
}
export async function getDb() { return readDbSync(); }
export async function saveDb(db) { atomicWrite(dbFile, JSON.stringify(db, null, 2), 0o600); }

const safeUid = uid => String(uid).replace(/[^a-zA-Z0-9_-]/g, '');
const stateFile = uid => path.join(DATA, 'state-' + safeUid(uid) + '.json');
function readStateSync(uid) {
  try { return JSON.parse(fs.readFileSync(stateFile(uid), 'utf8')); } catch { return null; }
}
export async function getState(uid) { return readStateSync(uid); }
export async function putState(uid, state, baseRev) {
  // Synchronous with nothing awaited between the read and the write, so this is atomic for
  // this process — the same invariant PUT /api/data always relied on.
  const cur = readStateSync(uid);
  const curRev = cur?._rev || 0;
  if (baseRev != null && baseRev !== curRev) return { ok: false, rev: curRev, state: cur };
  const next = { ...state, _rev: curRev + 1 };
  atomicWrite(stateFile(uid), JSON.stringify(next));
  return { ok: true, rev: next._rev, state: next };
}

const secretFile = path.join(DATA, 'secret');
export async function getSecret() {
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(secretFile, 'utf8').trim();
}

const vapidFile = path.join(DATA, 'vapid.json');
export async function getVapid() {
  try { return JSON.parse(fs.readFileSync(vapidFile, 'utf8')); }
  catch {
    const vapid = webpush.generateVAPIDKeys();
    fs.writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600 });
    return vapid;
  }
}

const auditFile = path.join(DATA, 'audit.log');
export async function appendAudit(rec) {
  try { fs.appendFileSync(auditFile, JSON.stringify(rec) + '\n'); }
  catch (e) { console.error('audit write failed', e.message); }
}
// Rewrites the file down to `rows` — used by retention pruning, which server.js drives (it
// owns AUDIT_MAX/AUDIT_DAYS and the amortized-compaction schedule); this backend just performs
// the write file.js has always done for it.
export async function writeAuditRows(rows) {
  try { atomicWrite(auditFile, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); }
  catch (e) { console.error('audit compact failed', e.message); }
}
export async function readAuditRows() {
  let text;
  try { text = fs.readFileSync(auditFile, 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { const r = JSON.parse(line); if (r && r.id && r.ev) rows.push(r); } catch { /* torn line */ }
  }
  return rows;
}
export async function deleteAuditFile() {
  try { fs.unlinkSync(auditFile); } catch { /* nothing logged yet */ }
}

export async function listUserIds() { return listUserIdsSync(); }
// Exposed sync too: coach/jobs.js's listUserIds() (the cohort participant pool) has to stay
// synchronous — see the interface header — and file.js's version always was.
export function listUserIdsSync() {
  try { return fs.readdirSync(DATA).filter(f => /^state-[a-zA-Z0-9_-]+\.json$/.test(f)).map(f => f.slice(6, -5)); }
  catch { return []; }
}
// jobs.readState(uid) is on the same SYNC-REQUIRED list, for the same reason.
export function getStateSync(uid) { return readStateSync(uid); }

/* ---------- Coach-owned (synchronous, unconditionally — this is the file backend) ---------- */

const coachConfigFile = path.join(DATA, 'coach.json');
export function coachConfigLoadRaw() {
  try { return JSON.parse(fs.readFileSync(coachConfigFile, 'utf8')); } catch { return null; }
}
export function coachConfigSaveRaw(obj) {
  atomicWrite(coachConfigFile, JSON.stringify(obj, null, 2), 0o600);
}

const coachUserFile = uid => path.join(COACH_DIR, safeUid(uid) + '.json');
export function coachUserRead(uid) {
  try { return JSON.parse(fs.readFileSync(coachUserFile(uid), 'utf8')); } catch { return null; }
}
export function coachUserWrite(uid, rec) {
  fs.mkdirSync(COACH_DIR, { recursive: true, mode: 0o700 });
  const file = coachUserFile(uid), tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rec), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
export function coachUserClear(uid) {
  try { fs.unlinkSync(coachUserFile(uid)); return true; } catch { return false; }
}
export function coachListUserFiles() {
  try { return fs.readdirSync(COACH_DIR).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')); }
  catch { return []; }
}

const uidSafe = uid => /^[A-Za-z0-9_-]{1,64}$/.test(String(uid || ''));
export function coachProfileAuthFile(uid) {
  if (!uidSafe(uid)) throw new Error('bad profile id');
  return path.join(DATA, `coach-auth-${uid}.json`);
}
export function coachProfileAuthRead(uid) {
  try { return JSON.parse(fs.readFileSync(coachProfileAuthFile(uid), 'utf8')); } catch { return null; }
}
export function coachProfileAuthWrite(uid, auth) {
  atomicWrite(coachProfileAuthFile(uid), JSON.stringify(auth, null, 2), 0o600);
  return auth;
}
export function coachProfileAuthClear(uid) {
  try { fs.unlinkSync(coachProfileAuthFile(uid)); return true; } catch { return false; }
}
