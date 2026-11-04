const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    public codigo: string,
    message: string,
    public detalhes?: unknown,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | undefined | null>;

function montarUrl(path: string, query?: Query) {
  const qs = query
    ? Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  return `${BASE}${path}${qs ? `?${qs}` : ''}`;
}

let aoExpirar: (() => void) | null = null;
export const definirAoExpirar = (fn: () => void) => {
  aoExpirar = fn;
};

async function req<T>(method: string, path: string, body?: unknown, opts: { query?: Query; idempotente?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // Chave única por operação: reenvios após falha de rede não duplicam lançamentos (RNF-008)
  if (opts.idempotente) headers['Idempotency-Key'] = crypto.randomUUID();
  let res: Response;
  try {
    res = await fetch(montarUrl(path, opts.query), {
      method,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'REDE', 'Não foi possível conectar ao servidor. Verifique sua conexão.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login')) aoExpirar?.();
    const e = data?.erro;
    throw new ApiError(res.status, e?.codigo ?? 'ERRO', e?.mensagem ?? 'Erro inesperado.', e?.detalhes);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => req<T>('GET', path, undefined, { query }),
  post: <T>(path: string, body?: unknown, idempotente = false) => req<T>('POST', path, body ?? {}, { idempotente }),
  put: <T>(path: string, body?: unknown) => req<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => req<T>('PATCH', path, body ?? {}),
};

/** Abre um relatório PDF em nova aba (cookie de sessão acompanha a requisição). */
export async function abrirPdf(path: string, query?: Query) {
  const res = await fetch(montarUrl(path, query), { credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.erro?.codigo ?? 'ERRO', data?.erro?.mensagem ?? 'Não foi possível gerar o relatório.');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) {
    const a = document.createElement('a');
    a.href = url;
    a.download = 'relatorio.pdf';
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function mensagemErro(e: unknown): string {
  if (e instanceof ApiError) {
    if (Array.isArray(e.detalhes) && e.detalhes.length && typeof e.detalhes[0] === 'object') {
      return `${e.message} ${(e.detalhes as Array<{ campo: string; mensagem: string }>).map((d) => `${d.campo}: ${d.mensagem}`).join('; ')}`;
    }
    return e.message;
  }
  return e instanceof Error ? e.message : 'Erro inesperado.';
}
