/* Picks the storage backend. STORE=file (default) needs nothing else set and behaves exactly
 * as openGym always did — a self-hoster who never touches STORE is unaffected. STORE=postgres
 * requires DATABASE_URL and the schema in ./schema.sql applied first; see docs/SELF_HOSTING.md.
 *
 * A static import of postgres.js (and its `pg` dependency) would run even on STORE=file, so
 * this is the one place that picks between them — everything else imports from here, never
 * from file.js/postgres.js directly.
 */
const STORE = (process.env.STORE || 'file').toLowerCase();

const store = STORE === 'postgres' ? await import('./postgres.js') : await import('./file.js');

/** Called once by server.js before it starts accepting requests. file.js needs no boot step
 *  (every read/write is already correct on first call); postgres.js hydrates the coach_config
 *  singleton so Coach's isEnabled()/isConnected() are correct immediately — see that file's
 *  header for why this is a short blocking read rather than a lazy background warm-up. */
export async function init() {
  if (typeof store.init === 'function') await store.init();
}

export const STORE_KIND = STORE;
export default store;
