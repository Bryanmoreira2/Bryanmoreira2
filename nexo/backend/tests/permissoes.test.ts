import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { contexto } from './helpers.js';

describe('autenticação e permissões', () => {
  it('rejeita acesso sem autenticação', async () => {
    const { app } = await contexto();
    expect((await request(app).get('/api/jovens')).status).toBe(401);
    expect((await request(app).get('/api/tesouraria/contas')).status).toBe(401);
  });

  it('rejeita credenciais inválidas', async () => {
    const { app } = await contexto();
    const r = await request(app).post('/api/auth/login').send({ email: 'lider@t.local', senha: 'errada' });
    expect(r.status).toBe(401);
  });

  it('somente o líder cadastra e edita jovens (critério 1)', async () => {
    const { lider, sec, tes } = await contexto();
    expect((await sec.post('/api/jovens').send({ nome: 'X' })).status).toBe(403);
    expect((await tes.post('/api/jovens').send({ nome: 'X' })).status).toBe(403);
    const r = await lider.post('/api/jovens').send({ nome: 'Maria' });
    expect(r.status).toBe(201);
    expect((await sec.patch(`/api/jovens/${r.body.id}`).send({ nome: 'Y' })).status).toBe(403);
    expect((await sec.patch(`/api/jovens/${r.body.id}/situacao`).send({ situacao: 'INATIVO' })).status).toBe(403);
    expect((await lider.patch(`/api/jovens/${r.body.id}`).send({ nome: 'Maria Clara' })).body.nome).toBe('Maria Clara');
  });

  it('secretário não acessa finanças; tesoureiro não acessa cadastros (critério 3)', async () => {
    const { sec, tes } = await contexto();
    expect((await sec.get('/api/tesouraria/contas')).status).toBe(403);
    expect((await sec.post('/api/tesouraria/movimentacoes').send({})).status).toBe(403);
    expect((await tes.get('/api/jovens')).status).toBe(403);
    expect((await tes.get('/api/secretaria/chamadas')).status).toBe(403);
    expect((await tes.get('/api/relatorios/secretaria')).status).toBe(403);
    expect((await sec.get('/api/relatorios/tesouraria?inicio=2026-01-01&fim=2026-01-31')).status).toBe(403);
  });

  it('somente o líder atribui funções e a revogação vale imediatamente (RN-007)', async () => {
    const { lider, sec, login } = await contexto();
    expect((await sec.post('/api/usuarios').send({})).status).toBe(403);
    const novo = await lider.post('/api/usuarios').send({ nome: 'Aux', email: 'aux@t.local', senha: 'senha-de-teste-123', funcoes: ['SECRETARIO'] });
    expect(novo.status).toBe(201);
    const aux = await login('aux@t.local');
    expect((await aux.get('/api/jovens')).status).toBe(200);
    await lider.put(`/api/usuarios/${novo.body.id}/funcoes`).send({ funcoes: [] });
    expect((await aux.get('/api/jovens')).status).toBe(403);
    await lider.patch(`/api/usuarios/${novo.body.id}/situacao`).send({ ativo: false });
    expect((await aux.get('/api/auth/me')).status).toBe(401);
  });

  it('não permite remover o único líder', async () => {
    const { lider } = await contexto();
    const me = await lider.get('/api/auth/me');
    const r = await lider.put(`/api/usuarios/${me.body.usuario.id}/funcoes`).send({ funcoes: ['TESOUREIRO'] });
    expect(r.status).toBe(422);
  });

  it('auditoria é somente inclusão (RNF-006)', async () => {
    const { db } = await contexto();
    expect(() => db.exec('DELETE FROM auditoria')).toThrow(/somente inclusão/);
    expect(() => db.exec("UPDATE auditoria SET acao = 'x'")).toThrow(/somente inclusão/);
  });
});
