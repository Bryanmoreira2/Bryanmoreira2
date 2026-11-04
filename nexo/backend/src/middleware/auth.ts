import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { all, one, type DB } from '../db/connection.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export type Funcao = 'LIDER' | 'SECRETARIO' | 'TESOUREIRO';
export const FUNCOES: Funcao[] = ['LIDER', 'SECRETARIO', 'TESOUREIRO'];

export interface UsuarioAutenticado {
  id: number;
  nome: string;
  email: string;
  funcoes: Funcao[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: UsuarioAutenticado;
    }
  }
}

export const COOKIE_SESSAO = 'nexo_sessao';

export function emitirToken(usuarioId: number): string {
  return jwt.sign({ sub: String(usuarioId) }, config.jwtSecret, {
    expiresIn: `${config.sessionHours}h`,
    algorithm: 'HS256',
  });
}

export function carregarUsuario(db: DB, id: number): UsuarioAutenticado | undefined {
  const u = one<{ id: number; nome: string; email: string; ativo: number }>(
    db,
    'SELECT id, nome, email, ativo FROM usuarios WHERE id = ?',
    id,
  );
  if (!u || !u.ativo) return undefined;
  const funcoes = all<{ funcao: Funcao }>(db, 'SELECT funcao FROM usuario_funcoes WHERE usuario_id = ?', id).map(
    (f) => f.funcao,
  );
  return { id: u.id, nome: u.nome, email: u.email, funcoes };
}

/**
 * Autenticação a cada requisição (RN-030). O usuário e as funções são relidos
 * do banco, de modo que revogações e desativações valem imediatamente (RN-007).
 */
export function autenticar(db: DB) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const token = req.cookies?.[COOKIE_SESSAO] ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    if (!token) return next(unauthorized());
    try {
      const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      const usuario = carregarUsuario(db, Number(payload.sub));
      if (!usuario) return next(unauthorized('Sessão inválida ou usuário desativado.'));
      req.usuario = usuario;
      next();
    } catch {
      next(unauthorized('Sessão expirada ou inválida.'));
    }
  };
}

/** Autorização validada no backend (RN-031). Líder tem acesso geral (RN-001). */
export function exigir(...funcoes: Funcao[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const u = req.usuario;
    if (!u) return next(unauthorized());
    const permitido = u.funcoes.includes('LIDER') || funcoes.some((f) => u.funcoes.includes(f));
    if (!permitido) return next(forbidden());
    next();
  };
}

export const somenteLider = () => exigir('LIDER');

export function usuario(req: Request): UsuarioAutenticado {
  if (!req.usuario) throw unauthorized();
  return req.usuario;
}

export const ehLider = (u: UsuarioAutenticado) => u.funcoes.includes('LIDER');
