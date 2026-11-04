import { all, type DB } from '../../db/connection.js';

export interface FiltroFrequencia {
  inicio?: string;
  fim?: string;
  atividadeId?: number;
}

interface RegistroRow {
  chamada_id: number;
  data: string;
  atividade_id: number;
  atividade: string;
  status: 'PRESENTE' | 'AUSENTE';
}

/** Regras do alerta (RN-039 / DP-003). */
export const ALERTA_FALTAS_CONSECUTIVAS = 2;
export const ALERTA_JANELA = 4;
export const ALERTA_PERCENTUAL_MINIMO = 50;

/**
 * Registros de presença em chamadas FINALIZADAS. Apenas jovens elegíveis na
 * data da atividade têm linha em `presencas` (RN-013, RN-037).
 */
function registros(db: DB, jovemId: number | null, f: FiltroFrequencia) {
  return all<RegistroRow & { jovem_id: number }>(
    db,
    `SELECT p.jovem_id, c.id AS chamada_id, c.data, a.id AS atividade_id, a.nome AS atividade, p.status
       FROM presencas p
       JOIN chamadas c ON c.id = p.chamada_id AND c.status = 'FINALIZADA'
       JOIN atividades a ON a.id = c.atividade_id
      WHERE (? IS NULL OR p.jovem_id = ?)
        AND (? IS NULL OR c.data >= ?) AND (? IS NULL OR c.data <= ?)
        AND (? IS NULL OR c.atividade_id = ?)
      ORDER BY c.data DESC, c.id DESC`,
    jovemId, jovemId,
    f.inicio ?? null, f.inicio ?? null,
    f.fim ?? null, f.fim ?? null,
    f.atividadeId ?? null, f.atividadeId ?? null,
  );
}

/** Frequência = presenças / atividades elegíveis × 100 (RN-038). `null` = "Sem dados". */
export function percentual(presencas: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((presencas / total) * 1000) / 10;
}

/** Alerta informativo — nunca altera a situação cadastral (RN-015, RN-039). */
export function avaliarAlerta(recentesPrimeiro: Array<{ status: string }>) {
  const motivos: string[] = [];
  const ultimas = recentesPrimeiro.slice(0, ALERTA_FALTAS_CONSECUTIVAS);
  if (ultimas.length === ALERTA_FALTAS_CONSECUTIVAS && ultimas.every((r) => r.status === 'AUSENTE')) {
    motivos.push(`${ALERTA_FALTAS_CONSECUTIVAS} faltas consecutivas`);
  }
  const janela = recentesPrimeiro.slice(0, ALERTA_JANELA);
  if (janela.length === ALERTA_JANELA) {
    const pct = percentual(janela.filter((r) => r.status === 'PRESENTE').length, janela.length)!;
    if (pct < ALERTA_PERCENTUAL_MINIMO) {
      motivos.push(`frequência de ${pct}% nas últimas ${ALERTA_JANELA} atividades`);
    }
  }
  return { ativo: motivos.length > 0, motivos };
}

function resumir(regs: RegistroRow[]) {
  const presencas = regs.filter((r) => r.status === 'PRESENTE').length;
  return {
    atividadesElegiveis: regs.length,
    presencas,
    ausencias: regs.length - presencas,
    percentual: percentual(presencas, regs.length),
  };
}

export function frequenciaDoJovem(db: DB, jovemId: number, f: FiltroFrequencia = {}) {
  const regs = registros(db, jovemId, f);
  const todos = registros(db, jovemId, {});
  return {
    jovemId,
    ...resumir(regs),
    alerta: avaliarAlerta(todos),
    historico: regs.map((r) => ({ chamadaId: r.chamada_id, data: r.data, atividadeId: r.atividade_id, atividade: r.atividade, status: r.status })),
  };
}

export function frequenciaGeral(db: DB, f: FiltroFrequencia = {}) {
  const regs = registros(db, null, f);
  const porJovem = new Map<number, RegistroRow[]>();
  const porAtividade = new Map<number, { nome: string; regs: RegistroRow[]; chamadas: Set<number> }>();
  const chamadas = new Set<number>();
  for (const r of regs) {
    chamadas.add(r.chamada_id);
    if (!porJovem.has(r.jovem_id)) porJovem.set(r.jovem_id, []);
    porJovem.get(r.jovem_id)!.push(r);
    if (!porAtividade.has(r.atividade_id)) porAtividade.set(r.atividade_id, { nome: r.atividade, regs: [], chamadas: new Set() });
    const a = porAtividade.get(r.atividade_id)!;
    a.regs.push(r);
    a.chamadas.add(r.chamada_id);
  }
  const nomes = new Map(all<{ id: number; nome: string; situacao: string }>(db, 'SELECT id, nome, situacao FROM jovens').map((j) => [j.id, j]));
  return {
    filtros: f,
    totalChamadas: chamadas.size,
    ...resumir(regs),
    porAtividade: [...porAtividade.entries()].map(([id, a]) => ({ atividadeId: id, atividade: a.nome, chamadas: a.chamadas.size, ...resumir(a.regs) })),
    porJovem: [...porJovem.entries()]
      .map(([id, rs]) => ({ jovemId: id, nome: nomes.get(id)?.nome ?? '?', situacao: nomes.get(id)?.situacao, ...resumir(rs) }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  };
}

export function alertasFrequencia(db: DB) {
  const jovens = all<{ id: number; nome: string }>(db, "SELECT id, nome FROM jovens WHERE situacao = 'ATIVO' ORDER BY nome");
  const regs = registros(db, null, {});
  const porJovem = new Map<number, RegistroRow[]>();
  for (const r of regs) {
    if (!porJovem.has(r.jovem_id)) porJovem.set(r.jovem_id, []);
    porJovem.get(r.jovem_id)!.push(r);
  }
  return jovens
    .map((j) => {
      const rs = porJovem.get(j.id) ?? [];
      const alerta = avaliarAlerta(rs);
      return { jovemId: j.id, nome: j.nome, motivos: alerta.motivos, ultimaPresenca: rs.find((r) => r.status === 'PRESENTE')?.data ?? null, ...resumir(rs.slice(0, ALERTA_JANELA)) };
    })
    .filter((a) => a.motivos.length > 0);
}
