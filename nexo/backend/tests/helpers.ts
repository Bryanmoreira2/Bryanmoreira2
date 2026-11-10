import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { openDatabase, run, type DB } from '../src/db/connection.js';

export const SENHA = 'senha-de-teste-123';

export async function contexto() {
  const db: DB = openDatabase(':memory:');
  const app = createApp(db);
  const hash = bcrypt.hashSync(SENHA, 4);
  const criar = (nome: string, email: string, funcoes: string[]) => {
    const { id } = run(db, 'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)', nome, email, hash);
    for (const f of funcoes) run(db, 'INSERT INTO usuario_funcoes (usuario_id, funcao) VALUES (?, ?)', id, f);
    return id;
  };
  criar('Líder', 'lider@t.local', ['LIDER']);
  criar('Secretário', 'sec@t.local', ['SECRETARIO']);
  criar('Tesoureiro', 'tes@t.local', ['TESOUREIRO']);

  const login = async (email: string) => {
    const agent = request.agent(app);
    const r = await agent.post('/api/auth/login').send({ email, senha: SENHA });
    if (r.status !== 200) throw new Error(`login falhou: ${r.status} ${JSON.stringify(r.body)}`);
    return agent;
  };

  return {
    db,
    app,
    lider: await login('lider@t.local'),
    sec: await login('sec@t.local'),
    tes: await login('tes@t.local'),
    login,
  };
}

export const diasAtras = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
