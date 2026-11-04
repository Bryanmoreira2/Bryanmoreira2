/**
 * Dados FICTÍCIOS para desenvolvimento local. Não use com dados reais.
 *   npm run seed
 * Usuários criados (senha: nexo-demo-123):
 *   lider@nexo.local, secretaria@nexo.local, tesouraria@nexo.local
 */
import bcrypt from 'bcryptjs';
import { config } from '../src/config.js';
import { one, openDatabase, run, tx } from '../src/db/connection.js';

if (config.isProduction) {
  console.error('Seed bloqueado em produção.');
  process.exit(1);
}

const db = openDatabase(config.databasePath);
if (one(db, 'SELECT 1 FROM usuarios LIMIT 1')) {
  console.error('O banco já possui dados. Apague o arquivo do banco para recriar a base de demonstração.');
  process.exit(1);
}

const SENHA = 'nexo-demo-123';
const hash = bcrypt.hashSync(SENHA, 10);
const diasAtras = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

tx(db, () => {
  const user = (nome: string, email: string, funcoes: string[]) => {
    const { id } = run(db, 'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)', nome, email, hash);
    for (const f of funcoes) run(db, 'INSERT INTO usuario_funcoes (usuario_id, funcao) VALUES (?, ?)', id, f);
    return id;
  };
  const lider = user('Líder Demo', 'lider@nexo.local', ['LIDER']);
  const sec = user('Secretária Demo', 'secretaria@nexo.local', ['SECRETARIO']);
  const tes = user('Tesoureiro Demo', 'tesouraria@nexo.local', ['TESOUREIRO']);

  const nomes = ['Ana Beatriz', 'Bruno Lima', 'Carla Souza', 'Daniel Rocha', 'Eduarda Alves', 'Felipe Martins', 'Gabriela Nunes', 'Henrique Costa', 'Isabela Freitas', 'João Pedro', 'Larissa Melo', 'Mateus Ribeiro'];
  const jovens = nomes.map((n, i) => {
    const ingresso = diasAtras(i === 11 ? 10 : 90);
    const { id } = run(db, 'INSERT INTO jovens (nome, data_ingresso, criado_por) VALUES (?, ?, ?)', n, ingresso, lider);
    run(db, "INSERT INTO jovem_situacoes (jovem_id, situacao, desde, motivo, usuario_id) VALUES (?, 'ATIVO', ?, 'Cadastro', ?)", id, ingresso, lider);
    return { id, ingresso };
  });

  const culto = run(db, 'INSERT INTO atividades (nome, descricao, criado_por) VALUES (?, ?, ?)', 'Culto de Jovens', 'Sábado à noite', lider).id;
  const ensaio = run(db, 'INSERT INTO atividades (nome, descricao, criado_por) VALUES (?, ?, ?)', 'Ensaio do Louvor', null, lider).id;

  for (let s = 8; s >= 1; s--) {
    const data = diasAtras(s * 7);
    for (const at of s % 2 ? [culto] : [culto, ensaio]) {
      const { id: ch } = run(db, "INSERT INTO chamadas (atividade_id, data, status, aberta_por, finalizada_por, finalizada_em) VALUES (?, ?, 'FINALIZADA', ?, ?, ?)", at, data, sec, sec, new Date().toISOString());
      jovens.forEach((j, i) => {
        if (j.ingresso > data) return;
        const presente = i === 3 ? s > 3 : i === 7 ? s % 2 === 0 : (i + s) % 5 !== 0;
        run(db, 'INSERT INTO presencas (chamada_id, jovem_id, status, marcado_por, marcado_em) VALUES (?, ?, ?, ?, ?)', ch, j.id, presente ? 'PRESENTE' : 'AUSENTE', sec, new Date().toISOString());
      });
    }
  }

  const banco = run(db, "INSERT INTO contas (nome, tipo) VALUES ('Conta Bancária', 'BANCO')").id;
  const caixa = run(db, "INSERT INTO contas (nome, tipo) VALUES ('Caixa Físico', 'CAIXA')").id;
  run(db, "INSERT INTO configuracoes (chave, valor) VALUES ('conta_destino_maquininha', ?)", String(banco));
  const mov = (conta: number, tipo: string, valor: number, dias: number, cat: string, desc: string) =>
    run(db, "INSERT INTO movimentacoes (conta_id, tipo, origem, valor_centavos, data, categoria, descricao, usuario_id) VALUES (?, ?, 'MANUAL', ?, ?, ?, ?, ?)", conta, tipo, valor, diasAtras(dias), cat, desc, tes);
  mov(banco, 'ENTRADA', 150000, 60, 'Saldo inicial', 'Saldo de abertura');
  mov(caixa, 'ENTRADA', 32000, 60, 'Saldo inicial', 'Saldo de abertura');
  mov(caixa, 'ENTRADA', 45000, 40, 'Ofertas', 'Oferta do culto de jovens');
  mov(caixa, 'ENTRADA', 18050, 25, 'Cantina', 'Venda de lanches');
  mov(banco, 'SAIDA', 22990, 20, 'Materiais', 'Compra de materiais para retiro');
  mov(caixa, 'SAIDA', 8500, 12, 'Lanches', 'Lanche do ensaio');
  const t = run(db, "INSERT INTO transferencias (conta_origem_id, conta_destino_id, valor_centavos, data, descricao, usuario_id) VALUES (?, ?, 40000, ?, 'Depósito das ofertas', ?)", caixa, banco, diasAtras(15), tes).id;
  run(db, "INSERT INTO movimentacoes (conta_id, tipo, origem, valor_centavos, data, categoria, descricao, transferencia_id, usuario_id) VALUES (?, 'SAIDA', 'TRANSFERENCIA', 40000, ?, 'Transferência interna', 'Para Conta Bancária: Depósito das ofertas', ?, ?)", caixa, diasAtras(15), t, tes);
  run(db, "INSERT INTO movimentacoes (conta_id, tipo, origem, valor_centavos, data, categoria, descricao, transferencia_id, usuario_id) VALUES (?, 'ENTRADA', 'TRANSFERENCIA', 40000, ?, 'Transferência interna', 'De Caixa Físico: Depósito das ofertas', ?, ?)", banco, diasAtras(15), t, tes);
  run(db, "INSERT INTO recebiveis (data_venda, valor_bruto_centavos, taxa_centavos, valor_liquido_centavos, categoria, descricao, previsao_liquidacao, conta_destino_id, usuario_id) VALUES (?, 12000, 360, 11640, 'Cantina', 'Vendas no cartão — cantina', ?, ?, ?)", diasAtras(3), diasAtras(-27), banco, tes);
});

console.log('Base de demonstração criada. Senha de todos os usuários:', SENHA);
db.close();
