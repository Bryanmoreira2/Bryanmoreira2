import { Router } from 'express';
import { z } from 'zod';
import { all, type DB } from '../../db/connection.js';
import { dataISO, parse } from '../../lib/validation.js';
import { somenteLider } from '../../middleware/auth.js';

export function auditoriaRouter(db: DB) {
  const r = Router();
  r.use(somenteLider());
  r.get('/', (req, res) => {
    const f = parse(
      z.object({
        entidade: z.string().max(40).optional(),
        acao: z.string().max(60).optional(),
        inicio: dataISO.optional(),
        fim: dataISO.optional(),
        limite: z.coerce.number().int().min(1).max(1000).default(200),
      }),
      req.query,
    );
    const rows = all<{ detalhes: string | null }>(
      db,
      `SELECT a.id, a.acao, a.entidade, a.entidade_id AS entidadeId, a.detalhes_json AS detalhes, a.criado_em AS criadoEm, u.nome AS usuario
         FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
        WHERE (? IS NULL OR a.entidade = ?) AND (? IS NULL OR a.acao = ?)
          AND (? IS NULL OR substr(a.criado_em, 1, 10) >= ?) AND (? IS NULL OR substr(a.criado_em, 1, 10) <= ?)
        ORDER BY a.id DESC LIMIT ?`,
      f.entidade ?? null, f.entidade ?? null, f.acao ?? null, f.acao ?? null,
      f.inicio ?? null, f.inicio ?? null, f.fim ?? null, f.fim ?? null, f.limite,
    );
    res.json(rows.map((r) => ({ ...r, detalhes: r.detalhes ? JSON.parse(r.detalhes) : null })));
  });
  return r;
}
