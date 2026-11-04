import { all, one, type DB } from '../../db/connection.js';
import { limitesDoMes } from '../../lib/dates.js';
import { conflict } from '../../lib/errors.js';

export const CHAVE_CONTA_MAQUININHA = 'conta_destino_maquininha';
export const CATEGORIA_TAXA_CARTAO = 'Taxas de cartão';

/** Período aprovado fica bloqueado para alterações comuns (RF-045, RN-046). */
export function exigirPeriodoAberto(db: DB, data: string): void {
  const [ano, mes] = data.split('-').map(Number);
  const f = one<{ id: number; status: string }>(db, 'SELECT id, status FROM fechamentos WHERE ano = ? AND mes = ?', ano, mes);
  if (f?.status === 'APROVADO') {
    throw conflict('PERIODO_FECHADO', `O período ${String(mes).padStart(2, '0')}/${ano} está fechado e aprovado. Peça ao líder a reabertura.`, { fechamentoId: f.id });
  }
}

/** Saldo calculado a partir das movimentações registradas (RF-028, RN-019). */
export function saldoConta(db: DB, contaId: number, ate?: string): number {
  return one<{ s: number }>(
    db,
    `SELECT COALESCE(SUM(CASE tipo WHEN 'ENTRADA' THEN valor_centavos ELSE -valor_centavos END), 0) AS s
       FROM movimentacoes WHERE conta_id = ? AND (? IS NULL OR data <= ?)`,
    contaId, ate ?? null, ate ?? null,
  )!.s;
}

export function listarContasComSaldo(db: DB, ate?: string) {
  const contas = all<{ id: number; nome: string; tipo: string; ativa: number }>(db, 'SELECT id, nome, tipo, ativa FROM contas ORDER BY tipo, nome');
  return contas.map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo, ativa: !!c.ativa, saldoCentavos: saldoConta(db, c.id, ate) }));
}

export function totalAReceber(db: DB, ate?: string): number {
  // Pendentes na data de corte: vendidos até `ate` e não liquidados até `ate`.
  return one<{ s: number }>(
    db,
    `SELECT COALESCE(SUM(valor_liquido_centavos), 0) AS s FROM recebiveis
      WHERE status <> 'CANCELADO' AND (? IS NULL OR data_venda <= ?)
        AND (status = 'PENDENTE' OR (? IS NOT NULL AND status = 'LIQUIDADO' AND data_liquidacao > ?))`,
    ate ?? null, ate ?? null, ate ?? null, ate ?? null,
  )!.s;
}

/** Painel: disponível separado de valores a receber (RF-032, RN-024). */
export function posicaoFinanceira(db: DB, ate?: string) {
  const contas = listarContasComSaldo(db, ate);
  const disponivel = contas.reduce((s, c) => s + c.saldoCentavos, 0);
  return { data: ate ?? null, contas, disponivelCentavos: disponivel, aReceberCentavos: totalAReceber(db, ate) };
}

/**
 * Resultado do período (receitas × despesas). Transferências internas e
 * liquidações de cartão NÃO entram (RN-020, RN-023). A venda no cartão entra
 * como receita bruta na data da venda e a taxa como despesa (RN-022).
 */
export function resultadoPeriodo(db: DB, inicio: string, fim: string, contaId?: number) {
  const linhas = all<{ tipo: string; origem: string; categoria: string; total: number; orig_tipo: string | null }>(
    db,
    `SELECT m.tipo, m.origem, COALESCE(o.categoria, m.categoria) AS categoria, SUM(m.valor_centavos) AS total, o.tipo AS orig_tipo
       FROM movimentacoes m LEFT JOIN movimentacoes o ON o.id = m.estorno_de
      WHERE m.data BETWEEN ? AND ? AND m.origem IN ('MANUAL','ESTORNO') AND (? IS NULL OR m.conta_id = ?)
      GROUP BY m.tipo, m.origem, COALESCE(o.categoria, m.categoria), o.tipo`,
    inicio, fim, contaId ?? null, contaId ?? null,
  );
  const receitas = new Map<string, number>();
  const despesas = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const l of linhas) {
    if (l.origem === 'MANUAL') add(l.tipo === 'ENTRADA' ? receitas : despesas, l.categoria, l.total);
    else if (l.orig_tipo === 'ENTRADA') add(receitas, l.categoria, -l.total); // estorno de receita
    else add(despesas, l.categoria, -l.total); // estorno de despesa
  }
  if (contaId === undefined) {
    const vendas = all<{ categoria: string; bruto: number; taxa: number }>(
      db,
      `SELECT categoria, SUM(valor_bruto_centavos) AS bruto, SUM(taxa_centavos) AS taxa FROM recebiveis
        WHERE status <> 'CANCELADO' AND data_venda BETWEEN ? AND ? GROUP BY categoria`,
      inicio, fim,
    );
    for (const v of vendas) {
      add(receitas, v.categoria, v.bruto);
      if (v.taxa) add(despesas, CATEGORIA_TAXA_CARTAO, v.taxa);
    }
  }
  const lista = (m: Map<string, number>) =>
    [...m.entries()].filter(([, v]) => v !== 0).map(([categoria, totalCentavos]) => ({ categoria, totalCentavos })).sort((a, b) => b.totalCentavos - a.totalCentavos);
  const totalReceitas = [...receitas.values()].reduce((a, b) => a + b, 0);
  const totalDespesas = [...despesas.values()].reduce((a, b) => a + b, 0);
  return {
    inicio,
    fim,
    receitas: lista(receitas),
    despesas: lista(despesas),
    totalReceitasCentavos: totalReceitas,
    totalDespesasCentavos: totalDespesas,
    resultadoCentavos: totalReceitas - totalDespesas,
  };
}

export function resumoMensal(db: DB, ano: number, mes: number) {
  const { inicio, fim } = limitesDoMes(ano, mes);
  const anterior = new Date(Date.UTC(ano, mes - 1, 0)).toISOString().slice(0, 10);
  return {
    ano,
    mes,
    inicio,
    fim,
    saldoInicial: posicaoFinanceira(db, anterior),
    saldoFinal: posicaoFinanceira(db, fim),
    resultado: resultadoPeriodo(db, inicio, fim),
    quantidadeMovimentacoes: one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM movimentacoes WHERE data BETWEEN ? AND ?', inicio, fim)!.n,
  };
}
