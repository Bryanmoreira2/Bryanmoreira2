import { describe, expect, it } from 'vitest';
import { contexto, diasAtras } from './helpers.js';

async function preparar() {
  const ctx = await contexto();
  const banco = (await ctx.lider.post('/api/tesouraria/contas').send({ nome: 'Banco', tipo: 'BANCO' })).body.id as number;
  const caixa = (await ctx.lider.post('/api/tesouraria/contas').send({ nome: 'Caixa', tipo: 'CAIXA' })).body.id as number;
  return { ...ctx, banco, caixa };
}

const saldo = async (ctx: Awaited<ReturnType<typeof preparar>>, id: number) =>
  (await ctx.tes.get(`/api/tesouraria/contas/${id}/saldo`)).body.saldoCentavos as number;

// mês anterior completo, sempre fechável
const d = new Date();
const mesAnt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 15));
const ANO = mesAnt.getUTCFullYear(), MES = mesAnt.getUTCMonth() + 1;
const DIA_MES_ANT = mesAnt.toISOString().slice(0, 10);

describe('tesouraria', () => {
  it('entradas e saídas atualizam os saldos (critério 5)', async () => {
    const ctx = await preparar();
    await ctx.tes.post('/api/tesouraria/movimentacoes').send({ contaId: ctx.caixa, tipo: 'ENTRADA', valorCentavos: 10050, data: diasAtras(1), categoria: 'Ofertas', descricao: 'Oferta' });
    await ctx.tes.post('/api/tesouraria/movimentacoes').send({ contaId: ctx.caixa, tipo: 'SAIDA', valorCentavos: 2525, data: diasAtras(1), categoria: 'Lanche', descricao: 'Lanche' });
    expect(await saldo(ctx, ctx.caixa)).toBe(7525);
  });

  it('rejeita valores zero, negativos ou fracionados (RN-026)', async () => {
    const ctx = await preparar();
    for (const valorCentavos of [0, -100, 10.5]) {
      const r = await ctx.tes.post('/api/tesouraria/movimentacoes').send({ contaId: ctx.caixa, tipo: 'ENTRADA', valorCentavos, data: diasAtras(1), categoria: 'x', descricao: 'x' });
      expect(r.status).toBe(400);
    }
  });

  it('transferência move saldo sem gerar receita/despesa (RN-020)', async () => {
    const ctx = await preparar();
    await ctx.tes.post('/api/tesouraria/movimentacoes').send({ contaId: ctx.caixa, tipo: 'ENTRADA', valorCentavos: 50000, data: diasAtras(2), categoria: 'Ofertas', descricao: 'Oferta' });
    const t = await ctx.tes.post('/api/tesouraria/transferencias').send({ contaOrigemId: ctx.caixa, contaDestinoId: ctx.banco, valorCentavos: 30000, data: diasAtras(1), descricao: 'Depósito' });
    expect(t.status).toBe(201);
    expect(await saldo(ctx, ctx.caixa)).toBe(20000);
    expect(await saldo(ctx, ctx.banco)).toBe(30000);
    const r = await ctx.tes.get(`/api/tesouraria/resultado?inicio=${diasAtras(5)}&fim=${diasAtras(0)}`);
    expect(r.body).toMatchObject({ totalReceitasCentavos: 50000, totalDespesasCentavos: 0 });
  });

  it('venda no cartão é recebível, não saldo; liquidação não duplica receita (critérios 6 e 7)', async () => {
    const ctx = await preparar();
    const rec = await ctx.tes.post('/api/tesouraria/recebiveis').send({ dataVenda: diasAtras(3), valorBrutoCentavos: 10000, taxaCentavos: 300, categoria: 'Cantina', descricao: 'Venda', contaDestinoId: ctx.banco });
    expect(rec.status).toBe(201);
    expect(rec.body.valorLiquidoCentavos).toBe(9700);
    let pos = (await ctx.tes.get('/api/tesouraria/posicao')).body;
    expect(pos).toMatchObject({ disponivelCentavos: 0, aReceberCentavos: 9700 });

    const liq = await ctx.tes.post(`/api/tesouraria/recebiveis/${rec.body.id}/liquidacao`).send({ data: diasAtras(1) });
    expect(liq.status).toBe(200);
    pos = (await ctx.tes.get('/api/tesouraria/posicao')).body;
    expect(pos).toMatchObject({ disponivelCentavos: 9700, aReceberCentavos: 0 });
    // segunda liquidação é bloqueada
    expect((await ctx.tes.post(`/api/tesouraria/recebiveis/${rec.body.id}/liquidacao`).send({ data: diasAtras(1) })).status).toBe(422);

    const r = (await ctx.tes.get(`/api/tesouraria/resultado?inicio=${diasAtras(10)}&fim=${diasAtras(0)}`)).body;
    expect(r.totalReceitasCentavos).toBe(10000); // bruto, uma única vez
    expect(r.totalDespesasCentavos).toBe(300); // taxa
    expect(r.resultadoCentavos).toBe(9700);
  });

  it('estorno preserva o original e corrige o saldo (RN-025)', async () => {
    const ctx = await preparar();
    const m = await ctx.tes.post('/api/tesouraria/movimentacoes').send({ contaId: ctx.banco, tipo: 'SAIDA', valorCentavos: 1000, data: diasAtras(1), categoria: 'X', descricao: 'Errado' });
    const e = await ctx.tes.post(`/api/tesouraria/movimentacoes/${m.body.id}/estorno`).send({ justificativa: 'Lançado em duplicidade' });
    expect(e.status).toBe(201);
    expect(await saldo(ctx, ctx.banco)).toBe(0);
    expect((await ctx.tes.post(`/api/tesouraria/movimentacoes/${m.body.id}/estorno`).send({ justificativa: 'de novo' })).status).toBe(422);
    const lista = (await ctx.tes.get('/api/tesouraria/movimentacoes')).body;
    expect(lista).toHaveLength(2);
    const r = (await ctx.tes.get(`/api/tesouraria/resultado?inicio=${diasAtras(5)}&fim=${diasAtras(0)}`)).body;
    expect(r.totalDespesasCentavos).toBe(0);
  });

  it('Idempotency-Key evita lançamento duplicado em reenvio (RNF-008)', async () => {
    const ctx = await preparar();
    const body = { contaId: ctx.caixa, tipo: 'ENTRADA', valorCentavos: 500, data: diasAtras(1), categoria: 'x', descricao: 'x' };
    const a = await ctx.tes.post('/api/tesouraria/movimentacoes').set('Idempotency-Key', 'abc-1').send(body);
    const b = await ctx.tes.post('/api/tesouraria/movimentacoes').set('Idempotency-Key', 'abc-1').send(body);
    expect(b.headers['idempotent-replay']).toBe('true');
    expect(b.body.id).toBe(a.body.id);
    expect(await saldo(ctx, ctx.caixa)).toBe(500);
  });

  it('fechamento: tesoureiro prepara, só o líder aprova e o período bloqueia (critérios 8 e 9)', async () => {
    const ctx = await preparar();
    await ctx.tes.post('/api/tesouraria/movimentacoes').send({ contaId: ctx.caixa, tipo: 'ENTRADA', valorCentavos: 1000, data: DIA_MES_ANT, categoria: 'Ofertas', descricao: 'Oferta' });
    const f = await ctx.tes.post('/api/tesouraria/fechamentos').send({ ano: ANO, mes: MES });
    expect(f.status).toBe(201);
    expect(f.body.resumo.resultado.totalReceitasCentavos).toBe(1000);
    expect((await ctx.tes.post(`/api/tesouraria/fechamentos/${f.body.id}/envio`)).body.status).toBe('ENVIADO');
    expect((await ctx.tes.post(`/api/tesouraria/fechamentos/${f.body.id}/aprovacao`).send({ decisao: 'APROVAR' })).status).toBe(403);
    expect((await ctx.lider.post(`/api/tesouraria/fechamentos/${f.body.id}/aprovacao`).send({ decisao: 'APROVAR' })).body.status).toBe('APROVADO');

    const bloq = await ctx.tes.post('/api/tesouraria/movimentacoes').send({ contaId: ctx.caixa, tipo: 'ENTRADA', valorCentavos: 1000, data: DIA_MES_ANT, categoria: 'x', descricao: 'x' });
    expect(bloq.status).toBe(409);
    expect(bloq.body.erro.codigo).toBe('PERIODO_FECHADO');

    expect((await ctx.lider.post(`/api/tesouraria/fechamentos/${f.body.id}/reabertura`).send({})).status).toBe(400);
    const re = await ctx.lider.post(`/api/tesouraria/fechamentos/${f.body.id}/reabertura`).send({ justificativa: 'Lançamento esquecido' });
    expect(re.body.status).toBe('REABERTO');
    expect(re.body.eventos.map((e: { evento: string }) => e.evento)).toEqual(['PREPARADO', 'ENVIADO', 'APROVADO', 'REABERTO']);
    const ok = await ctx.tes.post('/api/tesouraria/movimentacoes').send({ contaId: ctx.caixa, tipo: 'ENTRADA', valorCentavos: 1000, data: DIA_MES_ANT, categoria: 'x', descricao: 'x' });
    expect(ok.status).toBe(201);

    const pdf = await ctx.tes.get(`/api/relatorios/tesouraria/fechamentos/${f.body.id}`).buffer(true);
    expect(pdf.status).toBe(200);
  });

  it('devolução exige justificativa', async () => {
    const ctx = await preparar();
    const f = await ctx.tes.post('/api/tesouraria/fechamentos').send({ ano: ANO, mes: MES });
    await ctx.tes.post(`/api/tesouraria/fechamentos/${f.body.id}/envio`);
    expect((await ctx.lider.post(`/api/tesouraria/fechamentos/${f.body.id}/aprovacao`).send({ decisao: 'DEVOLVER' })).status).toBe(422);
    const dev = await ctx.lider.post(`/api/tesouraria/fechamentos/${f.body.id}/aprovacao`).send({ decisao: 'DEVOLVER', justificativa: 'Conferir caixa' });
    expect(dev.body.status).toBe('DEVOLVIDO');
    expect((await ctx.tes.post('/api/tesouraria/fechamentos').send({ ano: ANO, mes: MES })).body.status).toBe('RASCUNHO');
  });

  it('relatório financeiro em PDF', async () => {
    const ctx = await preparar();
    await ctx.tes.post('/api/tesouraria/movimentacoes').send({ contaId: ctx.caixa, tipo: 'ENTRADA', valorCentavos: 1000, data: diasAtras(1), categoria: 'Ofertas', descricao: 'Oferta' });
    const r = await ctx.tes.get(`/api/relatorios/tesouraria?inicio=${diasAtras(30)}&fim=${diasAtras(0)}`).buffer(true);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
  });
});
