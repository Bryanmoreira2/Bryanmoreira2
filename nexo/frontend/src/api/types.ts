export type Funcao = 'LIDER' | 'SECRETARIO' | 'TESOUREIRO';

export interface Usuario {
  id: number;
  nome: string;
  email: string;
  funcoes: Funcao[];
}

export interface UsuarioAdmin extends Usuario {
  ativo: boolean;
  criadoEm: string;
}

export interface Jovem {
  id: number;
  nome: string;
  dataNascimento: string | null;
  telefone: string | null;
  responsavelNome: string | null;
  responsavelTelefone: string | null;
  observacoes: string | null;
  dataIngresso: string;
  situacao: 'ATIVO' | 'INATIVO';
}

export interface JovemDetalhe extends Jovem {
  historicoSituacao: Array<{ situacao: string; desde: string; motivo: string | null; usuario: string; criadoEm: string }>;
}

export interface Atividade {
  id: number;
  nome: string;
  descricao: string | null;
  ativa: boolean;
}

export type StatusPresenca = 'PRESENTE' | 'AUSENTE';

export interface ChamadaResumoLista {
  id: number;
  atividadeId: number;
  atividade: string;
  data: string;
  descricao: string | null;
  status: 'ABERTA' | 'FINALIZADA';
  abertaPor: string;
  finalizadaPor: string | null;
  elegiveis: number;
  presentes: number;
  pendentes: number;
  percentualPresenca: number | null;
}

export interface Chamada {
  id: number;
  atividadeId: number;
  atividade: string;
  data: string;
  descricao: string | null;
  status: 'ABERTA' | 'FINALIZADA';
  abertaPor: string;
  abertaEm: string;
  finalizadaPor: string | null;
  finalizadaEm: string | null;
  presencas: Array<{ jovemId: number; nome: string; status: StatusPresenca | null }>;
  pendentes: number;
  correcoes: Array<{ id: number; jovem: string; statusAnterior: string | null; statusNovo: string; justificativa: string; autorizadoPor: string; criadoEm: string }>;
}

export interface MiniRelatorio {
  chamadaId: number;
  atividade: string;
  data: string;
  totalElegiveis: number;
  totalPresentes: number;
  totalAusentes: number;
  percentualPresenca: number | null;
  presentes: string[];
  ausentes: string[];
  finalizadaPor: string | null;
  finalizadaEm: string | null;
}

export interface SolicitacaoCorrecao {
  id: number;
  chamadaId: number;
  data: string;
  atividade: string;
  jovemId: number;
  jovem: string;
  statusAtual: StatusPresenca | null;
  statusSugerido: StatusPresenca;
  justificativa: string;
  solicitadoPor: string;
  solicitadoEm: string;
  situacao: 'PENDENTE' | 'APLICADA' | 'REJEITADA';
  resposta: string | null;
}

export interface ResumoFrequencia {
  atividadesElegiveis: number;
  presencas: number;
  ausencias: number;
  percentual: number | null;
}

export interface FrequenciaJovem extends ResumoFrequencia {
  alerta: { ativo: boolean; motivos: string[] };
  historico: Array<{ chamadaId: number; data: string; atividade: string; status: StatusPresenca }>;
}

export interface FrequenciaGeral extends ResumoFrequencia {
  totalChamadas: number;
  porAtividade: Array<ResumoFrequencia & { atividadeId: number; atividade: string; chamadas: number }>;
  porJovem: Array<ResumoFrequencia & { jovemId: number; nome: string; situacao: string }>;
}

export interface AlertaFrequencia extends ResumoFrequencia {
  jovemId: number;
  nome: string;
  motivos: string[];
  ultimaPresenca: string | null;
}

export interface Conta {
  id: number;
  nome: string;
  tipo: 'BANCO' | 'CAIXA';
  ativa: boolean;
  saldoCentavos: number;
}

export interface Posicao {
  contas: Conta[];
  disponivelCentavos: number;
  aReceberCentavos: number;
  contaDestinoMaquininhaId: number | null;
}

export interface Movimentacao {
  id: number;
  contaId: number;
  conta: string;
  tipo: 'ENTRADA' | 'SAIDA';
  origem: 'MANUAL' | 'TRANSFERENCIA' | 'LIQUIDACAO' | 'ESTORNO';
  valorCentavos: number;
  data: string;
  categoria: string;
  descricao: string;
  estornoDe: number | null;
  estornadaPor: number | null;
  responsavel: string;
}

export interface Recebivel {
  id: number;
  dataVenda: string;
  valorBrutoCentavos: number;
  taxaCentavos: number;
  valorLiquidoCentavos: number;
  categoria: string;
  descricao: string;
  previsaoLiquidacao: string | null;
  contaDestinoId: number;
  contaDestino: string;
  status: 'PENDENTE' | 'LIQUIDADO' | 'CANCELADO';
  dataLiquidacao: string | null;
  canceladoMotivo: string | null;
  responsavel: string;
}

export type StatusFechamento = 'RASCUNHO' | 'ENVIADO' | 'APROVADO' | 'DEVOLVIDO' | 'REABERTO';

export interface ResultadoPeriodo {
  inicio: string;
  fim: string;
  receitas: Array<{ categoria: string; totalCentavos: number }>;
  despesas: Array<{ categoria: string; totalCentavos: number }>;
  totalReceitasCentavos: number;
  totalDespesasCentavos: number;
  resultadoCentavos: number;
}

export interface Fechamento {
  id: number;
  ano: number;
  mes: number;
  status: StatusFechamento;
  observacao: string | null;
  preparadoPor: string;
  preparadoEm: string;
  enviadoPor: string | null;
  enviadoEm: string | null;
  decididoPor: string | null;
  decididoEm: string | null;
}

export interface FechamentoDetalhe extends Fechamento {
  resumo: {
    inicio: string;
    fim: string;
    saldoInicial: { disponivelCentavos: number; aReceberCentavos: number; contas: Conta[] };
    saldoFinal: { disponivelCentavos: number; aReceberCentavos: number; contas: Conta[] };
    resultado: ResultadoPeriodo;
    quantidadeMovimentacoes: number;
  };
  eventos: Array<{ evento: string; justificativa: string | null; usuario: string; criadoEm: string }>;
}

export interface RelatorioEmitido {
  id: number;
  numero: string;
  tipo: string;
  periodoInicio: string | null;
  periodoFim: string | null;
  parametros: Record<string, unknown>;
  emitidoPor: string;
  emitidoEm: string;
}

export interface RegistroAuditoria {
  id: number;
  acao: string;
  entidade: string;
  entidadeId: string | null;
  detalhes: unknown;
  criadoEm: string;
  usuario: string | null;
}
