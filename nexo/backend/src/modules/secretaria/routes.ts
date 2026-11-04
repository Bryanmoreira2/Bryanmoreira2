import { Router } from 'express';
import { z } from 'zod';
import { all, one, run, tx, type DB } from '../../db/connection.js';
import { auditar } from '../../lib/audit.js';
import { agora, hoje } from '../../lib/dates.js';
import { notFound, unprocessable } from '../../lib/errors.js';
import { dataISO, idParam, parse, texto, textoOpcional } from '../../lib/validation.js';
import { exigir, somenteLider, usuario } from '../../middleware/auth.js';
import { alertasFrequencia, frequenciaGeral, percentual } from './frequencia.js';

const statusPresenca = z.enum(['PRESENTE', 'AUSENTE']);

interface ChamadaRow {
  id: number;
  atividade_id: number;
  atividade: string;
  data: string;
  descricao: string | null;
  status: 'ABERTA' | 'FINALIZADA';
  aberta_por: string;
  aberta_em: string;
  finalizada_por: string | null;
  finalizada_em: string | null;
}

const SELECT_CHAMADA = `
  SELECT c.id, c.atividade_id, a.nome AS atividade, c.data, c.descricao, c.status,
         ua.nome AS aberta_por, c.aberta_em, uf.nome AS finalizada_por, c.finalizada_em
    FROM chamadas c
    JOIN atividades a ON a.id = c.atividade_id
    JOIN usuarios ua ON ua.id = c.aberta_por
    LEFT JOIN usuarios uf ON uf.id = c.finalizada_por`;

function buscarChamada(db: DB, id: number): ChamadaRow {
  const c = one<ChamadaRow>(db, `${SELECT_CHAMADA} WHERE c.id = ?`, id);
  if (!c) throw notFound('Chamada');
  return c;
}

export function detalharChamada(db: DB, id: number) {
  const c = buscarChamada(db, id);
  const presencas = all<{ jovem_id: number; nome: string; status: string | null; marcado_em: string | null }>(
    db,
    `SELECT p.jovem_id, j.nome, p.status, p.marcado_em FROM presencas p JOIN jovens j ON j.id = p.jovem_id
      WHERE p.chamada_id = ? ORDER BY j.nome COLLATE NOCASE`,
    id,
  );
  const correcoes = all(
    db,
    `SELECT cc.id, cc.jovem_id AS jovemId, j.nome AS jovem, cc.status_anterior AS statusAnterior, cc.status_novo AS statusNovo,
            cc.justificativa, u.nome AS autorizadoPor, cc.criado_em AS criadoEm
       FROM correcoes_chamada cc JOIN jovens j ON j.id = cc.jovem_id JOIN usuarios u ON u.id = cc.autorizado_por
      WHERE cc.chamada_id = ? ORDER BY cc.id`,
    id,
  );
  return {
    id: c.id,
    atividadeId: c.atividade_id,
    atividade: c.atividade,
    data: c.data,
    descricao: c.descricao,
    status: c.status,
    abertaPor: c.aberta_por,
    abertaEm: c.aberta_em,
    finalizadaPor: c.finalizada_por,
    finalizadaEm: c.finalizada_em,
    presencas: presencas.map((p) => ({ jovemId: p.jovem_id, nome: p.nome, status: p.status, marcadoEm: p.marcado_em })),
    pendentes: presencas.filter((p) => !p.status).length,
    correcoes,
  };
}

/** Mini relatório pós-finalização (RF-017). */
export function resumoChamada(db: DB, id: number) {
  const d = detalharChamada(db, id);
  const presentes = d.presencas.filter((p) => p.status === 'PRESENTE');
  const ausentes = d.presencas.filter((p) => p.status === 'AUSENTE');
  return {
    chamadaId: d.id,
    atividade: d.atividade,
    data: d.data,
    descricao: d.descricao,
    status: d.status,
    finalizadaPor: d.finalizadaPor,
    finalizadaEm: d.finalizadaEm,
    totalElegiveis: d.presencas.length,
    totalPresentes: presentes.length,
    totalAusentes: ausentes.length,
    percentualPresenca: percentual(presentes.length, d.presencas.length),
    presentes: presentes.map((p) => p.nome),
    ausentes: ausentes.map((p) => p.nome),
    correcoes: d.correcoes.length,
  };
}

