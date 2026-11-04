import { run, type DB } from '../db/connection.js';

/** Registra operação sensível na trilha de auditoria (RF-040, RN-032). */
export function auditar(
  db: DB,
  usuarioId: number | null,
  acao: string,
  entidade: string,
  entidadeId: number | string | null,
  detalhes?: unknown,
): void {
  run(
    db,
    'INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, detalhes_json) VALUES (?, ?, ?, ?, ?)',
    usuarioId,
    acao,
    entidade,
    entidadeId === null ? null : String(entidadeId),
    detalhes === undefined ? null : JSON.stringify(detalhes),
  );
}
