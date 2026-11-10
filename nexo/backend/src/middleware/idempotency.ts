import type { NextFunction, Request, Response } from 'express';
import { one, run, type DB } from '../db/connection.js';
import { conflict } from '../lib/errors.js';

/**
 * Se o cliente enviar `Idempotency-Key`, a primeira resposta bem-sucedida é
 * guardada e devolvida em reenvios, evitando lançamentos duplicados após
 * falhas de rede (RNF-008).
 */
export function idempotente(db: DB) {
  return (req: Request, res: Response, next: NextFunction) => {
    const chave = req.header('Idempotency-Key');
    if (!chave || !req.usuario || req.method !== 'POST') return next();
    if (chave.length > 128) return next(conflict('CHAVE_INVALIDA', 'Idempotency-Key muito longa.'));
    const rota = `${req.method} ${req.baseUrl}${req.path}`;
    const salvo = one<{ rota: string; status_http: number; resposta_json: string }>(
      db,
      'SELECT rota, status_http, resposta_json FROM idempotencia WHERE chave = ? AND usuario_id = ?',
      chave,
      req.usuario.id,
    );
    if (salvo) {
      if (salvo.rota !== rota) return next(conflict('CHAVE_REUTILIZADA', 'Idempotency-Key já usada em outra operação.'));
      res.setHeader('Idempotent-Replay', 'true');
      return res.status(salvo.status_http).json(JSON.parse(salvo.resposta_json));
    }
    const json = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode < 300) {
        run(
          db,
          'INSERT OR IGNORE INTO idempotencia (chave, usuario_id, rota, status_http, resposta_json) VALUES (?, ?, ?, ?, ?)',
          chave,
          req.usuario!.id,
          rota,
          res.statusCode,
          JSON.stringify(body),
        );
      }
      return json(body);
    };
    next();
  };
}
