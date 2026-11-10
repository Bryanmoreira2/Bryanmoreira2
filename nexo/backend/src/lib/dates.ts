export const hoje = (): string => new Date().toISOString().slice(0, 10);
export const agora = (): string => new Date().toISOString();

export function limitesDoMes(ano: number, mes: number): { inicio: string; fim: string } {
  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const fim = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`;
  return { inicio, fim };
}

export function formatarData(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
