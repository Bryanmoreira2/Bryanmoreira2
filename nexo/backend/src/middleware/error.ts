import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors.js';

export function tratarErros(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ erro: { codigo: err.code, mensagem: err.message, detalhes: err.details } });
  }
  if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
    return res.status(400).json({ erro: { codigo: 'JSON_INVALIDO', mensagem: 'Corpo da requisição inválido.' } });
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/UNIQUE constraint failed/.test(msg)) {
    return res.status(409).json({ erro: { codigo: 'DUPLICADO', mensagem: 'Registro duplicado.' } });
  }
  if (/CHECK constraint failed|FOREIGN KEY constraint failed/.test(msg)) {
    return res.status(422).json({ erro: { codigo: 'DADOS_INCONSISTENTES', mensagem: 'Dados inconsistentes.' } });
  }
  if (process.env.NODE_ENV !== 'test') console.error(err);
  res.status(500).json({ erro: { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno do servidor.' } });
}
