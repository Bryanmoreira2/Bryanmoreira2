import { Router } from 'express';
import { z } from 'zod';
import { all, one, run, tx, type DB } from '../../db/connection.js';
import { auditar } from '../../lib/audit.js';
import { agora, hoje, limitesDoMes } from '../../lib/dates.js';
import { notFound, unprocessable } from '../../lib/errors.js';
import { centavos, dataISO, idParam, parse, texto, textoOpcional } from '../../lib/validation.js';
import { exigir, somenteLider, usuario } from '../../middleware/auth.js';
import { idempotente } from '../../middleware/idempotency.js';
import {
  CHAVE_CONTA_MAQUININHA,
  exigirPeriodoAberto,
  listarContasComSaldo,
  posicaoFinanceira,
  resultadoPeriodo,
  resumoMensal,
  saldoConta,
} from './service.js';

const SELECT_MOV = `
  SELECT m.id, m.conta_id AS contaId, c.nome AS conta, m.tipo, m.origem, m.valor_centavos AS valorCentavos, m.data,
         m.categoria, m.descricao, m.transferencia_id AS transferenciaId, m.recebivel_id AS recebivelId,
         m.estorno_de AS estornoDe, (SELECT e.id FROM movimentacoes e WHERE e.estorno_de = m.id) AS estornadaPor,
         u.nome AS responsavel, m.criado_em AS criadoEm
    FROM movimentacoes m JOIN contas c ON c.id = m.conta_id JOIN usuarios u ON u.id = m.usuario_id`;

const SELECT_REC = `
  SELECT r.id, r.data_venda AS dataVenda, r.valor_bruto_centavos AS valorBrutoCentavos, r.taxa_centavos AS taxaCentavos,
         r.valor_liquido_centavos AS valorLiquidoCentavos, r.categoria, r.descricao, r.previsao_liquidacao AS previsaoLiquidacao,
         r.conta_destino_id AS contaDestinoId, c.nome AS contaDestino, r.status, r.data_liquidacao AS dataLiquidacao,
         r.cancelado_motivo AS canceladoMotivo, u.nome AS responsavel, r.criado_em AS criadoEm
    FROM recebiveis r JOIN contas c ON c.id = r.conta_destino_id JOIN usuarios u ON u.id = r.usuario_id`;

function exigirConta(db: DB, id: number) {
  const c = one<{ id: number; ativa: number; nome: string }>(db, 'SELECT id, ativa, nome FROM contas WHERE id = ?', id);
  if (!c) throw notFound('Conta');
  if (!c.ativa) throw unprocessable('CONTA_INATIVA', `A conta "${c.nome}" está inativa.`);
  return c;
}

const movimentacao = (db: DB, id: number) => one(db, `${SELECT_MOV} WHERE m.id = ?`, id);
const recebivel = (db: DB, id: number) => one<{ status: string; dataVenda: string; valorLiquidoCentavos: number; contaDestinoId: number; descricao: string; categoria: string }>(db, `${SELECT_REC} WHERE r.id = ?`, id);

