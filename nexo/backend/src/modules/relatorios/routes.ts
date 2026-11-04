import { Router, type Response } from 'express';
import { z } from 'zod';
import { all, one, run, tx, type DB } from '../../db/connection.js';
import { auditar } from '../../lib/audit.js';
import { formatarData, formatarDataHora } from '../../lib/dates.js';
import { forbidden, unprocessable } from '../../lib/errors.js';
import { formatarMoeda as R } from '../../lib/money.js';
import { Relatorio } from '../../lib/pdf.js';
import { dataISO, idParam, parse } from '../../lib/validation.js';
import { ehLider, exigir, usuario, type UsuarioAutenticado } from '../../middleware/auth.js';
import { frequenciaGeral } from '../secretaria/frequencia.js';
import { resumoChamada } from '../secretaria/routes.js';
import { listarContasComSaldo, posicaoFinanceira, resultadoPeriodo, totalAReceber } from '../tesouraria/service.js';
import { detalharFechamento } from '../tesouraria/routes.js';

type TipoRelatorio = 'SECRETARIA_FREQUENCIA' | 'SECRETARIA_CHAMADA' | 'TESOURARIA_PERIODO' | 'TESOURARIA_FECHAMENTO';
const PREFIXO: Record<TipoRelatorio, string> = {
  SECRETARIA_FREQUENCIA: 'SEC',
  SECRETARIA_CHAMADA: 'CHM',
  TESOURARIA_PERIODO: 'TES',
  TESOURARIA_FECHAMENTO: 'FEC',
};
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Numeração sequencial por tipo e ano (RF-041). */
function registrarEmissao(db: DB, u: UsuarioAutenticado, tipo: TipoRelatorio, inicio: string | null, fim: string | null, params: unknown): string {
  return tx(db, () => {
    const ano = new Date().getFullYear();
    const prefixo = `${PREFIXO[tipo]}-${ano}-`;
    const n = one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM relatorios_emitidos WHERE numero LIKE ?', `${prefixo}%`)!.n + 1;
    const numero = `${prefixo}${String(n).padStart(4, '0')}`;
    run(db, 'INSERT INTO relatorios_emitidos (numero, tipo, periodo_inicio, periodo_fim, parametros_json, emitido_por) VALUES (?, ?, ?, ?, ?, ?)', numero, tipo, inicio, fim, JSON.stringify(params), u.id);
    auditar(db, u.id, 'EMITIR_RELATORIO', 'relatorio', numero, { tipo, inicio, fim, params });
    return numero;
  });
}

function enviarPdf(res: Response, nome: string, buf: Buffer) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nome}.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(buf);
}

const pct = (v: number | null) => (v === null ? 'Sem dados' : `${v.toLocaleString('pt-BR')}%`);
const periodoTxt = (i?: string | null, f?: string | null) => (i || f ? `${formatarData(i) ?? '—'} a ${formatarData(f) ?? '—'}` : 'Todo o histórico');

