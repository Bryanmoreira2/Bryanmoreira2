import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { Funcao } from './api/types';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Carregando, Vazio } from './components/ui';
import { Inicio } from './pages/Inicio';
import { Login } from './pages/Login';
import { MinhaConta } from './pages/MinhaConta';
import { Relatorios } from './pages/Relatorios';
import { Auditoria } from './pages/admin/Auditoria';
import { Usuarios } from './pages/admin/Usuarios';
import { Atividades } from './pages/secretaria/Atividades';
import { Chamada } from './pages/secretaria/Chamada';
import { Chamadas } from './pages/secretaria/Chamadas';
import { Correcoes } from './pages/secretaria/Correcoes';
import { Frequencia } from './pages/secretaria/Frequencia';
import { JovemDetalhe } from './pages/secretaria/JovemDetalhe';
import { Jovens } from './pages/secretaria/Jovens';
import { FechamentoDetalhe, Fechamentos } from './pages/tesouraria/Fechamentos';
import { Movimentacoes } from './pages/tesouraria/Movimentacoes';
import { Painel } from './pages/tesouraria/Painel';
import { Recebiveis } from './pages/tesouraria/Recebiveis';

function Protegida({ children }: { children: ReactNode }) {
  const { usuario, carregando } = useAuth();
  if (carregando) return <Carregando />;
  if (!usuario) return <Navigate to="/entrar" replace />;
  return <>{children}</>;
}

/** Oculta telas sem permissão. A autorização efetiva é sempre feita pela API (RN-031). */
function Exige({ funcoes, children }: { funcoes: Funcao[]; children: ReactNode }) {
  const { tem } = useAuth();
  return tem(...funcoes) ? <>{children}</> : <Vazio>Você não tem acesso a esta área.</Vazio>;
}

const S = (el: ReactNode) => <Exige funcoes={['SECRETARIO']}>{el}</Exige>;
const T = (el: ReactNode) => <Exige funcoes={['TESOUREIRO']}>{el}</Exige>;
const L = (el: ReactNode) => <Exige funcoes={['LIDER']}>{el}</Exige>;

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/entrar" element={<Login />} />
          <Route element={<Protegida><Layout /></Protegida>}>
            <Route index element={<Inicio />} />
            <Route path="secretaria/chamadas" element={S(<Chamadas />)} />
            <Route path="secretaria/chamadas/:id" element={S(<Chamada />)} />
            <Route path="secretaria/jovens" element={S(<Jovens />)} />
            <Route path="secretaria/jovens/:id" element={S(<JovemDetalhe />)} />
            <Route path="secretaria/frequencia" element={S(<Frequencia />)} />
            <Route path="secretaria/atividades" element={S(<Atividades />)} />
            <Route path="secretaria/correcoes" element={L(<Correcoes />)} />
            <Route path="tesouraria" element={T(<Painel />)} />
            <Route path="tesouraria/movimentacoes" element={T(<Movimentacoes />)} />
            <Route path="tesouraria/recebiveis" element={T(<Recebiveis />)} />
            <Route path="tesouraria/fechamentos" element={T(<Fechamentos />)} />
            <Route path="tesouraria/fechamentos/:id" element={T(<FechamentoDetalhe />)} />
            <Route path="relatorios" element={<Relatorios />} />
            <Route path="admin/usuarios" element={L(<Usuarios />)} />
            <Route path="admin/auditoria" element={L(<Auditoria />)} />
            <Route path="conta" element={<MinhaConta />} />
            <Route path="*" element={<Vazio>Página não encontrada.</Vazio>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
