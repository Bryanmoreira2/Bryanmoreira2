import { describe, expect, it } from 'vitest';
import { avaliarAlerta } from '../src/modules/secretaria/frequencia.js';
import { contexto, diasAtras } from './helpers.js';

async function preparar() {
  const ctx = await contexto();
  const a = await ctx.lider.post('/api/jovens').send({ nome: 'Ana', dataIngresso: diasAtras(60) });
  const b = await ctx.lider.post('/api/jovens').send({ nome: 'Bruno', dataIngresso: diasAtras(60) });
  const at = await ctx.lider.post('/api/secretaria/atividades').send({ nome: 'Culto' });
  return { ...ctx, ana: a.body.id as number, bruno: b.body.id as number, atividade: at.body.id as number };
}

async function chamadaCompleta(ctx: Awaited<ReturnType<typeof preparar>>, data: string, marc: Record<number, 'PRESENTE' | 'AUSENTE'>) {
  const c = await ctx.sec.post('/api/secretaria/chamadas').send({ atividadeId: ctx.atividade, data });
  const marcacoes = Object.entries(marc).map(([jovemId, status]) => ({ jovemId: Number(jovemId), status }));
  await ctx.sec.put(`/api/secretaria/chamadas/${c.body.id}/presencas`).send({ marcacoes });
  const f = await ctx.sec.post(`/api/secretaria/chamadas/${c.body.id}/finalizacao`);
  expect(f.status).toBe(200);
  return c.body.id as number;
}

