-- openGym Postgres schema (Supabase). Applied once, by hand, via the Supabase SQL editor
-- or `psql "$DATABASE_URL" -f api/store/schema.sql`. Mirrors the shape of the flat JSON
-- files this replaces (db.json, state-<uid>.json, secret, vapid.json, audit.log,
-- coach.json, coach/<uid>.json, coach-auth-<uid>.json) closely enough that api/store/postgres.js
-- reads/writes rows shaped like the JSON blobs those files used to hold, keeping the
-- migration to Supabase a storage-driver swap rather than a data-model rewrite.

create table if not exists users (
  id          text primary key,           -- crypto.randomBytes(12).toString('base64url')
  name        text not null,
  created     timestamptz not null default now(),
  disabled    boolean not null default false,
  admin       boolean not null default false,
  invited_by  text,
  sv          integer not null default 0, -- session version; bumped by "sign out everywhere"
  last_reminder text                      -- YYYY-MM-DD, last date the day-reminder fired
);

create table if not exists credentials (
  id          text primary key,           -- WebAuthn credential id (base64url)
  user_id     text not null references users(id) on delete cascade,
  public_key  text not null,              -- base64url
  counter     bigint not null default 0,
  transports  jsonb not null default '[]'
);
create index if not exists credentials_user_id_idx on credentials(user_id);

create table if not exists push_subs (
  endpoint    text primary key,
  user_id     text not null references users(id) on delete cascade,
  keys        jsonb not null,             -- { p256dh, auth }
  device_id   text,
  created     timestamptz not null default now()
);
create index if not exists push_subs_user_id_idx on push_subs(user_id);

create table if not exists invites (
  code        text primary key,
  note        text,
  created_by  text references users(id) on delete set null,
  created     timestamptz not null default now(),
  used_by     text references users(id) on delete set null,
  used_at     timestamptz,
  revoked     boolean not null default false
);

-- One row per user's synced app state. `state` is the same blob PUT /api/data has always
-- accepted, minus the device-local `active` field; `rev` is the server-owned optimistic-
-- concurrency counter server.js used to keep as `state._rev` inside the JSON itself. Kept
-- as its own column here so the CAS check (`WHERE rev = $baseRev`) is a normal SQL
-- predicate instead of a round-trip through JSON.
create table if not exists user_state (
  user_id     text primary key references users(id) on delete cascade,
  state       jsonb not null,
  rev         integer not null default 0,
  updated_at  timestamptz not null default now()
);

-- Singleton row (id always 1): the HMAC secret (session cookies, Coach's AES key) that
-- server.js used to generate once into DATA_DIR/secret on first boot.
create table if not exists server_secret (
  id          integer primary key default 1 check (id = 1),
  secret_hex  text not null
);

-- Singleton row (id always 1): VAPID keypair, generated once into DATA_DIR/vapid.json.
create table if not exists vapid_keys (
  id          integer primary key default 1 check (id = 1),
  public_key  text not null,
  private_key text not null
);

-- Appended, never rewritten in place except for retention pruning (mirrors audit.log's
-- JSONL-append-only shape). `seq` replaces the file version's monotonically increasing id.
create table if not exists audit_log (
  seq         bigserial primary key,
  ts          bigint not null,            -- epoch ms, matches the JS Date.now() the app uses elsewhere
  ev          text not null,
  ok          boolean not null default true,
  uid         text,
  name        text,
  tgt         text,
  tname       text,
  msg         text,
  ip          text
);
create index if not exists audit_log_ts_idx on audit_log(ts);

-- Singleton row (id always 1): instance-wide Coach configuration, replacing coach.json.
create table if not exists coach_config (
  id          integer primary key default 1 check (id = 1),
  enabled     boolean not null default false,
  provider    text not null default 'fixture',
  auth_mode   text not null default 'instance',
  auth        jsonb not null default '{}',   -- { [provider]: { type, account, data:<encrypted>, connectedAt } }
  models      jsonb not null default '{}',
  provider_options jsonb not null default '{}',
  bound_uid   jsonb not null default '{}',
  caps        jsonb not null default '{"perProfileDaily":10,"instanceDaily":0}',
  daily_date  text,                          -- instance-wide job-count-today, split into two
  daily_count integer not null default 0,    -- columns so the increment can be a single atomic UPDATE
  community   boolean not null default false,
  log         jsonb not null default '[]'    -- capped to last 100 entries by the app layer
);

-- Per-profile Coach job record, replacing coach/<uid>.json. `daily_date`/`daily_count`
-- split out of the JSON blob for the same reason as coach_config's: enqueue()'s
-- check-cap-then-increment needs a single atomic UPDATE, not a read-modify-write race.
create table if not exists coach_users (
  user_id     text primary key references users(id) on delete cascade,
  daily_date  text,
  daily_count integer not null default 0,
  current     jsonb,                         -- { id, kind, state, startedAt } | null
  pending     jsonb,                          -- proposal awaiting accept/reject | null
  history     jsonb not null default '[]',   -- capped to last 20 entries by the app layer
  share       boolean not null default false -- "compare with others" opt-in
);

-- Per-profile Coach credential, replacing coach-auth-<uid>.json. Only present in
-- authMode='profile'; deliberately its own table rather than a column on user_state,
-- for the same reason the original comment gives: it must never ride along in a
-- state export/backup the way workout data does.
create table if not exists coach_profile_auth (
  user_id     text primary key references users(id) on delete cascade,
  type        text not null,
  account     text,
  data        text not null,                 -- encrypted (AES-256-GCM), same as coach_config.auth[*].data
  connected_at timestamptz not null default now()
);
