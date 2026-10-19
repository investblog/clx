-- Where an account came from (docs/spec.md §17, ADR 0031): the bot's start parameter
-- (t.me/<bot>?start=<source>), written once, when the bot makes the account; null otherwise.
ALTER TABLE users ADD COLUMN source TEXT;
