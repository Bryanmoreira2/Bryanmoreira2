import { Router } from 'express';
import { z } from 'zod';
import { all, one, run, tx, type DB } from '../../db/connection.js';
import { auditar } from '../../lib/audit.js';
import { hoje } from '../../lib/dates.js';
import { notFound, unprocessable } from '../../lib/errors.js';
import { dataISO, idParam, parse, texto, textoOpcional } from '../../lib/validation.js';
import { exigir, somenteLider, usuario } from '../../middleware/auth.js';
import { frequenciaDoJovem } from '../secretaria/frequencia.js';

interface JovemRow {
  id: number;
  nome: string;
  data_nascimento: string | null;
  telefone: string | null;
  responsavel_nome: string | null;
  responsavel_telefone: string | null;
  observacoes: string | null;
  data_ingresso: string;
  situacao: 'ATIVO' | 'INATIVO';
  criado_em: string;
  atualizado_em: string;
}

const dto = (j: JovemRow) => ({
  id: j.id,
  nome: j.nome,
  dataNascimento: j.data_nascimento,
  telefone: j.telefone,
  responsavelNome: j.responsavel_nome,
  responsavelTelefone: j.responsavel_telefone,
  observacoes: j.observacoes,
  dataIngresso: j.data_ingresso,
  situacao: j.situacao,
  criadoEm: j.criado_em,
  atualizadoEm: j.atualizado_em,
});

// Coleta mínima de dados pessoais (RNF-004)
const camposJovem = {
  nome: texto(120),
  dataNascimento: dataISO.optional().nullable(),
  telefone: textoOpcional(30),
  responsavelNome: textoOpcional(120),
  responsavelTelefone: textoOpcional(30),
  observacoes: textoOpcional(1000),
};

export function buscarJovem(db: DB, id: number) {
  const j = one<JovemRow>(db, 'SELECT * FROM jovens WHERE id = ?', id);
  if (!j) throw notFound('Jovem');
  return j;
}