export function relatoriosRouter(db: DB) {
  const r = Router();

  // RF-042 — consulta de relatórios já emitidos, restrita ao módulo de cada função
  r.get('/', (req, res) => {
    const u = usuario(req);
    const tipos: TipoRelatorio[] = [];
    if (ehLider(u) || u.funcoes.includes('SECRETARIO')) tipos.push('SECRETARIA_FREQUENCIA', 'SECRETARIA_CHAMADA');
    if (ehLider(u) || u.funcoes.includes('TESOUREIRO')) tipos.push('TESOURARIA_PERIODO', 'TESOURARIA_FECHAMENTO');
    if (!tipos.length) throw forbidden();
    res.json(
      all(
        db,
        `SELECT r.id, r.numero, r.tipo, r.periodo_inicio AS periodoInicio, r.periodo_fim AS periodoFim, r.parametros_json AS parametros,
                u.nome AS emitidoPor, r.emitido_em AS emitidoEm
           FROM relatorios_emitidos r JOIN usuarios u ON u.id = r.emitido_por
          WHERE r.tipo IN (${tipos.map(() => '?').join(',')}) ORDER BY r.id DESC LIMIT 300`,
        ...tipos,
      ).map((x) => ({ ...(x as object), parametros: JSON.parse((x as { parametros: string }).parametros) })),
    );
  });

  // ---------- Secretaria (RF-021) ----------
  r.get('/secretaria', exigir('SECRETARIO'), async (req, res) => {
    const u = usuario(req);
    const f = parse(z.object({ inicio: dataISO.optional(), fim: dataISO.optional(), atividadeId: idParam.optional() }), req.query);
    const dados = frequenciaGeral(db, f);
    const atividade = f.atividadeId ? one<{ nome: string }>(db, 'SELECT nome FROM atividades WHERE id = ?', f.atividadeId)?.nome : 'Todas';
    const chamadas = all<{ data: string; atividade: string; descricao: string | null; elegiveis: number; presentes: number; finalizada_por: string }>(
      db,
      `SELECT c.data, a.nome AS atividade, c.descricao, uf.nome AS finalizada_por,
              (SELECT COUNT(*) FROM presencas p WHERE p.chamada_id = c.id) AS elegiveis,
              (SELECT COUNT(*) FROM presencas p WHERE p.chamada_id = c.id AND p.status = 'PRESENTE') AS presentes
         FROM chamadas c JOIN atividades a ON a.id = c.atividade_id LEFT JOIN usuarios uf ON uf.id = c.finalizada_por
        WHERE c.status = 'FINALIZADA' AND (? IS NULL OR c.data >= ?) AND (? IS NULL OR c.data <= ?) AND (? IS NULL OR c.atividade_id = ?)
        ORDER BY c.data, c.id`,
      f.inicio ?? null, f.inicio ?? null, f.fim ?? null, f.fim ?? null, f.atividadeId ?? null, f.atividadeId ?? null,
    );
    const numero = registrarEmissao(db, u, 'SECRETARIA_FREQUENCIA', f.inicio ?? null, f.fim ?? null, f);
    const pdf = new Relatorio({
      titulo: 'Relatório de Frequência — Secretaria',
      numero,
      linhas: [['Período', periodoTxt(f.inicio, f.fim)], ['Atividade', atividade ?? '—'], ['Emitido por', u.nome]],
    });
    pdf.secao('Resumo');
    pdf.pares([
      ['Chamadas finalizadas', String(dados.totalChamadas)],
      ['Marcações (jovens elegíveis × chamadas)', String(dados.atividadesElegiveis)],
      ['Presenças', String(dados.presencas)],
      ['Ausências', String(dados.ausencias)],
      ['Frequência média', pct(dados.percentual)],
    ]);
    pdf.secao('Chamadas');
    pdf.tabela(
      [{ titulo: 'Data', largura: 1.2 }, { titulo: 'Atividade', largura: 2.5 }, { titulo: 'Elegíveis', largura: 1, alinhamento: 'right' }, { titulo: 'Presentes', largura: 1, alinhamento: 'right' }, { titulo: '%', largura: 1, alinhamento: 'right' }, { titulo: 'Finalizada por', largura: 2 }],
      chamadas.map((c) => [formatarData(c.data), c.descricao ? `${c.atividade} — ${c.descricao}` : c.atividade, String(c.elegiveis), String(c.presentes), pct(c.elegiveis ? Math.round((c.presentes / c.elegiveis) * 1000) / 10 : null), c.finalizada_por ?? '—']),
    );
    pdf.secao('Frequência por jovem');
    pdf.tabela(
      [{ titulo: 'Jovem', largura: 3 }, { titulo: 'Elegíveis', largura: 1, alinhamento: 'right' }, { titulo: 'Presenças', largura: 1, alinhamento: 'right' }, { titulo: 'Ausências', largura: 1, alinhamento: 'right' }, { titulo: 'Frequência', largura: 1.2, alinhamento: 'right' }],
      dados.porJovem.map((j) => [j.situacao === 'INATIVO' ? `${j.nome} (inativo)` : j.nome, String(j.atividadesElegiveis), String(j.presencas), String(j.ausencias), pct(j.percentual)]),
    );
    pdf.paragrafo('A frequência considera apenas as atividades em que o jovem era elegível na data (RN-038). Indicadores servem ao acompanhamento pastoral, não a julgamento.', { tamanho: 7.5, cor: '#555' });
    pdf.assinaturas(['Secretário(a)', 'Líder']);
    enviarPdf(res, numero, await pdf.finalizar());
  });

  r.get('/secretaria/chamadas/:id', exigir('SECRETARIO'), async (req, res) => {
    const u = usuario(req);
    const id = parse(idParam, req.params.id);
    const c = resumoChamada(db, id);
    if (c.status !== 'FINALIZADA') throw unprocessable('CHAMADA_ABERTA', 'Finalize a chamada antes de emitir o relatório.');
    const numero = registrarEmissao(db, u, 'SECRETARIA_CHAMADA', c.data, c.data, { chamadaId: id });
    const pdf = new Relatorio({
      titulo: 'Relatório de Chamada',
      subtitulo: c.descricao ? `${c.atividade} — ${c.descricao}` : c.atividade,
      numero,
      linhas: [['Data da atividade', formatarData(c.data)], ['Finalizada por', `${c.finalizadaPor ?? '—'} em ${formatarDataHora(c.finalizadaEm)}`], ['Emitido por', u.nome]],
    });
    pdf.secao('Resumo');
    pdf.pares([['Jovens elegíveis', String(c.totalElegiveis)], ['Presentes', String(c.totalPresentes)], ['Ausentes', String(c.totalAusentes)], ['Percentual de presença', pct(c.percentualPresenca)], ['Correções autorizadas', String(c.correcoes)]]);
    pdf.secao('Presentes');
    pdf.tabela([{ titulo: '#', largura: 0.5 }, { titulo: 'Nome', largura: 6 }], c.presentes.map((n, i) => [String(i + 1), n]));
    pdf.secao('Ausentes');
    pdf.tabela([{ titulo: '#', largura: 0.5 }, { titulo: 'Nome', largura: 6 }], c.ausentes.map((n, i) => [String(i + 1), n]));
    pdf.assinaturas(['Secretário(a)', 'Líder']);
    enviarPdf(res, numero, await pdf.finalizar());
  });

  // ---------- Tesouraria (RF-033, RF-034) ----------
  r.get('/tesouraria', exigir('TESOUREIRO'), async (req, res) => {
    const u = usuario(req);
    const f = parse(z.object({ inicio: dataISO, fim: dataISO, contaId: idParam.optional() }), req.query);
    if (f.inicio > f.fim) throw unprocessable('PERIODO_INVALIDO', 'A data inicial deve ser anterior à final.');
    const numero = registrarEmissao(db, u, 'TESOURARIA_PERIODO', f.inicio, f.fim, f);
    const conta = f.contaId ? one<{ nome: string }>(db, 'SELECT nome FROM contas WHERE id = ?', f.contaId)?.nome : 'Todas as contas';
    const pdf = new Relatorio({
      titulo: 'Relatório Financeiro — Tesouraria',
      numero,
      linhas: [['Período', periodoTxt(f.inicio, f.fim)], ['Contas', conta ?? '—'], ['Emitido por', u.nome]],
    });
    escreverFinanceiro(db, pdf, f.inicio, f.fim, f.contaId);
    pdf.assinaturas(['Tesoureiro(a)', 'Líder']);
    enviarPdf(res, numero, await pdf.finalizar());
  });

  r.get('/tesouraria/fechamentos/:id', exigir('TESOUREIRO'), async (req, res) => {
    const u = usuario(req);
    const id = parse(idParam, req.params.id);
    const f = detalharFechamento(db, id);
    const definitivo = f.status === 'APROVADO';
    const numero = registrarEmissao(db, u, 'TESOURARIA_FECHAMENTO', f.resumo.inicio, f.resumo.fim, { fechamentoId: id, status: f.status });
    const aprov = [...f.eventos].reverse().find((e) => (e as { evento: string }).evento === 'APROVADO') as { usuario: string; criadoEm: string } | undefined;
    const pdf = new Relatorio({
      titulo: `Fechamento Mensal — ${MESES[f.mes - 1]} de ${f.ano}`,
      subtitulo: definitivo ? 'Relatório definitivo' : `Prévia — situação: ${f.status.toLowerCase()}`,
      numero,
      marcaDagua: definitivo ? undefined : 'PRÉVIA',
      linhas: [
        ['Período', periodoTxt(f.resumo.inicio, f.resumo.fim)],
        ['Preparado por', `${f.preparadoPor} em ${formatarDataHora(f.preparadoEm)}`],
        ['Aprovado por', aprov ? `${aprov.usuario} em ${formatarDataHora(aprov.criadoEm)}` : '—'],
        ['Emitido por', u.nome],
      ],
    });
    escreverFinanceiro(db, pdf, f.resumo.inicio, f.resumo.fim);
    if (f.observacao) {
      pdf.secao('Observações');
      pdf.paragrafo(f.observacao);
    }
    pdf.secao('Histórico do fechamento');
    pdf.tabela(
      [{ titulo: 'Data/hora', largura: 1.6 }, { titulo: 'Evento', largura: 1.2 }, { titulo: 'Responsável', largura: 1.6 }, { titulo: 'Justificativa', largura: 3 }],
      (f.eventos as Array<{ criadoEm: string; evento: string; usuario: string; justificativa: string | null }>).map((e) => [formatarDataHora(e.criadoEm), e.evento, e.usuario, e.justificativa ?? '']),
    );
    pdf.assinaturas(['Tesoureiro(a)', 'Líder']);
    enviarPdf(res, numero, await pdf.finalizar());
  });

  return r;
}

