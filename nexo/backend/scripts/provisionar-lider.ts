/**
 * Provisionamento restrito do primeiro líder (RN-042 / DP-007).
 * Não existe cadastro público de administradores: este script deve ser
 * executado por quem tem acesso ao servidor.
 *
 *   NEXO_LIDER_SENHA='...' npm run provisionar-lider -- --nome "Fulano" --email fulano@exemplo.com
 */
import bcrypt from 'bcryptjs';
import { parseArgs } from 'node:util';
import { config } from '../src/config.js';
import { one, openDatabase, run, tx } from '../src/db/connection.js';
import { auditar } from '../src/lib/audit.js';
import { SENHA_MINIMA } from '../src/modules/auth/routes.js';

const { values } = parseArgs({ options: { nome: { type: 'string' }, email: { type: 'string' } } });
const senha = process.env.NEXO_LIDER_SENHA;

if (!values.nome || !values.email || !senha) {
  console.error('Uso: NEXO_LIDER_SENHA=<senha> npm run provisionar-lider -- --nome "Nome" --email email@exemplo.com');
  process.exit(1);
}
if (senha.length < SENHA_MINIMA) {
  console.error(`A senha deve ter pelo menos ${SENHA_MINIMA} caracteres.`);
  process.exit(1);
}

const db = openDatabase(config.databasePath);
const existe = one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM usuario_funcoes WHERE funcao = 'LIDER'")!.n;
if (existe > 0) {
  console.error('Já existe um líder provisionado. Novos acessos devem ser criados pelo líder no sistema.');
  process.exit(1);
}
const hash = bcrypt.hashSync(senha, config.bcryptRounds);
tx(db, () => {
  const { id } = run(db, 'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)', values.nome, values.email, hash);
  run(db, "INSERT INTO usuario_funcoes (usuario_id, funcao) VALUES (?, 'LIDER')", id);
  auditar(db, null, 'PROVISIONAR_LIDER', 'usuario', id, { email: values.email });
});
console.log(`Líder ${values.email} provisionado com sucesso.`);
db.close();