export function jovensRouter(db: DB) {
  const r = Router();

  r.get('/', exigir('SECRETARIO'), (req, res) => {
    const { situacao, busca } = parse(
      z.object({ situacao: z.enum(['ATIVO', 'INATIVO']).optional(), busca: z.string().trim().max(100).optional() }),
      req.query,
    );
    const rows = all<JovemRow>(
      db,
      `SELECT * FROM jovens WHERE (? IS NULL OR situacao = ?) AND (? IS NULL OR nome LIKE '%' || ? || '%') ORDER BY nome`,
      situacao ?? null,
      situacao ?? null,
      busca || null,
      busca || null,
    );
    res.json(rows.map(dto));
  });

  r.get('/:id', exigir('SECRETARIO'), (req, res) => {
    const j = buscarJovem(db, parse(idParam, req.params.id));
    const historico = all(
      db,
      `SELECT s.situacao, s.desde, s.motivo, s.criado_em AS criadoEm, u.nome AS usuario
         FROM jovem_situacoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.jovem_id = ? ORDER BY s.desde, s.id`,
      j.id,
    );
    res.json({ ...dto(j), historicoSituacao: historico });
  });

  // RF-006 / RN-002 — cadastro exclusivo do líder
  r.post('/', somenteLider(), (req, res) => {
    const u = usuario(req);
    const b = parse(z.object({ ...camposJovem, dataIngresso: dataISO.default(hoje()) }), req.body);
    const id = tx(db, () => {
      const { id } = run(
        db,
        `INSERT INTO jovens (nome, data_nascimento, telefone, responsavel_nome, responsavel_telefone, observacoes, data_ingresso, criado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        b.nome,
        b.dataNascimento ?? null,
        b.telefone,
        b.responsavelNome,
        b.responsavelTelefone,
        b.observacoes,
        b.dataIngresso,
        u.id,
      );
      run(db, 'INSERT INTO jovem_situacoes (jovem_id, situacao, desde, motivo, usuario_id) VALUES (?, ?, ?, ?, ?)', id, 'ATIVO', b.dataIngresso, 'Cadastro', u.id);
      auditar(db, u.id, 'CADASTRAR_JOVEM', 'jovem', id, { nome: b.nome });
      return id;
    });
    res.status(201).json(dto(buscarJovem(db, id)));
  });

  // RF-008 — edição exclusiva do líder
  r.patch('/:id', somenteLider(), (req, res) => {
    const u = usuario(req);
    const id = parse(idParam, req.params.id);
    const b = parse(z.object(camposJovem).partial().strict(), req.body);
    tx(db, () => {
      const atual = buscarJovem(db, id);
      const novo = {
        nome: b.nome ?? atual.nome,
        data_nascimento: b.dataNascimento !== undefined ? b.dataNascimento : atual.data_nascimento,
        telefone: b.telefone !== undefined ? b.telefone : atual.telefone,
        responsavel_nome: b.responsavelNome !== undefined ? b.responsavelNome : atual.responsavel_nome,
        responsavel_telefone: b.responsavelTelefone !== undefined ? b.responsavelTelefone : atual.responsavel_telefone,
        observacoes: b.observacoes !== undefined ? b.observacoes : atual.observacoes,
      };
      run(
        db,
        `UPDATE jovens SET nome = ?, data_nascimento = ?, telefone = ?, responsavel_nome = ?, responsavel_telefone = ?, observacoes = ?,
                atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        novo.nome,
        novo.data_nascimento,
        novo.telefone,
        novo.responsavel_nome,
        novo.responsavel_telefone,
        novo.observacoes,
        id,
      );
      auditar(db, u.id, 'EDITAR_JOVEM', 'jovem', id, { campos: Object.keys(b) });
    });
    res.json(dto(buscarJovem(db, id)));
  });

  // RF-009 / RN-016 / RN-040 — situação definida apenas pelo líder, sem efeito retroativo
  r.patch('/:id/situacao', somenteLider(), (req, res) => {
    const u = usuario(req);
    const id = parse(idParam, req.params.id);
    const b = parse(
      z.object({ situacao: z.enum(['ATIVO', 'INATIVO']), motivo: textoOpcional(300), desde: dataISO.default(hoje()) }),
      req.body,
    );
    tx(db, () => {
      const atual = buscarJovem(db, id);
      if (b.desde > hoje()) throw unprocessable('DATA_FUTURA', 'A data da situação não pode estar no futuro.');
      if (atual.situacao === b.situacao) throw unprocessable('SEM_ALTERACAO', `O jovem já está ${b.situacao.toLowerCase()}.`);
      const ultima = one<{ desde: string }>(db, 'SELECT MAX(desde) AS desde FROM jovem_situacoes WHERE jovem_id = ?', id);
      if (ultima?.desde && b.desde < ultima.desde) {
        throw unprocessable('DATA_RETROATIVA', 'A nova situação não pode ser anterior à última alteração registrada.');
      }
      run(db, "UPDATE jovens SET situacao = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", b.situacao, id);
      run(db, 'INSERT INTO jovem_situacoes (jovem_id, situacao, desde, motivo, usuario_id) VALUES (?, ?, ?, ?, ?)', id, b.situacao, b.desde, b.motivo, u.id);
      auditar(db, u.id, 'ALTERAR_SITUACAO_JOVEM', 'jovem', id, { de: atual.situacao, para: b.situacao, desde: b.desde, motivo: b.motivo });
    });
    res.json(dto(buscarJovem(db, id)));
  });

  // RF-010 / RF-019 — histórico e frequência individual
  r.get('/:id/frequencia', exigir('SECRETARIO'), (req, res) => {
    const id = parse(idParam, req.params.id);
    buscarJovem(db, id);
    const filtros = parse(
      z.object({ inicio: dataISO.optional(), fim: dataISO.optional(), atividadeId: idParam.optional() }),
      req.query,
    );
    res.json(frequenciaDoJovem(db, id, filtros));
  });

  return r;
}
