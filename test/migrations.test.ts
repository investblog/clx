// Migrations applied over data that is already there, as on the live database (D1 is SQLite).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

/** A database with the migrations up to `last` (by file name) applied. */
function upTo(db: DatabaseSync, from: string, last: string): void {
  for (const file of fs.readdirSync('migrations').filter((f) => f.endsWith('.sql') && f > from && f <= last).sort()) db.exec(fs.readFileSync(path.join('migrations', file), 'utf8'));
}

describe('0020_external_sites over existing sites', () => {
  it('makes every site a zone site and keeps a live zone host unique, an external host unique per user only', () => {
    const db = new DatabaseSync(':memory:');
    upTo(db, '', '0019_partners.sql');
    db.exec("INSERT INTO users (id, email, password_hash, created_at) VALUES (1, 'a@example.com', 'x', 0), (2, 'b@example.com', 'x', 0)");
    db.exec("INSERT INTO edge_accounts (id, user_id, cf_account_id, state, created_at, updated_at) VALUES ('e1', 1, 'c1', 'ready', 0, 0), ('e2', 2, 'c2', 'ready', 0, 0)");
    const old =db.prepare("INSERT INTO sites (id, account_id, user_id, target, host, zone_id, seed, state, revision, created_at, updated_at) VALUES (?, 'e1', 1, ?, ?, 'z', ?, ?, 0, 0, 0)");
    old.run('s1', 'sa', 'example.com', 'a', 'active');
    old.run('s2', 'sb', 'example.com', 'b', 'deleted');
    upTo(db, '0019_partners.sql', '0020_external_sites.sql');
    const site = db.prepare("INSERT INTO sites (id, account_id, user_id, target, host, kind, collector_host, zone_id, seed, state, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'z', ?, ?, 0, 0, 0)");
    expect(db.prepare('SELECT id, kind, collector_host FROM sites ORDER BY id').all()).toEqual([
      { id: 's1', kind: 'zone', collector_host: null },
      { id: 's2', kind: 'zone', collector_host: null },
    ]);
    // A live zone host is still unique across clx.
    expect(() => site.run('s3', 'e2', 2, 'sc', 'example.com', 'zone', null, 'c', 'active')).toThrow(/UNIQUE/u);
    // An external host is another user's to add too, but once per user, as either kind.
    site.run('x1', 'e1', 1, 'sd', 'othersite.net', 'external', 'example.com', 'd', 'active');
    site.run('x2', 'e2', 2, 'se', 'othersite.net', 'external', 'shop.example.org', 'e', 'active');
    expect(() => site.run('x3', 'e1', 1, 'sf', 'othersite.net', 'external', 'example.com', 'f', 'active')).toThrow(/UNIQUE/u);
    expect(() => site.run('x4', 'e1', 1, 'sg', 'example.com', 'external', 'shop.example.com', 'g', 'active')).toThrow(/UNIQUE/u);
    // A deleted row frees its host.
    site.run('x5', 'e1', 1, 'sh', 'old.example.net', 'external', 'example.com', 'h', 'deleted');
    site.run('x6', 'e1', 1, 'si', 'old.example.net', 'external', 'example.com', 'i', 'active');
  });
});
