import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

function required(name: string, fallbackForDev?: string): string {
  const value = process.env[name] ?? (process.env.NODE_ENV !== 'production' ? fallbackForDev : undefined);
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3333),
  databasePath: process.env.DATABASE_PATH ?? './data/nexo.db',
  jwtSecret: required('JWT_SECRET', 'dev-apenas-local-nao-usar-em-producao-0000'),
  sessionHours: Number(process.env.SESSION_HOURS ?? 12),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  backupDir: process.env.BACKUP_DIR ?? './backups',
  isProduction: process.env.NODE_ENV === 'production',
  bcryptRounds: process.env.NODE_ENV === 'test' ? 4 : 12,
};

if (config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres.');
}
