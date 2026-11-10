import type { DatabaseSync } from 'node:sqlite';

/**
 * Migrações versionadas. Cada item é aplicado uma única vez, na ordem.
 * Valores monetários são sempre armazenados em centavos inteiros (RNF-005).
 */
const migrations: string[] = [
  `
  CREATE TABLE usuarios (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    senha_hash TEXT NOT NULL,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE usuario_funcoes (
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    funcao TEXT NOT NULL CHECK (funcao IN ('LIDER','SECRETARIO','TESOUREIRO')),
    atribuida_por INTEGER REFERENCES usuarios(id),
    atribuida_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (usuario_id, funcao)
  );

  CREATE TABLE jovens (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    data_nascimento TEXT,
    telefone TEXT,
    responsavel_nome TEXT,
    responsavel_telefone TEXT,
    observacoes TEXT,
    data_ingresso TEXT NOT NULL,
    situacao TEXT NOT NULL DEFAULT 'ATIVO' CHECK (situacao IN ('ATIVO','INATIVO')),
    criado_por INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  -- Histórico de situação: base da elegibilidade histórica (RN-037, RN-040)
  CREATE TABLE jovem_situacoes (
    id INTEGER PRIMARY KEY,
    jovem_id INTEGER NOT NULL REFERENCES jovens(id),
    situacao TEXT NOT NULL CHECK (situacao IN ('ATIVO','INATIVO')),
    desde TEXT NOT NULL,
    motivo TEXT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_jovem_situacoes ON jovem_situacoes(jovem_id, desde);

  CREATE TABLE atividades (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
    descricao TEXT,
    ativa INTEGER NOT NULL DEFAULT 1,
    criado_por INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE chamadas (
    id INTEGER PRIMARY KEY,
    atividade_id INTEGER NOT NULL REFERENCES atividades(id),
    data TEXT NOT NULL,
    descricao TEXT,
    status TEXT NOT NULL DEFAULT 'ABERTA' CHECK (status IN ('ABERTA','FINALIZADA')),
    aberta_por INTEGER NOT NULL REFERENCES usuarios(id),
    aberta_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    finalizada_por INTEGER REFERENCES usuarios(id),
    finalizada_em TEXT
  );
  CREATE INDEX idx_chamadas_data ON chamadas(data);

  -- Uma linha por jovem elegível na chamada (RN-009). status NULL = pendente.
  CREATE TABLE presencas (
    chamada_id INTEGER NOT NULL REFERENCES chamadas(id),
    jovem_id INTEGER NOT NULL REFERENCES jovens(id),
    status TEXT CHECK (status IN ('PRESENTE','AUSENTE')),
    marcado_por INTEGER REFERENCES usuarios(id),
    marcado_em TEXT,
    PRIMARY KEY (chamada_id, jovem_id)
  );

  CREATE TABLE solicitacoes_correcao (
    id INTEGER PRIMARY KEY,
    chamada_id INTEGER NOT NULL REFERENCES chamadas(id),
    jovem_id INTEGER NOT NULL REFERENCES jovens(id),
    status_sugerido TEXT NOT NULL CHECK (status_sugerido IN ('PRESENTE','AUSENTE')),
    justificativa TEXT NOT NULL,
    solicitado_por INTEGER NOT NULL REFERENCES usuarios(id),
    solicitado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    situacao TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (situacao IN ('PENDENTE','APLICADA','REJEITADA')),
    resolvido_por INTEGER REFERENCES usuarios(id),
    resolvido_em TEXT,
    resposta TEXT
  );

  -- Correções preservam o valor original (RN-012, RN-036)
  CREATE TABLE correcoes_chamada (
    id INTEGER PRIMARY KEY,
    chamada_id INTEGER NOT NULL REFERENCES chamadas(id),
    jovem_id INTEGER NOT NULL REFERENCES jovens(id),
    status_anterior TEXT,
    status_novo TEXT NOT NULL,
    justificativa TEXT NOT NULL,
    solicitacao_id INTEGER REFERENCES solicitacoes_correcao(id),
    autorizado_por INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE contas (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
    tipo TEXT NOT NULL CHECK (tipo IN ('BANCO','CAIXA')),
    ativa INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE transferencias (
    id INTEGER PRIMARY KEY,
    conta_origem_id INTEGER NOT NULL REFERENCES contas(id),
    conta_destino_id INTEGER NOT NULL REFERENCES contas(id),
    valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
    data TEXT NOT NULL,
    descricao TEXT NOT NULL,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (conta_origem_id <> conta_destino_id)
  );

  -- Vendas no cartão: bruto, taxa, líquido e conta de destino (DP-004)
  CREATE TABLE recebiveis (
    id INTEGER PRIMARY KEY,
    data_venda TEXT NOT NULL,
    valor_bruto_centavos INTEGER NOT NULL CHECK (valor_bruto_centavos > 0),
    taxa_centavos INTEGER NOT NULL CHECK (taxa_centavos >= 0),
    valor_liquido_centavos INTEGER NOT NULL CHECK (valor_liquido_centavos > 0),
    categoria TEXT NOT NULL,
    descricao TEXT NOT NULL,
    previsao_liquidacao TEXT,
    conta_destino_id INTEGER NOT NULL REFERENCES contas(id),
    status TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','LIQUIDADO','CANCELADO')),
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    data_liquidacao TEXT,
    liquidado_em TEXT,
    liquidado_por INTEGER REFERENCES usuarios(id),
    cancelado_motivo TEXT,
    CHECK (valor_liquido_centavos = valor_bruto_centavos - taxa_centavos)
  );

  CREATE TABLE movimentacoes (
    id INTEGER PRIMARY KEY,
    conta_id INTEGER NOT NULL REFERENCES contas(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('ENTRADA','SAIDA')),
    origem TEXT NOT NULL CHECK (origem IN ('MANUAL','TRANSFERENCIA','LIQUIDACAO','ESTORNO')),
    valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
    data TEXT NOT NULL,
    categoria TEXT NOT NULL,
    descricao TEXT NOT NULL,
    transferencia_id INTEGER REFERENCES transferencias(id),
    recebivel_id INTEGER REFERENCES recebiveis(id),
    estorno_de INTEGER UNIQUE REFERENCES movimentacoes(id),
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_mov_conta_data ON movimentacoes(conta_id, data);
  -- Uma liquidação por recebível (RN-023)
  CREATE UNIQUE INDEX idx_mov_liquidacao ON movimentacoes(recebivel_id) WHERE origem = 'LIQUIDACAO';

  CREATE TABLE fechamentos (
    id INTEGER PRIMARY KEY,
    ano INTEGER NOT NULL,
    mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
    status TEXT NOT NULL CHECK (status IN ('RASCUNHO','ENVIADO','APROVADO','DEVOLVIDO','REABERTO')),
    resumo_json TEXT NOT NULL,
    observacao TEXT,
    preparado_por INTEGER NOT NULL REFERENCES usuarios(id),
    preparado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    enviado_por INTEGER REFERENCES usuarios(id),
    enviado_em TEXT,
    decidido_por INTEGER REFERENCES usuarios(id),
    decidido_em TEXT,
    UNIQUE (ano, mes)
  );

  CREATE TABLE fechamento_eventos (
    id INTEGER PRIMARY KEY,
    fechamento_id INTEGER NOT NULL REFERENCES fechamentos(id),
    evento TEXT NOT NULL,
    justificativa TEXT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE configuracoes (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  );

  CREATE TABLE relatorios_emitidos (
    id INTEGER PRIMARY KEY,
    numero TEXT NOT NULL UNIQUE,
    tipo TEXT NOT NULL,
    periodo_inicio TEXT,
    periodo_fim TEXT,
    parametros_json TEXT NOT NULL,
    emitido_por INTEGER NOT NULL REFERENCES usuarios(id),
    emitido_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  -- Auditoria append-only (RNF-006)
  CREATE TABLE auditoria (
    id INTEGER PRIMARY KEY,
    usuario_id INTEGER REFERENCES usuarios(id),
    acao TEXT NOT NULL,
    entidade TEXT NOT NULL,
    entidade_id TEXT,
    detalhes_json TEXT,
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TRIGGER auditoria_sem_update BEFORE UPDATE ON auditoria
    BEGIN SELECT RAISE(ABORT, 'auditoria é somente inclusão'); END;
  CREATE TRIGGER auditoria_sem_delete BEFORE DELETE ON auditoria
    BEGIN SELECT RAISE(ABORT, 'auditoria é somente inclusão'); END;

  -- Proteção contra operações duplicadas por reenvio (RNF-008)
  CREATE TABLE idempotencia (
    chave TEXT NOT NULL,
    usuario_id INTEGER NOT NULL,
    rota TEXT NOT NULL,
    status_http INTEGER NOT NULL,
    resposta_json TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (chave, usuario_id)
  );
  `,
];

export function migrate(db: DatabaseSync): void {
  db.exec('CREATE TABLE IF NOT EXISTS _migracoes (versao INTEGER PRIMARY KEY, aplicada_em TEXT NOT NULL)');
  const row = db.prepare('SELECT COALESCE(MAX(versao), 0) AS v FROM _migracoes').get() as { v: number };
  for (let i = row.v; i < migrations.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[i]!);
      db.prepare('INSERT INTO _migracoes (versao, aplicada_em) VALUES (?, ?)').run(i + 1, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
