-- The user's language (docs/spec.md §16, ADR 0015): the app after sign-in and every e-mail speak it.
-- Sign-up writes the language of the page it came from; the users before it signed up in Russian.
ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ru'));
UPDATE users SET locale = 'ru';