export function tesourariaRouter(db: DB) {
  const r = Router();
  r.use(exigir('TESOUREIRO'));
  r.use(idempotente(db));

  // ---------- Contas (RF-022, RF-032) ----------
  r.get('/contas', (req, res) => {
    const { data } = parse(z.object({ data: dataISO.optional() }), req.query);
    res.json(listarContasComSaldo(db, data));
  });

  r.get('/posicao', (req, res) => {
    const { data } = parse(z.object({ data: dataISO.optional() }), req.query);
    const conf = one<{ valor: string }>(db, 'SELECT valor FROM configuracoes WHERE chave = ?', CHAVE_CONTA_MAQUININHA);
    res.json({ ...posicaoFinanceira(db, data), contaDestinoMaquininhaId: conf ? Number(conf.valor) : null });
  });

  r.post('/contas', somenteLider(), (req, res) => {
    const u = usuario(req);
    const b = parse(z.object({ nome: texto(80), tipo: z.enum(['BANCO', 'CAIXA']) }), req.body);
    const { id } = run(db, 'INSERT INTO contas (nome, tipo) VALUES (?, ?)', b.nome, b.tipo);
    auditar(db, u.id, 'CRIAR_CONTA', 'conta', id, b);
    res.status(201).json({ id, ...b, ativa: true, saldoCentavos: 0 });
  });

  r.patch('/contas/:id', somenteLider(), (req, res) => {
    const u = usuario(req);
    const id = parse(idParam, req.params.id);
    const b = parse(z.object({ nome: texto(80).optional(), ativa: z.boolean().optional() }), req.body);
    const atual = one<{ nome: string; ativa: number }>(db, 'SELECT nome, ativa FROM contas WHERE id = ?', id);
    if (!atual) throw notFound('Conta');
    if (b.ativa === false && saldoConta(db, id) !== 0) throw unprocessable('SALDO_NAO_ZERADO', 'Zere o saldo antes de inativar a conta.');
    run(db, 'UPDATE contas SET nome = ?, ativa = ? WHERE id = ?', b.nome ?? atual.nome, b.ativa ?? !!atual.ativa, id);
    auditar(db, u.id, 'EDITAR_CONTA', 'conta', id, b);
    res.json(listarContasComSaldo(db).find((c) => c.id === id));
  });

  r.get('/contas/:id/saldo', (req, res) => {
    const id = parse(idParam, req.params.id);
    const { data } = parse(z.object({ data: dataISO.optional() }), req.query);
    if (!one(db, 'SELECT 1 FROM contas WHERE id = ?', id)) throw notFound('Conta');
    res.json({ contaId: id, data: data ?? null, saldoCentavos: saldoConta(db, id, data) });
  });

  // RN-044 — conta de destino padrão da maquininha
  r.put('/configuracoes/conta-maquininha', somenteLider(), (req, res) => {
    const u = usuario(req);
    const { contaId } = parse(z.object({ contaId: idParam }), req.body);
    exigirConta(db, contaId);
    run(db, 'INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor', CHAVE_CONTA_MAQUININHA, String(contaId));
    auditar(db, u.id, 'CONFIGURAR_CONTA_MAQUININHA', 'configuracao', CHAVE_CONTA_MAQUININHA, { contaId });
    res.json({ contaId });
  });

  r.get('/categorias', (_req, res) => {
    const rows = all<{ categoria: string }>(
      db,
      `SELECT categoria FROM movimentacoes WHERE origem = 'MANUAL' UNION SELECT categoria FROM recebiveis ORDER BY 1`,
    );
    res.json(rows.map((r) => r.categoria));
  });

  // ---------- Movimentações (RF-023..RF-027, RN-018) ----------
  r.get('/movimentacoes', (req, res) => {
    const f = parse(
      z.object({
        contaId: idParam.optional(), inicio: dataISO.optional(), fim: dataISO.optional(),
        tipo: z.enum(['ENTRADA', 'SAIDA']).optional(), categoria: z.string().trim().max(80).optional(),
        origem: z.enum(['MANUAL', 'TRANSFERENCIA', 'LIQUIDACAO', 'ESTORNO']).optional(),
      }),
      req.query,
    );
    res.json(
      all(
        db,
        `${SELECT_MOV}
          WHERE (? IS NULL OR m.conta_id = ?) AND (? IS NULL OR m.data >= ?) AND (? IS NULL OR m.data <= ?)
            AND (? IS NULL OR m.tipo = ?) AND (? IS NULL OR m.categoria = ?) AND (? IS NULL OR m.origem = ?)
          ORDER BY m.data DESC, m.id DESC LIMIT 2000`,
        f.contaId ?? null, f.contaId ?? null, f.inicio ?? null, f.inicio ?? null, f.fim ?? null, f.fim ?? null,
        f.tipo ?? null, f.tipo ?? null, f.categoria || null, f.categoria || null, f.origem ?? null, f.origem ?? null,
      ),
    );
  });

  r.post('/movimentacoes', (req, res) => {
    const u = usuario(req);
    const b = parse(
      z.object({ contaId: idParam, tipo: z.enum(['ENTRADA', 'SAIDA']), valorCentavos: centavos, data: dataISO, categoria: texto(80), descricao: texto(300) }),
      req.body,
    );
    const id = tx(db, () => {
      exigirConta(db, b.contaId);
      exigirPeriodoAberto(db, b.data);
      const { id } = run(
        db,
        `INSERT INTO movimentacoes (conta_id, tipo, origem, valor_centavos, data, categoria, descricao, usuario_id)
         VALUES (?, ?, 'MANUAL', ?, ?, ?, ?, ?)`,
        b.contaId, b.tipo, b.valorCentavos, b.data, b.categoria, b.descricao, u.id,
      );
      auditar(db, u.id, 'REGISTRAR_MOVIMENTACAO', 'movimentacao', id, b);
      return id;
    });
    res.status(201).json(movimentacao(db, id));
  });

  // Correção financeira por estorno — o lançamento original é preservado (RN-025)
  r.post('/movimentacoes/:id/estorno', (req, res) => {
    const u = usuario(req);
    const id = parse(idParam, req.params.id);
    const b = parse(z.object({ justificativa: texto(300), data: dataISO.default(hoje()) }), req.body);
    const novoId = tx(db, () => {
      const m = one<{ conta_id: number; tipo: string; origem: string; valor_centavos: number; data: string; categoria: string; descricao: string }>(
        db, 'SELECT conta_id, tipo, origem, valor_centavos, data, categoria, descricao FROM movimentacoes WHERE id = ?', id,
      );
      if (!m) throw notFound('Movimentação');
      if (m.origem !== 'MANUAL') throw unprocessable('ESTORNO_NAO_PERMITIDO', 'Apenas lançamentos manuais podem ser estornados por aqui.');
      if (one(db, 'SELECT 1 FROM movimentacoes WHERE estorno_de = ?', id)) throw unprocessable('JA_ESTORNADA', 'Esta movimentação já foi estornada.');
      if (b.data < m.data) throw unprocessable('DATA_INVALIDA', 'O estorno não pode ser anterior ao lançamento original.');
      exigirPeriodoAberto(db, b.data);
      const { id: novo } = run(
        db,
        `INSERT INTO movimentacoes (conta_id, tipo, origem, valor_centavos, data, categoria, descricao, estorno_de, usuario_id)
         VALUES (?, ?, 'ESTORNO', ?, ?, ?, ?, ?, ?)`,
        m.conta_id, m.tipo === 'ENTRADA' ? 'SAIDA' : 'ENTRADA', m.valor_centavos, b.data, m.categoria,
        `Estorno de #${id}: ${b.justificativa}`, id, u.id,
      );
      auditar(db, u.id, 'ESTORNAR_MOVIMENTACAO', 'movimentacao', id, { estornoId: novo, justificativa: b.justificativa });
      return novo;
    });
    res.status(201).json(movimentacao(db, novoId));
  });

  // ---------- Transferências internas (RF-029, RN-020) ----------
  r.get('/transferencias', (_req, res) => {
    res.json(
      all(
        db,
        `SELECT t.id, t.conta_origem_id AS contaOrigemId, co.nome AS contaOrigem, t.conta_destino_id AS contaDestinoId,
                cd.nome AS contaDestino, t.valor_centavos AS valorCentavos, t.data, t.descricao, u.nome AS responsavel
           FROM transferencias t JOIN contas co ON co.id = t.conta_origem_id JOIN contas cd ON cd.id = t.conta_destino_id
           JOIN usuarios u ON u.id = t.usuario_id ORDER BY t.data DESC, t.id DESC LIMIT 500`,
      ),
    );
  });

  r.post('/transferencias', (req, res) => {
    const u = usuario(req);
    const b = parse(
      z.object({ contaOrigemId: idParam, contaDestinoId: idParam, valorCentavos: centavos, data: dataISO, descricao: texto(300) }),
      req.body,
    );
    if (b.contaOrigemId === b.contaDestinoId) throw unprocessable('MESMA_CONTA', 'Origem e destino devem ser contas diferentes.');
    const id = tx(db, () => {
      const o = exigirConta(db, b.contaOrigemId);
      const d = exigirConta(db, b.contaDestinoId);
      exigirPeriodoAberto(db, b.data);
      const { id } = run(
        db,
        'INSERT INTO transferencias (conta_origem_id, conta_destino_id, valor_centavos, data, descricao, usuario_id) VALUES (?, ?, ?, ?, ?, ?)',
        b.contaOrigemId, b.contaDestinoId, b.valorCentavos, b.data, b.descricao, u.id,
      );
      const ins = `INSERT INTO movimentacoes (conta_id, tipo, origem, valor_centavos, data, categoria, descricao, transferencia_id, usuario_id)
                   VALUES (?, ?, 'TRANSFERENCIA', ?, ?, 'Transferência interna', ?, ?, ?)`;
      run(db, ins, b.contaOrigemId, 'SAIDA', b.valorCentavos, b.data, `Para ${d.nome}: ${b.descricao}`, id, u.id);
      run(db, ins, b.contaDestinoId, 'ENTRADA', b.valorCentavos, b.data, `De ${o.nome}: ${b.descricao}`, id, u.id);
      auditar(db, u.id, 'REGISTRAR_TRANSFERENCIA', 'transferencia', id, b);
      return id;
    });
    res.status(201).json({ id, ...b });
  });

  // ---------- Recebíveis da maquininha (RF-030, RF-031, RN-021..RN-023) ----------
  r.get('/recebiveis', (req, res) => {
    const { status } = parse(z.object({ status: z.enum(['PENDENTE', 'LIQUIDADO', 'CANCELADO']).optional() }), req.query);
    res.json(all(db, `${SELECT_REC} WHERE (? IS NULL OR r.status = ?) ORDER BY r.data_venda DESC, r.id DESC LIMIT 1000`, status ?? null, status ?? null));
  });

  r.post('/recebiveis', (req, res) => {
    const u = usuario(req);
    const b = parse(
      z.object({
        dataVenda: dataISO, valorBrutoCentavos: centavos, taxaCentavos: z.number().int().min(0),
        categoria: texto(80), descricao: texto(300), previsaoLiquidacao: dataISO.optional().nullable(), contaDestinoId: idParam.optional(),
      }),
      req.body,
    );
    if (b.taxaCentavos >= b.valorBrutoCentavos) throw unprocessable('TAXA_INVALIDA', 'A taxa deve ser menor que o valor bruto.');
    const id = tx(db, () => {
      exigirPeriodoAberto(db, b.dataVenda);
      const padrao = one<{ valor: string }>(db, 'SELECT valor FROM configuracoes WHERE chave = ?', CHAVE_CONTA_MAQUININHA);
      const contaDestinoId = b.contaDestinoId ?? (padrao ? Number(padrao.valor) : undefined);
      if (!contaDestinoId) throw unprocessable('SEM_CONTA_DESTINO', 'Informe a conta de destino ou peça ao líder para configurar a conta padrão da maquininha.');
      exigirConta(db, contaDestinoId);
      const { id } = run(
        db,
        `INSERT INTO recebiveis (data_venda, valor_bruto_centavos, taxa_centavos, valor_liquido_centavos, categoria, descricao, previsao_liquidacao, conta_destino_id, usuario_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        b.dataVenda, b.valorBrutoCentavos, b.taxaCentavos, b.valorBrutoCentavos - b.taxaCentavos, b.categoria, b.descricao,
        b.previsaoLiquidacao ?? null, contaDestinoId, u.id,
      );
      auditar(db, u.id, 'REGISTRAR_RECEBIVEL', 'recebivel', id, { ...b, contaDestinoId });
      return id;
    });
    res.status(201).json(recebivel(db, id));
  });

  // Liquidação: crédito na conta configurada, sem nova receita (RN-023)
  r.post('/recebiveis/:id/liquidacao', (req, res) => {
    const u = usuario(req);
    const id = parse(idParam, req.params.id);
    const b = parse(z.object({ data: dataISO, contaId: idParam.optional() }), req.body);
    tx(db, () => {
      const rec = recebivel(db, id);
      if (!rec) throw notFound('Recebível');
      if (rec.status !== 'PENDENTE') throw unprocessable('RECEBIVEL_NAO_PENDENTE', `Este recebível está ${rec.status.toLowerCase()}.`);
      if (b.data < rec.dataVenda) throw unprocessable('DATA_INVALIDA', 'A liquidação não pode ser anterior à venda.');
      const contaId = b.contaId ?? rec.contaDestinoId;
      exigirConta(db, contaId);
      exigirPeriodoAberto(db, b.data);
      run(
        db,
        `INSERT INTO movimentacoes (conta_id, tipo, origem, valor_centavos, data, categoria, descricao, recebivel_id, usuario_id)
         VALUES (?, 'ENTRADA', 'LIQUIDACAO', ?, ?, 'Liquidação de cartão', ?, ?, ?)`,
        contaId, rec.valorLiquidoCentavos, b.data, `Liquidação do recebível #${id}: ${rec.descricao}`, id, u.id,
      );
      run(
        db,
        "UPDATE recebiveis SET status = 'LIQUIDADO', data_liquidacao = ?, liquidado_em = ?, liquidado_por = ?, conta_destino_id = ? WHERE id = ?",
        b.data, agora(), u.id, contaId, id,
      );
      auditar(db, u.id, 'LIQUIDAR_RECEBIVEL', 'recebivel', id, { ...b, contaId });
    });
    res.json(recebivel(db, id));
  });

  r.post('/recebiveis/:id/cancelamento', (req, res) => {
    const u = usuario(req);
    const id = parse(idParam, req.params.id);
    const { justificativa } = parse(z.object({ justificativa: texto(300) }), req.body);
    tx(db, () => {
      const rec = recebivel(db, id);
      if (!rec) throw notFound('Recebível');
      if (rec.status !== 'PENDENTE') throw unprocessable('RECEBIVEL_NAO_PENDENTE', 'Somente recebíveis pendentes podem ser cancelados.');
      exigirPeriodoAberto(db, rec.dataVenda);
      run(db, "UPDATE recebiveis SET status = 'CANCELADO', cancelado_motivo = ? WHERE id = ?", justificativa, id);
      auditar(db, u.id, 'CANCELAR_RECEBIVEL', 'recebivel', id, { justificativa });
    });
    res.json(recebivel(db, id));
  });

  // ---------- Relatório resumido (consulta) ----------
  r.get('/resultado', (req, res) => {
    const f = parse(z.object({ inicio: dataISO, fim: dataISO, contaId: idParam.optional() }), req.query);
    res.json(resultadoPeriodo(db, f.inicio, f.fim, f.contaId));
  });

  // ---------- Fechamento mensal (RF-043..RF-046, DP-008) ----------
  r.get('/fechamentos', (_req, res) => res.json(listarFechamentos(db)));

  r.get('/fechamentos/:id', (req, res) => res.json(detalharFechamento(db, parse(idParam, req.params.id))));

  r.post('/fechamentos', (req, res) => {
    const u = usuario(req);
    const b = parse(z.object({ ano: z.number().int().min(2000).max(2100), mes: z.number().int().min(1).max(12), observacao: textoOpcional(1000) }), req.body);
    const { fim } = limitesDoMes(b.ano, b.mes);
    if (fim >= hoje()) throw unprocessable('MES_EM_ANDAMENTO', 'Só é possível fechar meses já encerrados.');
    const id = tx(db, () => {
      const existente = one<{ id: number; status: string }>(db, 'SELECT id, status FROM fechamentos WHERE ano = ? AND mes = ?', b.ano, b.mes);
      const resumo = JSON.stringify(resumoMensal(db, b.ano, b.mes));
      if (existente) {
        if (!['RASCUNHO', 'DEVOLVIDO', 'REABERTO'].includes(existente.status)) {
          throw unprocessable('FECHAMENTO_EM_ANDAMENTO', `Já existe fechamento ${existente.status.toLowerCase()} para este mês.`);
        }
        run(db, "UPDATE fechamentos SET status = 'RASCUNHO', resumo_json = ?, observacao = ?, preparado_por = ?, preparado_em = ? WHERE id = ?", resumo, b.observacao, u.id, agora(), existente.id);
        evento(db, existente.id, 'PREPARADO', null, u.id);
        return existente.id;
      }
      const { id } = run(db, "INSERT INTO fechamentos (ano, mes, status, resumo_json, observacao, preparado_por) VALUES (?, ?, 'RASCUNHO', ?, ?, ?)", b.ano, b.mes, resumo, b.observacao, u.id);
      evento(db, id, 'PREPARADO', null, u.id);
      return id;
    });
    auditar(db, u.id, 'PREPARAR_FECHAMENTO', 'fechamento', id, b);
    res.status(201).json(detalharFechamento(db, id));
  });

  r.post('/fechamentos/:id/envio', (req, res) => {
    const u = usuario(req);
    const id = parse(idParam, req.params.id);
    tx(db, () => {
      const f = buscarFechamento(db, id);
      if (f.status !== 'RASCUNHO') throw unprocessable('STATUS_INVALIDO', 'Apenas fechamentos em rascunho podem ser enviados.');
      run(db, "UPDATE fechamentos SET status = 'ENVIADO', resumo_json = ?, enviado_por = ?, enviado_em = ? WHERE id = ?", JSON.stringify(resumoMensal(db, f.ano, f.mes)), u.id, agora(), id);
      evento(db, id, 'ENVIADO', null, u.id);
      auditar(db, u.id, 'ENVIAR_FECHAMENTO', 'fechamento', id);
    });
    res.json(detalharFechamento(db, id));
  });

  // Aprovação ou devolução exclusiva do líder (RF-044, RN-045)
  r.post('/fechamentos/:id/aprovacao', somenteLider(), (req, res) => {
    const u = usuario(req);
    const id = parse(idParam, req.params.id);
    const b = parse(z.object({ decisao: z.enum(['APROVAR', 'DEVOLVER']), justificativa: textoOpcional(1000) }), req.body);
    if (b.decisao === 'DEVOLVER' && !b.justificativa) throw unprocessable('JUSTIFICATIVA_OBRIGATORIA', 'Informe o motivo da devolução.');
    tx(db, () => {
      const f = buscarFechamento(db, id);
      if (f.status !== 'ENVIADO') throw unprocessable('STATUS_INVALIDO', 'Apenas fechamentos enviados podem ser aprovados ou devolvidos.');
      const status = b.decisao === 'APROVAR' ? 'APROVADO' : 'DEVOLVIDO';
      const resumo = b.decisao === 'APROVAR' ? JSON.stringify(resumoMensal(db, f.ano, f.mes)) : f.resumo_json;
      run(db, 'UPDATE fechamentos SET status = ?, resumo_json = ?, decidido_por = ?, decidido_em = ? WHERE id = ?', status, resumo, u.id, agora(), id);
      evento(db, id, status, b.justificativa, u.id);
      auditar(db, u.id, b.decisao === 'APROVAR' ? 'APROVAR_FECHAMENTO' : 'DEVOLVER_FECHAMENTO', 'fechamento', id, b);
    });
    res.json(detalharFechamento(db, id));
  });

  // Reabertura justificada e auditada (RF-046, RN-047)
  r.post('/fechamentos/:id/reabertura', somenteLider(), (req, res) => {
    const u = usuario(req);
    const id = parse(idParam, req.params.id);
    const { justificativa } = parse(z.object({ justificativa: texto(1000) }), req.body);
    tx(db, () => {
      const f = buscarFechamento(db, id);
      if (f.status !== 'APROVADO') throw unprocessable('STATUS_INVALIDO', 'Apenas fechamentos aprovados podem ser reabertos.');
      run(db, "UPDATE fechamentos SET status = 'REABERTO', decidido_por = ?, decidido_em = ? WHERE id = ?", u.id, agora(), id);
      evento(db, id, 'REABERTO', justificativa, u.id);
      auditar(db, u.id, 'REABRIR_FECHAMENTO', 'fechamento', id, { justificativa });
    });
    res.json(detalharFechamento(db, id));
  });

  return r;
}

