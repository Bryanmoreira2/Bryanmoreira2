# NEXO JOVEM

Sistema de gestão da **Secretaria** (cadastro de jovens, chamadas e frequência) e da **Tesouraria** (banco, caixa físico, maquininha de cartão e fechamento mensal) de um grupo de jovens.

Implementa o **MVP v1.0** descrito em *NEXO JOVEM — Documentação de Requisitos v1.1* (Notion).

```
nexo/
├── backend/    API REST — Node.js 22 + TypeScript + Express 5 + SQLite (node:sqlite)
└── frontend/   SPA — React 18 + TypeScript + Vite
```

O backend e o frontend são projetos independentes, cada um com seu `package.json`, e se comunicam apenas por HTTP (`/api`).

## Como rodar localmente

Requisitos: **Node.js 22.13 ou superior** (o banco usa o módulo nativo `node:sqlite`, sem dependências nativas).

```bash
# 1) Backend
cd nexo/backend
npm install
cp .env.example .env          # ajuste JWT_SECRET
npm run seed                  # dados FICTÍCIOS de demonstração (opcional)
npm run dev                   # http://localhost:3333

# 2) Frontend (outro terminal)
cd nexo/frontend
npm install
npm run dev                   # http://localhost:5173  (proxy /api → :3333)
```

Usuários da base de demonstração (senha `nexo-demo-123`): `lider@nexo.local`, `secretaria@nexo.local`, `tesouraria@nexo.local`.

### Primeiro líder em uma base real (RN-042)

Não existe cadastro público de administradores. O primeiro líder é criado por quem tem acesso ao servidor:

```bash
cd nexo/backend
NEXO_LIDER_SENHA='uma-senha-forte' npm run provisionar-lider -- --nome "Nome do Líder" --email lider@igreja.org
```

Depois disso, o líder cria os acessos individuais de secretários e tesoureiros em **Usuários e funções**.

## Testes

```bash
cd nexo/backend && npm test        # 24 testes de API (permissões, chamadas, frequência, saldos, fechamento)
cd nexo/backend && npm run typecheck
cd nexo/frontend && npm run build  # checagem de tipos + build de produção
```

## Arquitetura

### Backend (`nexo/backend`)

| Pasta | Conteúdo |
| --- | --- |
| `src/db` | Conexão, helpers (`one`, `all`, `run`, `tx`) e migrações versionadas |
| `src/middleware` | Autenticação (cookie httpOnly com JWT), autorização por função, idempotência, erros |
| `src/modules/auth`, `usuarios` | Login/logout/sessão, troca de senha, gestão de acessos e funções |
| `src/modules/jovens` | Cadastro, situação com histórico e frequência individual |
| `src/modules/secretaria` | Atividades, chamadas, presenças, correções, indicadores e alertas |
| `src/modules/tesouraria` | Contas, saldos, movimentações, estornos, transferências, recebíveis, fechamentos |
| `src/modules/relatorios` | PDFs A4 numerados (Secretaria, chamada, financeiro, fechamento) |
| `src/modules/auditoria` | Consulta da trilha de auditoria |
| `scripts/` | Provisionamento do primeiro líder, seed de demonstração e backup |

Decisões principais:

- **Autorização no backend** (RN-031): todas as rotas validam a função; o líder tem acesso geral. Usuário e funções são relidos do banco a cada requisição, então revogar uma função ou desativar um usuário vale na hora (RN-007).
- **Dinheiro em centavos inteiros** (RNF-005), com restrições `CHECK` no banco (valor > 0, líquido = bruto − taxa).
- **Elegibilidade histórica** (RN-037): ao abrir a chamada, o sistema grava a lista de jovens ativos *naquela data* (a partir do histórico de situação). A frequência usa só essas linhas, então quem entrou depois não ganha faltas retroativas e inativar alguém não reescreve o passado.
- **Correções preservam o original**: chamadas finalizadas só mudam por correção do líder, que fica registrada com o valor anterior (RN-012, RN-036). Lançamentos financeiros são corrigidos por **estorno** (lançamento inverso), nunca por edição (RN-025).
- **Sem dupla contabilização**: a venda no cartão vira receita (bruto) e taxa (despesa) na data da venda; a liquidação só move dinheiro para o banco. Transferências internas também não são receita nem despesa (RN-020, RN-023).
- **Bloqueio de período**: com o fechamento aprovado, qualquer lançamento datado naquele mês é recusado com `409 PERIODO_FECHADO`, até o líder reabrir com justificativa (RN-046, RN-047).
- **Auditoria somente-inclusão**: gatilhos SQLite impedem `UPDATE`/`DELETE` na tabela `auditoria` (RNF-006).
- **Operações repetidas**: escritas financeiras aceitam o cabeçalho `Idempotency-Key`, e o frontend envia esse cabeçalho. Se a mesma requisição chegar de novo depois de uma falha de rede, a API devolve a primeira resposta em vez de criar um segundo lançamento. Escritas que mexem em várias tabelas rodam em transação (RNF-008).
- **Segurança**: senhas com bcrypt, cookie `httpOnly` + `SameSite=Lax` (+ `Secure` em produção), `helmet`, CORS restrito, limite de tentativas de login.

### Frontend (`nexo/frontend`)

- `src/api` — cliente HTTP (cookies, erros, `Idempotency-Key`), tipos e formatação (moeda/datas).
- `src/auth` — contexto de sessão; menus e telas são exibidos conforme as funções (só para conforto: quem barra o acesso é a API).
- `src/pages/secretaria` — Chamadas, **Chamada no tablet** (botões grandes de Presente/Ausente, contadores, “restantes ausentes”, mini relatório), Jovens, Frequência e alertas, Atividades, Correções.
- `src/pages/tesouraria` — Painel e contas, Movimentações (com estorno), Maquininha, Fechamentos.
- `src/pages/admin` — Usuários e funções, Auditoria.
- Layout responsivo (computador, tablet e celular) com tema claro/escuro automático.

