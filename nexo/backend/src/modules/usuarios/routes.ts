import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../../config.js';
import { all, one, run, tx, type DB } from '../../db/connection.js';
import { auditar } from '../../lib/audit.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import { idParam, parse, texto } from '../../lib/validation.js';
import { FUNCOES, somenteLider, usuario, type Funcao } from '../../middleware/auth.js';
import { esquemaSenha } from '../auth/routes.js';

const funcoesSchema = z.array(z.enum(FUNCOES as [Funcao, ...Funcao[]])).max(3).transform((f) => [...new Set(f)]);

interface UsuarioRow {
  id: number;
  nome: string;
  email: string;
  ativo: number;
  criado_em: string;
  funcoes: string | null;
}

function listar(db: DB, id?: number) {
  const rows = all<UsuarioRow>(
    db,
    `SELECT u.id, u.nome, u.email, u.ativo, u.criado_em, GROUP_CONCAT(f.funcao) AS funcoes
       FROM usuarios u LEFT JOIN usuario_funcoes f ON f.usuario_id = u.id
      ${id ? 'WHERE u.id = ?' : ''}
      GROUP BY u.id ORDER BY u.nome`,
    ...(id ? [id] : []),
  );
  return rows.map((u) => ({
    id: u.id,
    nome: u.nome,
    email: u.email,
    ativo: !!u.ativo,
    criadoEm: u.criado_em,
    funcoes: u.funcoes ? u.funcoes.split(',') : [],
  }));
}

function lideresAtivos(db: DB): number {
  return one<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM usuario_funcoes f JOIN usuarios u ON u.id = f.usuario_id WHERE f.funcao = 'LIDER' AND u.ativo = 1`,
  )!.n;
}

/** Gestão de acessos — exclusiva do líder (RF-004, RF-005, RN-003, RN-043). */
export function usuariosRouter(db: DB) {
  const r = Router();
  r.use(somenteLider());

  r.get('/', (_req, res) => res.json(listar(db)));

  r.post('/', async (req, res) => {
    const lider = usuario(req);
    const body = parse(
      z.object({ nome: texto(120), email: z.string().trim().email().max(160), senha: esquemaSenha, funcoes: funcoesSchema }),
      req.body,
    );
    const hash = await bcrypt.hash(body.senha, config.bcryptRounds);
    const id = tx(db, () => {
      if (one(db, 'SELECT 1 FROM usuarios WHERE email = ?', body.email)) throw conflict('EMAIL_EM_USO', 'E-mail já cadastrado.');
      const { id } = run(db, 'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)', body.nome, body.email, hash);
      for (const f of body.funcoes) run(db, 'INSERT INTO usuario_funcoes (usuario_id, funcao, atribuida_por) VALUES (?, ?, ?)', id, f, lider.id);
      auditar(db, lider.id, 'CRIAR_USUARIO', 'usuario', id, { email: body.email, funcoes: body.funcoes });
      return id;
    });
    res.status(201).json(listar(db, id)[0]);
  });

  r.put('/:id/funcoes', (req, res) => {
    const lider = usuario(req);
    const id = parse(idParam, req.params.id);
    const { funcoes } = parse(z.object({ funcoes: funcoesSchema }), req.body);
    tx(db, () => {
      const atual = listar(db, id)[0];
      if (!atual) throw notFound('Usuário');
      if (atual.funcoes.includes('LIDER') && !funcoes.includes('LIDER') && atual.ativo && lideresAtivos(db) <= 1) {
        throw unprocessable('ULTIMO_LIDER', 'Não é possível remover a função do único líder ativo.');
      }
      run(db, 'DELETE FROM usuario_funcoes WHERE usuario_id = ?', id);
      for (const f of funcoes) run(db, 'INSERT INTO usuario_funcoes (usuario_id, funcao, atribuida_por) VALUES (?, ?, ?)', id, f, lider.id);
      auditar(db, lider.id, 'ALTERAR_FUNCOES', 'usuario', id, { antes: atual.funcoes, depois: funcoes });
    });
    res.json(listar(db, id)[0]);
  });

  r.patch('/:id/situacao', (req, res) => {
    const lider = usuario(req);
    const id = parse(idParam, req.params.id);
    const { ativo } = parse(z.object({ ativo: z.boolean() }), req.body);
    tx(db, () => {
      const atual = listar(db, id)[0];
      if (!atual) throw notFound('Usuário');
      if (!ativo && atual.funcoes.includes('LIDER') && atual.ativo && lideresAtivos(db) <= 1) {
        throw unprocessable('ULTIMO_LIDER', 'Não é possível desativar o único líder ativo.');
      }
      run(db, "UPDATE usuarios SET ativo = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", ativo, id);
      auditar(db, lider.id, ativo ? 'REATIVAR_USUARIO' : 'DESATIVAR_USUARIO', 'usuario', id);
    });
    res.json(listar(db, id)[0]);
  });

  r.patch('/:id/senha', async (req, res) => {
    const lider = usuario(req);
    const id = parse(idParam, req.params.id);
    const { senha } = parse(z.object({ senha: esquemaSenha }), req.body);
    if (!listar(db, id)[0]) throw notFound('Usuário');
    run(db, "UPDATE usuarios SET senha_hash = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", await bcrypt.hash(senha, config.bcryptRounds), id);
    auditar(db, lider.id, 'REDEFINIR_SENHA', 'usuario', id);
    res.status(204).end();
  });

  return r;
}