interface FechamentoRow {
  id: number;
  ano: number;
  mes: number;
  status: string;
  resumo_json: string;
  observacao: string | null;
  preparado_por: string;
  preparado_em: string;
  enviado_por: string | null;
  enviado_em: string | null;
  decidido_por: string | null;
  decidido_em: string | null;
}

const SELECT_FECH = `
  SELECT f.id, f.ano, f.mes, f.status, f.resumo_json, f.observacao, up.nome AS preparado_por, f.preparado_em,
         ue.nome AS enviado_por, f.enviado_em, ud.nome AS decidido_por, f.decidido_em
    FROM fechamentos f JOIN usuarios up ON up.id = f.preparado_por
    LEFT JOIN usuarios ue ON ue.id = f.enviado_por LEFT JOIN usuarios ud ON ud.id = f.decidido_por`;

export function buscarFechamento(db: DB, id: number): FechamentoRow {
  const f = one<FechamentoRow>(db, `${SELECT_FECH} WHERE f.id = ?`, id);
  if (!f) throw notFound('Fechamento');
  return f;
}

function evento(db: DB, fechamentoId: number, ev: string, justificativa: string | null | undefined, usuarioId: number) {
  run(db, 'INSERT INTO fechamento_eventos (fechamento_id, evento, justificativa, usuario_id) VALUES (?, ?, ?, ?)', fechamentoId, ev, justificativa ?? null, usuarioId);
}

const dtoFech = (f: FechamentoRow) => ({
  id: f.id, ano: f.ano, mes: f.mes, status: f.status, observacao: f.observacao,
  preparadoPor: f.preparado_por, preparadoEm: f.preparado_em, enviadoPor: f.enviado_por, enviadoEm: f.enviado_em,
  decididoPor: f.decidido_por, decididoEm: f.decidido_em,
});

function listarFechamentos(db: DB) {
  return all<FechamentoRow>(db, `${SELECT_FECH} ORDER BY f.ano DESC, f.mes DESC`).map(dtoFech);
}

export function detalharFechamento(db: DB, id: number) {
  const f = buscarFechamento(db, id);
  const eventos = all(
    db,
    `SELECT e.evento, e.justificativa, u.nome AS usuario, e.criado_em AS criadoEm FROM fechamento_eventos e
       JOIN usuarios u ON u.id = e.usuario_id WHERE e.fechamento_id = ? ORDER BY e.id`,
    id,
  );
  return { ...dtoFech(f), resumo: JSON.parse(f.resumo_json), eventos };
}
