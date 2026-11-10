/**
 * Backup consistente do banco SQLite (RNF-007), via VACUUM INTO.
 * Agende (ex.: cron diário) e teste a restauração periodicamente:
 * restaurar = parar a API e substituir DATABASE_PATH pelo arquivo do backup.
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../src/config.js';

const MANTER = Number(process.env.BACKUP_MANTER ?? 30);
mkdirSync(config.backupDir, { recursive: true });
const destino = resolve(join(config.backupDir, `nexo-${new Date().toISOString().replace(/[:.]/g, '-')}.db`));

const db = new DatabaseSync(config.databasePath, { readOnly: true });
db.prepare('VACUUM INTO ?').run(destino);
db.close();

// Verificação de integridade do arquivo gerado
const check = new DatabaseSync(destino, { readOnly: true });
const ok = (check.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
check.close();
if (ok !== 'ok') {
  console.error(`Backup gerado com falha de integridade: ${ok}`);
  process.exit(1);
}

const antigos = readdirSync(config.backupDir).filter((f) => f.startsWith('nexo-') && f.endsWith('.db')).sort().reverse().slice(MANTER);
for (const f of antigos) rmSync(join(config.backupDir, f));
console.log(`Backup criado: ${destino}`);
