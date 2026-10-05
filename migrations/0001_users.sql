-- Sign-in (docs/spec.md §9). Until sign-up lands (stage 6), users are made by scripts/user.mjs.
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  -- PBKDF2-SHA256, "<salt b64>:<hash b64>" (src/auth/password.ts)
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);
