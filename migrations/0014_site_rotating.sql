-- The seed of a rotation under way (docs/spec.md §5, §15): written before the new route is made, so a
-- rotation that dies after Cloudflare made it is resumed with the same seed (its route adopted by
-- pattern), and a delete or disconnect meanwhile finds that route by its pattern. Null otherwise.
ALTER TABLE sites ADD COLUMN rotating TEXT;
