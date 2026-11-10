import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './schema.js';

export type DB = DatabaseSync;
type Param = SQLInputValue | undefined | boolean;

export function openDatabase(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function norm(params: Param[]): SQLInputValue[] {
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

export function one<T>(db: DB, sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...norm(params)) as T | undefined;
}

export function all<T>(db: DB, sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...norm(params)) as T[];
}

export function run(db: DB, sql: string, ...params: Param[]): { changes: number; id: number } {
  const r = db.prepare(sql).run(...norm(params));
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
}

const depth = new WeakMap<DB, number>();

/** Executa `fn` em transação atômica (RNF-008). Suporta aninhamento via savepoints. */
export function tx<T>(db: DB, fn: () => T): T {
  const d = depth.get(db) ?? 0;
  const sp = `sp_${d}`;
  db.exec(d === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth.set(db, d + 1);
  try {
    const result = fn();
    db.exec(d === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return result;
  } catch (err) {
    db.exec(d === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw err;
  } finally {
    depth.set(db, d);
  }
}