## API (resumo)

Todas as rotas ficam sob `/api` e, exceto `auth/login`, exigem sessão.

| Área | Rotas |
| --- | --- |
| Autenticação | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/senha` |
| Usuários (líder) | `GET/POST /usuarios`, `PUT /usuarios/:id/funcoes`, `PATCH /usuarios/:id/situacao`, `PATCH /usuarios/:id/senha` |
| Jovens | `GET/POST /jovens`, `GET/PATCH /jovens/:id`, `PATCH /jovens/:id/situacao`, `GET /jovens/:id/frequencia` |
| Secretaria | `GET/POST /secretaria/atividades`, `PATCH /secretaria/atividades/:id`, `GET/POST /secretaria/chamadas`, `GET /secretaria/chamadas/:id`, `GET /secretaria/chamadas/:id/resumo`, `PUT /secretaria/chamadas/:id/presencas[/:jovemId]`, `POST /secretaria/chamadas/:id/finalizacao`, `GET/POST /secretaria/chamadas/:id/solicitacoes-correcao`, `POST /secretaria/chamadas/:id/correcoes`, `GET /secretaria/solicitacoes-correcao`, `POST /secretaria/solicitacoes-correcao/:id/rejeicao`, `GET /secretaria/frequencia`, `GET /secretaria/alertas-frequencia` |
| Tesouraria | `GET/POST /tesouraria/contas`, `PATCH /tesouraria/contas/:id`, `GET /tesouraria/contas/:id/saldo`, `GET /tesouraria/posicao`, `PUT /tesouraria/configuracoes/conta-maquininha`, `GET/POST /tesouraria/movimentacoes`, `POST /tesouraria/movimentacoes/:id/estorno`, `GET/POST /tesouraria/transferencias`, `GET/POST /tesouraria/recebiveis`, `POST /tesouraria/recebiveis/:id/liquidacao`, `POST /tesouraria/recebiveis/:id/cancelamento`, `GET /tesouraria/resultado`, `GET/POST /tesouraria/fechamentos`, `GET /tesouraria/fechamentos/:id`, `POST /tesouraria/fechamentos/:id/{envio,aprovacao,reabertura}` |
| Relatórios (PDF) | `GET /relatorios`, `GET /relatorios/secretaria`, `GET /relatorios/secretaria/chamadas/:id`, `GET /relatorios/tesouraria`, `GET /relatorios/tesouraria/fechamentos/:id` |
| Auditoria (líder) | `GET /auditoria` |

Os erros seguem o formato `{ "erro": { "codigo": "...", "mensagem": "...", "detalhes": ... } }`.

## Critérios de aceitação do MVP

| # | Critério | Onde |
| --- | --- | --- |
| 1 | Só o líder cria/edita jovens, altera a situação e atribui funções | `jovens/routes.ts`, `usuarios/routes.ts`, `tests/permissoes.test.ts` |
| 2 | Chamada no tablet, finalização e mini relatório | `pages/secretaria/Chamada.tsx`, `tests/secretaria.test.ts` |
| 3 | Secretário sem acesso financeiro; tesoureiro sem acesso a cadastros | `tests/permissoes.test.ts` |
| 4 | Frequência com elegibilidade histórica; o alerta não inativa ninguém | `secretaria/frequencia.ts`, `tests/secretaria.test.ts` |
| 5 | Receitas, despesas e transferências com saldos corretos | `tests/tesouraria.test.ts` |
| 6–7 | Cartão a receber separado do disponível; liquidação e transferência sem duplicar receita | `tesouraria/service.ts`, `tests/tesouraria.test.ts` |
| 8–9 | Fechamento: tesoureiro envia, líder aprova e bloqueia; reabertura justificada e auditada | `tesouraria/routes.ts`, `tests/tesouraria.test.ts` |
| 10 | PDFs com número, período, responsáveis e campos de assinatura | `lib/pdf.ts`, `relatorios/routes.ts` |
| 11 | A API impede acesso não autorizado independentemente da tela | `middleware/auth.ts` |
| 12 | Testes automatizados das regras críticas | `backend/tests/` |

## Produção

- Sirva o frontend (`npm run build` → `frontend/dist`) e a API **no mesmo domínio** (ex.: proxy reverso `/api` → backend). Assim o cookie de sessão funciona sem `SameSite=None`.
- Defina `NODE_ENV=production`, um `JWT_SECRET` forte (≥ 32 caracteres) e use HTTPS (RNF-003).
- **Backup** (RNF-007): agende `npm run backup` (ex.: cron diário). Ele gera uma cópia consistente via `VACUUM INTO`, checa a integridade e mantém os últimos 30 arquivos. Para restaurar, pare a API e troque o arquivo apontado por `DATABASE_PATH`. Teste a restauração de tempos em tempos.

## Fora do MVP / próximos passos

- **v1.1**: importação de extratos CSV/OFX com prévia, detecção de duplicidade e conciliação (RF-035 a RF-039), além de exportação para planilhas.
- **v2.0**: extratos em PDF, sugestão de categorias, notificações e suporte a vários grupos.
- **Pontos a validar com a liderança** (seção 11 do documento): ausências justificadas, limites de alerta, banco e prazos da maquininha, quem assina cada relatório, periodicidade do fechamento e a base legal/LGPD para dados de participação religiosa e de menores. As regras de alerta estão em constantes únicas (`secretaria/frequencia.ts`) para facilitar ajustes.
