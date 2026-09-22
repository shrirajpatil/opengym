/* The storage interface openGym's two backends (file.js, postgres.js) both implement, and the
 * only one server.js/coach/* are meant to import from directly (via ./index.js, which picks
 * one by STORE). This file carries no logic of its own — it exists so the contract is written
 * down once, in one place, rather than inferred by diffing two implementations.
 *
 * Two different contracts live here, because the data they cover has two different owners:
 *
 * 1. server.js-owned data (users/credentials/subs/invites, per-user workout state, the HMAC
 *    secret, VAPID keys, the audit log). server.js is never imported by a test — every
 *    server-*.test.js spawns it as a child process and talks HTTP only — so these methods are
 *    free to be fully async (`await store.getDb()`, etc). Postgres does real queries; file.js
 *    wraps the same synchronous fs calls server.js always made in a Promise, so `await` is a
 *    no-op there and behaviour is byte-for-byte what it was before this file existed.
 *
 * 2. Coach-owned data (instance config, per-profile job records, per-profile provider
 *    credentials). coach/config.js and coach/jobs.js ARE imported directly by many tests, whose
 *    assertions call `cfg.load()`, `jobs.enqueue()` etc. synchronously and sometimes require a
 *    synchronous throw (`assert.throws(() => jobs.enqueue(...), e => e.code === 'cap')`). These
 *    methods must therefore stay synchronous in BOTH backends — never return a Promise. Postgres
 *    satisfies this with a write-through in-memory cache: reads are served from the cache, and
 *    writes update the cache synchronously and fire the matching SQL statement in the
 *    background (fire-and-forget). See postgres.js's own header comment for the accepted
 *    durability tradeoff that follows from that (a restart can lose the last few seconds of
 *    Coach bookkeeping, never workout data).
 *
 * Nothing here is meant to be new abstraction for its own sake: the shapes below are exactly
 * what server.js/config.js/jobs.js/cohort.js already passed around as plain objects, just named
 * as methods so two backends can agree on them.
 */

/**
 * @typedef {object} StorageInterface
 *
 * ---------- server.js-owned (async) ----------
 *
 * getDb(): Promise<{users, creds, subs, invites}>
 *   The whole db.json-shaped blob. server.js keeps its own in-memory `db` and calls saveDb()
 *   after every mutation, exactly as it always wrote db.json whole — this is not a per-field
 *   API, on purpose, to keep the server.js rewrite a mechanical find-replace.
 *
 * saveDb(db): Promise<void>
 *   Persist the whole blob back (atomic-write-then-rename on file.js; a small multi-table
 *   upsert transaction on postgres.js — see that file for why it is not one JSON column).
 *
 * getState(uid): Promise<object|null>
 *   The per-user workout-state blob (state-<uid>.json's parsed contents), or null if the user
 *   has never synced. Includes `_rev`.
 *
 * putState(uid, state, baseRev): Promise<{ok:true, rev} | {ok:false, rev, state}>
 *   Conditional write (PUT /api/data's compare-and-swap). `baseRev` is the revision the client
 *   last read; a mismatch is refused and the current {rev, state} is handed back so the client
 *   can merge, exactly as the 409 response already does. `baseRev == null` always overwrites
 *   (a pre-revision client, or a deliberate replace such as a backup import). On success, `rev`
 *   is the new revision (old + 1). The state is stamped with `_rev` before it is returned to
 *   the caller, matching the field server.js has always kept inside the JSON itself.
 *
 * getSecret(): Promise<string>
 *   The hex HMAC secret, generated once on first call if absent.
 *
 * getVapid(): Promise<{publicKey, privateKey}>
 *   The VAPID keypair, generated once on first call if absent.
 *
 * appendAudit(rec): Promise<void>
 *   Append one audit record. Never throws out to the caller — audit.js/server.js already treat
 *   a failed write as non-fatal and log it; the backends do the same internally.
 *
 * readAudit({limit, before, cat}): Promise<{rows, total}>
 *   Newest-first page of the audit log, already filtered/retention-pruned — mirrors what
 *   GET /api/admin/audit builds from auditLines()/auditKeep() today.
 *
 * listUserIds(): Promise<string[]>
 *   Every uid with a state row — what coach/jobs.js's listUserIds() (cohort's participant pool)
 *   already computed by scanning `state-*.json`.
 *
 * ---------- Coach-owned (synchronous — see header) ----------
 *
 * coachConfigLoad(): object              — cfgStore.load()
 * coachConfigSave(patch): object          — cfgStore.save(patch)
 * coachConfigReset(): void                — cfgStore.reset() (test seam)
 * coachUserRead(uid): object              — jobs.readUser(uid)
 * coachUserWrite(uid, rec): void          — jobs.writeUser(uid, rec) (full replace)
 * coachUserClear(uid): void               — jobs.clearUser's file half (fs.unlinkSync equivalent)
 * coachProfileAuthRead(uid): object|null  — config.js's loadProfileAuth(uid)
 * coachProfileAuthWrite(uid, auth): void  — config.js's saveProfileAuth(uid, auth)
 * coachProfileAuthClear(uid): boolean     — config.js's clearProfileAuth(uid)
 * coachListUserFiles(): string[]          — coach/jobs.js recoverOnBoot's directory scan (uids
 *                                            with a coach record, distinct from listUserIds()
 *                                            above which scans state files)
 *
 * All of the above are plain synchronous functions/values — never a Promise — in both backends.
 */
export {};