function exigirAberta(c: ChamadaRow) {
  if (c.status !== 'ABERTA') throw unprocessable('CHAMADA_FINALIZADA', 'A chamada já foi finalizada. Solicite uma correção ao líder.');
}

function marcar(db: DB, chamadaId: number, jovemId: number, status: string, usuarioId: number) {
  const r = run(
    db,
    'UPDATE presencas SET status = ?, marcado_por = ?, marcado_em = ? WHERE chamada_id = ? AND jovem_id = ?',
    status,
    usuarioId,
    agora(),
    chamadaId,
    jovemId,
  );
  if (r.changes === 0) throw unprocessable('JOVEM_NAO_ELEGIVEL', 'Este jovem não faz parte da lista desta chamada.');
}

export function secretariaRouter(db: DB) {
  const r = Router();
  r.use(exigir('SECRETARIO'));

  // ---------- Atividades (RF-011, RN-041) ----------
  r.get('/atividades', (req, res) => {
    const { incluirInativas } = parse(z.object({ incluirInativas: z.enum(['true', 'false']).optional() }), req.query);
    const rows = all<{ id: number; nome: string; descricao: string | null; ativa: number }>(
      db,
      `SELECT id, nome, descricao, ativa FROM atividades ${incluirInativas === 'true' ? '' : 'WHERE ativa = 1'} ORDER BY nome`,
    );
    res.json(rows.map((a) => ({ ...a, ativa: !!a.ativa })));
  });

  r.post('/atividades', somenteLider(), (req, res) => {
    const u = usuario(req);
    const b = parse(z.object({ nome: texto(80), descricao: textoOpcional(300) }), req.body);
    const { id } = run(db, 'INSERT INTO atividades (nome, descricao, criado_por) VALUES (?, ?, ?)', b.nome, b.descricao, u.id);
    auditar(db, u.id, 'CRIAR_ATIVIDADE', 'atividade', id, b);
    res.status(201).json({ id, nome: b.nome, descricao: b.descricao, ativa: true });
  });

  r.patch('/atividades/:id', somenteLider(), (req, res) => {
    const u = usuario(req);
    const id = parse(idParam, req.params.id);
    const b = parse(z.object({ nome: texto(80).optional(), descricao: textoOpcional(300), ativa: z.boolean().optional() }), req.body);
    const atual = one<{ nome: string; descricao: string | null; ativa: number }>(db, 'SELECT nome, descricao, ativa FROM atividades WHERE id = ?', id);
    if (!atual) throw notFound('Atividade');
    const novo = { nome: b.nome ?? atual.nome, descricao: b.descricao !== undefined && 'descricao' in req.body ? b.descricao : atual.descricao, ativa: b.ativa ?? !!atual.ativa };
    run(db, 'UPDATE atividades SET nome = ?, descricao = ?, ativa = ? WHERE id = ?', novo.nome, novo.descricao, novo.ativa, id);
    auditar(db, u.id, 'EDITAR_ATIVIDADE', 'atividade', id, novo);
    res.json({ id, ...novo });
  });

  // ---------- Chamadas ----------
  r.get('/chamadas', (req, res) => {
    const f = parse(
      z.object({ inicio: dataISO.optional(), fim: dataISO.optional(), atividadeId: idParam.optional(), status: z.enum(['ABERTA', 'FINALIZADA']).optional() }),
      req.query,
    );
    const rows = all<ChamadaRow & { elegiveis: number; presentes: number; pendentes: number }>(
      db,
      `SELECT c.id, c.atividade_id, a.nome AS atividade, c.data, c.descricao, c.status, ua.nome AS aberta_por, c.aberta_em,
              uf.nome AS finalizada_por, c.finalizada_em,
              (SELECT COUNT(*) FROM presencas p WHERE p.chamada_id = c.id) AS elegiveis,
              (SELECT COUNT(*) FROM presencas p WHERE p.chamada_id = c.id AND p.status = 'PRESENTE') AS presentes,
              (SELECT COUNT(*) FROM presencas p WHERE p.chamada_id = c.id AND p.status IS NULL) AS pendentes
         FROM chamadas c JOIN atividades a ON a.id = c.atividade_id JOIN usuarios ua ON ua.id = c.aberta_por
         LEFT JOIN usuarios uf ON uf.id = c.finalizada_por
        WHERE (? IS NULL OR c.data >= ?) AND (? IS NULL OR c.data <= ?) AND (? IS NULL OR c.atividade_id = ?) AND (? IS NULL OR c.status = ?)
        ORDER BY c.data DESC, c.id DESC LIMIT 500`,
      f.inicio ?? null, f.inicio ?? null, f.fim ?? null, f.fim ?? null,
      f.atividadeId ?? null, f.atividadeId ?? null, f.status ?? null, f.status ?? null,
    );
    res.json(
      rows.map((c) => ({
        id: c.id, atividadeId: c.atividade_id, atividade: c.atividade, data: c.data, descricao: c.descricao, status: c.status,
        abertaPor: c.aberta_por, finalizadaPor: c.finalizada_por, finalizadaEm: c.finalizada_em,
        elegiveis: c.elegiveis, presentes: c.presentes, pendentes: c.pendentes, percentualPresenca: percentual(c.presentes, c.elegiveis),
      })),
    );
  });

  // RF-012 / RF-013 — abre a chamada com o retrato dos jovens elegíveis na data
  r.post('/chamadas', (req, res) => {
    const u = usuario(req);
    const b = parse(z.object({ atividadeId: idParam, data: dataISO.default(hoje()), descricao: textoOpcional(200) }), req.body);
    if (b.data > hoje()) throw unprocessable('DATA_FUTURA', 'Não é possível abrir chamada para data futura.');
    const id = tx(db, () => {
      const at = one<{ ativa: number }>(db, 'SELECT ativa FROM atividades WHERE id = ?', b.atividadeId);
      if (!at) throw notFound('Atividade');
      if (!at.ativa) throw unprocessable('ATIVIDADE_INATIVA', 'Esta atividade não está autorizada para chamadas.');
      const { id } = run(db, 'INSERT INTO chamadas (atividade_id, data, descricao, aberta_por) VALUES (?, ?, ?, ?)', b.atividadeId, b.data, b.descricao, u.id);
      const elegiveis = run(
        db,
        `INSERT INTO presencas (chamada_id, jovem_id)
         SELECT ?, j.id FROM jovens j
          WHERE j.data_ingresso <= ?
            AND (SELECT s.situacao FROM jovem_situacoes s WHERE s.jovem_id = j.id AND s.desde <= ?
                  ORDER BY s.desde DESC, s.id DESC LIMIT 1) = 'ATIVO'`,
        id,
        b.data,
        b.data,
      );
      auditar(db, u.id, 'ABRIR_CHAMADA', 'chamada', id, { ...b, elegiveis: elegiveis.changes });
      return id;
    });
    res.status(201).json(detalharChamada(db, id));
  });

  r.get('/chamadas/:id', (req, res) => res.json(detalharChamada(db, parse(idParam, req.params.id))));

  r.get('/chamadas/:id/resumo', (req, res) => res.json(resumoChamada(db, parse(idParam, req.params.id))));

  // RF-014 / RF-015 — marcação individual (corrigível enquanto aberta)
  r.put('/chamadas/:id/presencas/:jovemId', (req, res) => {
    const u = usuario(req);
    const id = parse(idParam, req.params.id);
    const jovemId = parse(idParam, req.params.jovemId);
    const { status } = parse(z.object({ status: statusPresenca }), req.body);
    exigirAberta(buscarChamada(db, id));
    marcar(db, id, jovemId, status, u.id);
    res.json({ jovemId, status });
  });

  // Marcação em lote (ex.: "marcar restantes como ausentes")
  r.put('/chamadas/:id/presencas', (req, res) => {
    const u = usuario(req);
    const id = parse(idParam, req.params.id);
    const { marcacoes } = parse(z.object({ marcacoes: z.array(z.object({ jovemId: idParam, status: statusPresenca })).min(1).max(1000) }), req.body);
    tx(db, () => {
      exigirAberta(buscarChamada(db, id));
      for (const m of marcacoes) marcar(db, id, m.jovemId, m.status, u.id);
    });
    res.json(detalharChamada(db, id));
  });

  // RF-016 / RN-010 / RN-011 / RN-035
  r.post('/chamadas/:id/finalizacao', (req, res) => {
    const u = usuario(req);
    const id = parse(idParam, req.params.id);
    tx(db, () => {
      exigirAberta(buscarChamada(db, id));
      const pend = all<{ nome: string }>(
        db,
        'SELECT j.nome FROM presencas p JOIN jovens j ON j.id = p.jovem_id WHERE p.chamada_id = ? AND p.status IS NULL ORDER BY j.nome',
        id,
      );
      if (pend.length) throw unprocessable('MARCACOES_PENDENTES', `Há ${pend.length} jovem(ns) sem marcação.`, pend.map((p) => p.nome));
      run(db, "UPDATE chamadas SET status = 'FINALIZADA', finalizada_por = ?, finalizada_em = ? WHERE id = ?", u.id, agora(), id);
      auditar(db, u.id, 'FINALIZAR_CHAMADA', 'chamada', id);
    });
    res.json(resumoChamada(db, id));
  });

  // ---------- Correções de chamada finalizada (RF-048, RN-036) ----------
  r.get('/chamadas/:id/solicitacoes-correcao', (req, res) => {
    const id = parse(idParam, req.params.id);
    buscarChamada(db, id);
    res.json(listarSolicitacoes(db, id));
  });

  r.post('/chamadas/:id/solicitacoes-correcao', (req, res) => {
    const u = usuario(req);
    const id = parse(idParam, req.params.id);
    const b = parse(z.object({ jovemId: idParam, status: statusPresenca, justificativa: texto(500) }), req.body);
    const c = buscarChamada(db, id);
    if (c.status !== 'FINALIZADA') throw unprocessable('CHAMADA_ABERTA', 'A chamada ainda está aberta; corrija a marcação diretamente.');
    if (!one(db, 'SELECT 1 FROM presencas WHERE chamada_id = ? AND jovem_id = ?', id, b.jovemId)) {
      throw unprocessable('JOVEM_NAO_ELEGIVEL', 'Este jovem não faz parte da lista desta chamada.');
    }
    const s = run(
      db,
      'INSERT INTO solicitacoes_correcao (chamada_id, jovem_id, status_sugerido, justificativa, solicitado_por) VALUES (?, ?, ?, ?, ?)',
      id, b.jovemId, b.status, b.justificativa, u.id,
    );
    auditar(db, u.id, 'SOLICITAR_CORRECAO_CHAMADA', 'chamada', id, { solicitacaoId: s.id, ...b });
    res.status(201).json(listarSolicitacoes(db, id).find((x) => x.id === s.id));
  });

  r.get('/solicitacoes-correcao', somenteLider(), (_req, res) => res.json(listarSolicitacoes(db, null, 'PENDENTE')));

  r.post('/chamadas/:id/correcoes', somenteLider(), (req, res) => {
    const u = usuario(req);
    const id = parse(idParam, req.params.id);
    const b = parse(z.object({ jovemId: idParam, status: statusPresenca, justificativa: texto(500), solicitacaoId: idParam.optional() }), req.body);
    tx(db, () => {
      const c = buscarChamada(db, id);
      if (c.status !== 'FINALIZADA') throw unprocessable('CHAMADA_ABERTA', 'A chamada ainda está aberta; corrija a marcação diretamente.');
      const p = one<{ status: string | null }>(db, 'SELECT status FROM presencas WHERE chamada_id = ? AND jovem_id = ?', id, b.jovemId);
      if (!p) throw unprocessable('JOVEM_NAO_ELEGIVEL', 'Este jovem não faz parte da lista desta chamada.');
      if (b.solicitacaoId) {
        const s = one<{ situacao: string; chamada_id: number }>(db, 'SELECT situacao, chamada_id FROM solicitacoes_correcao WHERE id = ?', b.solicitacaoId);
        if (!s || s.chamada_id !== id) throw notFound('Solicitação de correção');
        if (s.situacao !== 'PENDENTE') throw unprocessable('SOLICITACAO_RESOLVIDA', 'Esta solicitação já foi resolvida.');
        run(db, "UPDATE solicitacoes_correcao SET situacao = 'APLICADA', resolvido_por = ?, resolvido_em = ? WHERE id = ?", u.id, agora(), b.solicitacaoId);
      }
      if (p.status === b.status) throw unprocessable('SEM_ALTERACAO', 'A marcação já possui este valor.');
      run(
        db,
        'INSERT INTO correcoes_chamada (chamada_id, jovem_id, status_anterior, status_novo, justificativa, solicitacao_id, autorizado_por) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, b.jovemId, p.status, b.status, b.justificativa, b.solicitacaoId ?? null, u.id,
      );
      marcar(db, id, b.jovemId, b.status, u.id);
      auditar(db, u.id, 'CORRIGIR_CHAMADA', 'chamada', id, { ...b, statusAnterior: p.status });
    });
    res.json(detalharChamada(db, id));
  });

  r.post('/solicitacoes-correcao/:id/rejeicao', somenteLider(), (req, res) => {
    const u = usuario(req);
    const id = parse(idParam, req.params.id);
    const { resposta } = parse(z.object({ resposta: texto(500) }), req.body);
    const r2 = run(
      db,
      "UPDATE solicitacoes_correcao SET situacao = 'REJEITADA', resolvido_por = ?, resolvido_em = ?, resposta = ? WHERE id = ? AND situacao = 'PENDENTE'",
      u.id, agora(), resposta, id,
    );
    if (!r2.changes) throw notFound('Solicitação pendente');
    auditar(db, u.id, 'REJEITAR_CORRECAO_CHAMADA', 'solicitacao_correcao', id, { resposta });
    res.status(204).end();
  });

  // ---------- Indicadores e alertas (RF-020, RF-047) ----------
  r.get('/frequencia', (req, res) => {
    const f = parse(z.object({ inicio: dataISO.optional(), fim: dataISO.optional(), atividadeId: idParam.optional() }), req.query);
    res.json(frequenciaGeral(db, f));
  });

  r.get('/alertas-frequencia', (_req, res) => res.json(alertasFrequencia(db)));

  return r;
}

