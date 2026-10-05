// A D1 binding over a node:sqlite database, for running the clx-edge worker in tests: prepare, bind,
// first, run, and batch as one transaction (as D1 runs it), each answer with `meta.size_after`.
import type { DatabaseSync } from 'node:sqlite';

type Arg = string | number | null;

export function d1(db: DatabaseSync, opts: { size?: () => number } = {}): D1Database {
  const size = opts.size ?? (() => {
    const page = db.prepare('PRAGMA page_size').get() as { page_size: number };
    const count = db.prepare('PRAGMA page_count').get() as { page_count: number };
    return page.page_size * count.page_count;
  });
  const statement = (sql: string, args: Arg[] = []) => ({
    sql,
    args,
    bind: (...more: Arg[]) => statement(sql, more),
    first: async <T>(col?: string) => {
      const row = db.prepare(sql).get(...args) as Record<string, unknown> | undefined;
      return (col ? (row?.[col] ?? null) : (row ?? null)) as T;
    },
    all: async () => ({ results: db.prepare(sql).all(...args), meta: { size_after: size() } }),
    run: async () => ({ results: [], meta: { changes: Number(db.prepare(sql).run(...args).changes), size_after: size() } }),
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: ReturnType<typeof statement>[]) => {
      db.exec('BEGIN');
      try {
        const out = list.map((s) => ({ results: [], meta: { changes: Number(db.prepare(s.sql).run(...s.args).changes), size_after: size() } }));
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
}