function escreverFinanceiro(db: DB, pdf: Relatorio, inicio: string, fim: string, contaId?: number) {
  const anterior = new Date(new Date(`${inicio}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
  const iniciais = new Map(listarContasComSaldo(db, anterior).map((c) => [c.id, c.saldoCentavos]));
  const finais = listarContasComSaldo(db, fim).filter((c) => !contaId || c.id === contaId);
  const resultado = resultadoPeriodo(db, inicio, fim, contaId);

  pdf.secao('Saldos por conta');
  pdf.tabela(
    [{ titulo: 'Conta', largura: 2.5 }, { titulo: 'Tipo', largura: 1 }, { titulo: 'Saldo inicial', largura: 1.5, alinhamento: 'right' }, { titulo: 'Saldo final', largura: 1.5, alinhamento: 'right' }],
    finais.map((c) => [c.nome, c.tipo === 'BANCO' ? 'Banco' : 'Caixa', R(iniciais.get(c.id) ?? 0), R(c.saldoCentavos)]),
    { totais: ['Total disponível', '', R(finais.reduce((s, c) => s + (iniciais.get(c.id) ?? 0), 0)), R(finais.reduce((s, c) => s + c.saldoCentavos, 0))] },
  );
  if (!contaId) {
    pdf.pares([
      ['Valores a receber da maquininha (fim do período)', R(totalAReceber(db, fim))],
      ['Posição total (disponível + a receber)', R(posicaoFinanceira(db, fim).disponivelCentavos + totalAReceber(db, fim))],
    ]);
    pdf.paragrafo('Valores a receber não compõem o saldo disponível (RN-024).', { tamanho: 7.5, cor: '#555' });
  }

  pdf.secao('Resultado do período');
  pdf.tabela(
    [{ titulo: 'Receitas por categoria', largura: 3 }, { titulo: 'Valor', largura: 1.2, alinhamento: 'right' }],
    resultado.receitas.map((x) => [x.categoria, R(x.totalCentavos)]),
    { totais: ['Total de receitas', R(resultado.totalReceitasCentavos)] },
  );
  pdf.tabela(
    [{ titulo: 'Despesas por categoria', largura: 3 }, { titulo: 'Valor', largura: 1.2, alinhamento: 'right' }],
    resultado.despesas.map((x) => [x.categoria, R(x.totalCentavos)]),
    { totais: ['Total de despesas', R(resultado.totalDespesasCentavos)] },
  );
  pdf.pares([['Resultado (receitas - despesas)', R(resultado.resultadoCentavos)]]);
  pdf.paragrafo('Transferências internas e liquidações de cartão não são receitas nem despesas (RN-020, RN-023).', { tamanho: 7.5, cor: '#555' });

  const movs = all<{ data: string; conta: string; tipo: string; origem: string; categoria: string; descricao: string; valor: number; responsavel: string }>(
    db,
    `SELECT m.data, c.nome AS conta, m.tipo, m.origem, m.categoria, m.descricao, m.valor_centavos AS valor, u.nome AS responsavel
       FROM movimentacoes m JOIN contas c ON c.id = m.conta_id JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.data BETWEEN ? AND ? AND (? IS NULL OR m.conta_id = ?) ORDER BY m.data, m.id`,
    inicio, fim, contaId ?? null, contaId ?? null,
  );
  pdf.secao('Movimentações');
  const ORIGEM: Record<string, string> = { MANUAL: '', TRANSFERENCIA: ' (transf.)', LIQUIDACAO: ' (liquidação)', ESTORNO: ' (estorno)' };
  pdf.tabela(
    [{ titulo: 'Data', largura: 1 }, { titulo: 'Conta', largura: 1.3 }, { titulo: 'Categoria', largura: 1.4 }, { titulo: 'Descrição', largura: 3 }, { titulo: 'Valor', largura: 1.3, alinhamento: 'right' }, { titulo: 'Resp.', largura: 1.2 }],
    movs.map((m) => [formatarData(m.data), m.conta, m.categoria + ORIGEM[m.origem], m.descricao, (m.tipo === 'SAIDA' ? '- ' : '+ ') + R(m.valor), m.responsavel]),
  );

  if (!contaId) {
    const recs = all<{ data_venda: string; descricao: string; bruto: number; taxa: number; liquido: number; status: string; data_liquidacao: string | null }>(
      db,
      `SELECT data_venda, descricao, valor_bruto_centavos AS bruto, taxa_centavos AS taxa, valor_liquido_centavos AS liquido, status, data_liquidacao
         FROM recebiveis WHERE status <> 'CANCELADO' AND (data_venda BETWEEN ? AND ? OR data_liquidacao BETWEEN ? AND ?) ORDER BY data_venda, id`,
      inicio, fim, inicio, fim,
    );
    pdf.secao('Vendas no cartão (maquininha)');
    pdf.tabela(
      [{ titulo: 'Venda', largura: 1 }, { titulo: 'Descrição', largura: 2.6 }, { titulo: 'Bruto', largura: 1.2, alinhamento: 'right' }, { titulo: 'Taxa', largura: 1, alinhamento: 'right' }, { titulo: 'Líquido', largura: 1.2, alinhamento: 'right' }, { titulo: 'Situação', largura: 1.4 }],
      recs.map((x) => [formatarData(x.data_venda), x.descricao, R(x.bruto), R(x.taxa), R(x.liquido), x.status === 'LIQUIDADO' ? `Liquidado ${formatarData(x.data_liquidacao)}` : 'A receber']),
    );
  }
}