describe('chamadas', () => {
  it('fluxo completo: abre, marca, finaliza e gera mini relatório (critério 2)', async () => {
    const ctx = await preparar();
    const c = await ctx.sec.post('/api/secretaria/chamadas').send({ atividadeId: ctx.atividade, data: diasAtras(1) });
    expect(c.status).toBe(201);
    expect(c.body.presencas).toHaveLength(2);

    await ctx.sec.put(`/api/secretaria/chamadas/${c.body.id}/presencas/${ctx.ana}`).send({ status: 'PRESENTE' });
    const pend = await ctx.sec.post(`/api/secretaria/chamadas/${c.body.id}/finalizacao`);
    expect(pend.status).toBe(422);
    expect(pend.body.erro.codigo).toBe('MARCACOES_PENDENTES');

    // correção durante chamada aberta (RF-015)
    await ctx.sec.put(`/api/secretaria/chamadas/${c.body.id}/presencas/${ctx.bruno}`).send({ status: 'PRESENTE' });
    await ctx.sec.put(`/api/secretaria/chamadas/${c.body.id}/presencas/${ctx.bruno}`).send({ status: 'AUSENTE' });

    const fin = await ctx.sec.post(`/api/secretaria/chamadas/${c.body.id}/finalizacao`);
    expect(fin.status).toBe(200);
    expect(fin.body).toMatchObject({ totalPresentes: 1, totalAusentes: 1, percentualPresenca: 50, presentes: ['Ana'], ausentes: ['Bruno'] });
    expect(fin.body.finalizadaPor).toBe('Secretário');

    // após finalizar, marcação direta é bloqueada
    const bloq = await ctx.sec.put(`/api/secretaria/chamadas/${c.body.id}/presencas/${ctx.bruno}`).send({ status: 'PRESENTE' });
    expect(bloq.status).toBe(422);
  });

  it('correção de chamada finalizada exige o líder e preserva o original (RN-036)', async () => {
    const ctx = await preparar();
    const id = await chamadaCompleta(ctx, diasAtras(1), { [ctx.ana]: 'AUSENTE', [ctx.bruno]: 'PRESENTE' });
    expect((await ctx.sec.post(`/api/secretaria/chamadas/${id}/correcoes`).send({ jovemId: ctx.ana, status: 'PRESENTE', justificativa: 'x' })).status).toBe(403);
    const sol = await ctx.sec.post(`/api/secretaria/chamadas/${id}/solicitacoes-correcao`).send({ jovemId: ctx.ana, status: 'PRESENTE', justificativa: 'Chegou atrasada' });
    expect(sol.status).toBe(201);
    const cor = await ctx.lider.post(`/api/secretaria/chamadas/${id}/correcoes`).send({ jovemId: ctx.ana, status: 'PRESENTE', justificativa: 'Confirmado', solicitacaoId: sol.body.id });
    expect(cor.status).toBe(200);
    expect(cor.body.correcoes[0]).toMatchObject({ statusAnterior: 'AUSENTE', statusNovo: 'PRESENTE' });
    expect(cor.body.presencas.find((p: { jovemId: number }) => p.jovemId === ctx.ana).status).toBe('PRESENTE');
  });

  it('elegibilidade histórica: ingresso posterior não gera falta retroativa (RN-037)', async () => {
    const ctx = await preparar();
    await chamadaCompleta(ctx, diasAtras(20), { [ctx.ana]: 'PRESENTE', [ctx.bruno]: 'PRESENTE' });
    const novo = await ctx.lider.post('/api/jovens').send({ nome: 'Carla', dataIngresso: diasAtras(5) });
    await chamadaCompleta(ctx, diasAtras(2), { [ctx.ana]: 'PRESENTE', [ctx.bruno]: 'PRESENTE', [novo.body.id]: 'PRESENTE' });
    const f = await ctx.sec.get(`/api/jovens/${novo.body.id}/frequencia`);
    expect(f.body).toMatchObject({ atividadesElegiveis: 1, presencas: 1, percentual: 100 });
  });

  it('jovem inativo deixa de ser elegível, sem reescrever o passado', async () => {
    const ctx = await preparar();
    await chamadaCompleta(ctx, diasAtras(10), { [ctx.ana]: 'PRESENTE', [ctx.bruno]: 'AUSENTE' });
    await ctx.lider.patch(`/api/jovens/${ctx.bruno}/situacao`).send({ situacao: 'INATIVO', desde: diasAtras(5) });
    const c = await ctx.sec.post('/api/secretaria/chamadas').send({ atividadeId: ctx.atividade, data: diasAtras(1) });
    expect(c.body.presencas.map((p: { nome: string }) => p.nome)).toEqual(['Ana']);
    const f = await ctx.sec.get(`/api/jovens/${ctx.bruno}/frequencia`);
    expect(f.body.atividadesElegiveis).toBe(1);
  });

  it('frequência sem atividades elegíveis retorna "sem dados" (null)', async () => {
    const ctx = await preparar();
    const f = await ctx.sec.get(`/api/jovens/${ctx.ana}/frequencia`);
    expect(f.body.percentual).toBeNull();
  });

  it('alerta após 2 faltas consecutivas e não altera a situação (critério 4)', async () => {
    const ctx = await preparar();
    await chamadaCompleta(ctx, diasAtras(14), { [ctx.ana]: 'PRESENTE', [ctx.bruno]: 'PRESENTE' });
    await chamadaCompleta(ctx, diasAtras(7), { [ctx.ana]: 'PRESENTE', [ctx.bruno]: 'AUSENTE' });
    await chamadaCompleta(ctx, diasAtras(1), { [ctx.ana]: 'PRESENTE', [ctx.bruno]: 'AUSENTE' });
    const alertas = await ctx.sec.get('/api/secretaria/alertas-frequencia');
    expect(alertas.body).toHaveLength(1);
    expect(alertas.body[0].nome).toBe('Bruno');
    const j = await ctx.sec.get(`/api/jovens/${ctx.bruno}`);
    expect(j.body.situacao).toBe('ATIVO');
  });

  it('regra de alerta por percentual nas últimas 4', () => {
    const P = { status: 'PRESENTE' }, A = { status: 'AUSENTE' };
    expect(avaliarAlerta([P, A, A, P]).ativo).toBe(false); // 50% não é inferior a 50%
    expect(avaliarAlerta([A, P, A, A]).ativo).toBe(true); // 25%
    expect(avaliarAlerta([A, P, A]).ativo).toBe(false); // menos de 4 e sem 2 consecutivas
    expect(avaliarAlerta([A, A]).motivos).toEqual(['2 faltas consecutivas']);
  });

  it('gera PDF da chamada e da frequência com numeração', async () => {
    const ctx = await preparar();
    const id = await chamadaCompleta(ctx, diasAtras(1), { [ctx.ana]: 'PRESENTE', [ctx.bruno]: 'AUSENTE' });
    const pdf = await ctx.sec.get(`/api/relatorios/secretaria/chamadas/${id}`).buffer(true);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const geral = await ctx.sec.get('/api/relatorios/secretaria');
    expect(geral.status).toBe(200);
    const lista = await ctx.sec.get('/api/relatorios');
    expect(lista.body.map((r: { numero: string }) => r.numero)).toEqual([
      expect.stringMatching(/^SEC-\d{4}-0001$/),
      expect.stringMatching(/^CHM-\d{4}-0001$/),
    ]);
  });
});