function listarSolicitacoes(db: DB, chamadaId: number | null, situacao?: string) {
  return all<{ id: number }>(
    db,
    `SELECT s.id, s.chamada_id AS chamadaId, c.data, a.nome AS atividade, s.jovem_id AS jovemId, j.nome AS jovem,
            p.status AS statusAtual, s.status_sugerido AS statusSugerido, s.justificativa, us.nome AS solicitadoPor,
            s.solicitado_em AS solicitadoEm, s.situacao, ur.nome AS resolvidoPor, s.resolvido_em AS resolvidoEm, s.resposta
       FROM solicitacoes_correcao s
       JOIN chamadas c ON c.id = s.chamada_id JOIN atividades a ON a.id = c.atividade_id
       JOIN jovens j ON j.id = s.jovem_id JOIN usuarios us ON us.id = s.solicitado_por
       LEFT JOIN presencas p ON p.chamada_id = s.chamada_id AND p.jovem_id = s.jovem_id
       LEFT JOIN usuarios ur ON ur.id = s.resolvido_por
      WHERE (? IS NULL OR s.chamada_id = ?) AND (? IS NULL OR s.situacao = ?)
      ORDER BY s.id DESC`,
    chamadaId, chamadaId, situacao ?? null, situacao ?? null,
  );
}
