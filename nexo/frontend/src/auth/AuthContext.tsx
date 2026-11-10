import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, definirAoExpirar } from '../api/client';
import type { Funcao, Usuario } from '../api/types';

interface AuthState {
  usuario: Usuario | null;
  carregando: boolean;
  entrar: (email: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
  tem: (...funcoes: Funcao[]) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    definirAoExpirar(() => setUsuario(null));
    api
      .get<{ usuario: Usuario }>('/auth/me')
      .then((r) => setUsuario(r.usuario))
      .catch(() => setUsuario(null))
      .finally(() => setCarregando(false));
  }, []);

  const entrar = useCallback(async (email: string, senha: string) => {
    const r = await api.post<{ usuario: Usuario }>('/auth/login', { email, senha });
    setUsuario(r.usuario);
  }, []);

  const sair = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setUsuario(null);
  }, []);

  /** Líder tem acesso a todos os módulos (RN-001). A validação real é sempre no backend. */
  const tem = useCallback(
    (...funcoes: Funcao[]) => !!usuario && (usuario.funcoes.includes('LIDER') || funcoes.some((f) => usuario.funcoes.includes(f))),
    [usuario],
  );

  const value = useMemo(() => ({ usuario, carregando, entrar, sair, tem }), [usuario, carregando, entrar, sair, tem]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth fora do AuthProvider');
  return c;
}
