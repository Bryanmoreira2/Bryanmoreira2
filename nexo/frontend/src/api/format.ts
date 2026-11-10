export function moeda(centavos: number | null | undefined): string {
  if (centavos === null || centavos === undefined) return '—';
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Converte "1.234,56" ou "1234.56" em centavos inteiros, sem erro de ponto flutuante. */
export function paraCentavos(texto: string): number | null {
  const limpo = texto.trim().replace(/\s|R\$/g, '');
  if (!limpo) return null;
  const normal = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null;
  const [int, dec = ''] = normal.split('.');
  return Number(int) * 100 + Number(dec.padEnd(2, '0'));
}

export function data(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function dataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? 'Sem dados' : `${v.toLocaleString('pt-BR')}%`;
}

export const hojeISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const inicioDoMesISO = () => `${hojeISO().slice(0, 8)}01`;

export const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
