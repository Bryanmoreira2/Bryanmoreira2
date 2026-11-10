import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../../config.js';
import { one, run, type DB } from '../../db/connection.js';
import { auditar } from '../../lib/audit.js';
import { AppError, badRequest, unauthorized } from '../../lib/errors.js';
import { parse } from '../../lib/validation.js';
import { autenticar, carregarUsuario, COOKIE_SESSAO, emitirToken, usuario } from '../../middleware/auth.js';

export const SENHA_MINIMA = 10;
export const esquemaSenha = z.string().min(SENHA_MINIMA, `A senha deve ter pelo menos ${SENHA_MINIMA} caracteres.`).max(200);

/** Limite simples de tentativas por e-mail+IP para mitigar força bruta. */
let ficticio: string | undefined;
const hashFicticio = () => (ficticio ??= bcrypt.hashSync('senha-ficticia', config.bcryptRounds));

const tentativas = new Map<string, { n: number; ate: number }>();
const MAX_TENTATIVAS = 5;
const JANELA_MS = 15 * 60 * 1000;

export function authRouter(db: DB) {
  const r = Router();

  r.post('/login', async (req, res) => {
    const { email, senha } = parse(z.object({ email: z.string().trim().email(), senha: z.string().min(1) }), req.body);
    const chave = `${email.toLowerCase()}|${req.ip}`;
    const t = tentativas.get(chave);
    if (t && t.n >= MAX_TENTATIVAS && t.ate > Date.now()) {
      throw new AppError(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Aguarde alguns minutos.');
    }
    const u = one<{ id: number; senha_hash: string; ativo: number }>(
      db,
      'SELECT id, senha_hash, ativo FROM usuarios WHERE email = ?',
      email,
    );
    // Compara mesmo sem usuário para não revelar e-mails cadastrados pelo tempo de resposta.
    const ok = await bcrypt.compare(senha, u?.senha_hash ?? hashFicticio());
    if (!u || !ok || !u.ativo) {
      tentativas.set(chave, { n: (t && t.ate > Date.now() ? t.n : 0) + 1, ate: Date.now() + JANELA_MS });
      throw unauthorized('E-mail ou senha incorretos.');
    }
    tentativas.delete(chave);
    const token = emitirToken(u.id);
    res.cookie(COOKIE_SESSAO, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      maxAge: config.sessionHours * 3600 * 1000,
      path: '/',
    });
    auditar(db, u.id, 'LOGIN', 'usuario', u.id);
    res.json({ usuario: carregarUsuario(db, u.id) });
  });

  r.post('/logout', (_req, res) => {
    res.clearCookie(COOKIE_SESSAO, { path: '/' });
    res.status(204).end();
  });

  r.get('/me', autenticar(db), (req, res) => {
    res.json({ usuario: usuario(req) });
  });

  r.post('/senha', autenticar(db), async (req, res) => {
    const u = usuario(req);
    const { senhaAtual, novaSenha } = parse(z.object({ senhaAtual: z.string().min(1), novaSenha: esquemaSenha }), req.body);
    const row = one<{ senha_hash: string }>(db, 'SELECT senha_hash FROM usuarios WHERE id = ?', u.id)!;
    if (!(await bcrypt.compare(senhaAtual, row.senha_hash))) throw badRequest('Senha atual incorreta.');
    run(db, "UPDATE usuarios SET senha_hash = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", await bcrypt.hash(novaSenha, config.bcryptRounds), u.id);
    auditar(db, u.id, 'ALTERAR_SENHA', 'usuario', u.id);
    res.status(204).end();
  });

  return r;
}
