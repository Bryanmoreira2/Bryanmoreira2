import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import type { Funcao } from '../api/types';

interface Item {
  para: string;
  rotulo: string;
  funcoes: Funcao[];
}

const GRUPOS: Array<{ titulo: string; itens: Item[] }> = [
  { titulo: '', itens: [{ para: '/', rotulo: 'Início', funcoes: ['SECRETARIO', 'TESOUREIRO'] }] },
  {
    titulo: 'Secretaria',
    itens: [
      { para: '/secretaria/chamadas', rotulo: 'Chamadas', funcoes: ['SECRETARIO'] },
      { para: '/secretaria/jovens', rotulo: 'Jovens', funcoes: ['SECRETARIO'] },
      { para: '/secretaria/frequencia', rotulo: 'Frequência e alertas', funcoes: ['SECRETARIO'] },
      { para: '/secretaria/atividades', rotulo: 'Atividades', funcoes: ['SECRETARIO'] },
      { para: '/secretaria/correcoes', rotulo: 'Correções pendentes', funcoes: ['LIDER'] },
    ],
  },
  {
    titulo: 'Tesouraria',
    itens: [
      { para: '/tesouraria', rotulo: 'Painel e contas', funcoes: ['TESOUREIRO'] },
      { para: '/tesouraria/movimentacoes', rotulo: 'Movimentações', funcoes: ['TESOUREIRO'] },
      { para: '/tesouraria/recebiveis', rotulo: 'Maquininha', funcoes: ['TESOUREIRO'] },
      { para: '/tesouraria/fechamentos', rotulo: 'Fechamentos', funcoes: ['TESOUREIRO'] },
    ],
  },
  {
    titulo: 'Geral',
    itens: [
      { para: '/relatorios', rotulo: 'Relatórios', funcoes: ['SECRETARIO', 'TESOUREIRO'] },
      { para: '/admin/usuarios', rotulo: 'Usuários e funções', funcoes: ['LIDER'] },
      { para: '/admin/auditoria', rotulo: 'Auditoria', funcoes: ['LIDER'] },
      { para: '/conta', rotulo: 'Minha conta', funcoes: ['SECRETARIO', 'TESOUREIRO'] },
    ],
  },
];

const NOME_FUNCAO: Record<Funcao, string> = { LIDER: 'Líder', SECRETARIO: 'Secretaria', TESOUREIRO: 'Tesouraria' };

export function Layout() {
  const { usuario, sair, tem } = useAuth();
  const [menuAberto, setMenuAberto] = useState(false);
  const loc = useLocation();
  const telaCheia = /^\/secretaria\/chamadas\/\d+$/.test(loc.pathname);

  return (
    <div className={`app ${menuAberto ? 'menu-aberto' : ''}`}>
      <header className="topo">
        <button className="btn btn-fantasma btn-icone menu-botao" onClick={() => setMenuAberto((v) => !v)} aria-label="Abrir menu">
          ☰
        </button>
        <span className="marca">
          <span className="marca-logo">N</span> NEXO JOVEM
        </span>
        <div className="topo-usuario">
          <span className="topo-nome">{usuario?.nome}</span>
          <span className="muted topo-funcoes">{usuario?.funcoes.map((f) => NOME_FUNCAO[f]).join(' · ') || 'Sem função'}</span>
        </div>
        <button className="btn btn-secundario" onClick={() => void sair()}>
          Sair
        </button>
      </header>
      <nav className="lateral" onClick={() => setMenuAberto(false)}>
        {GRUPOS.map((g) => {
          const itens = g.itens.filter((i) => tem(...i.funcoes));
          if (!itens.length) return null;
          return (
            <div key={g.titulo} className="lateral-grupo">
              {g.titulo ? <span className="lateral-titulo">{g.titulo}</span> : null}
              {itens.map((i) => (
                <NavLink key={i.para} to={i.para} end={i.para === '/' || i.para === '/tesouraria'} className="lateral-link">
                  {i.rotulo}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="fundo-menu" onClick={() => setMenuAberto(false)} />
      <main className={`conteudo ${telaCheia ? 'conteudo-largo' : ''}`}>
        <Outlet />
      </main>
    </div>
  );
}
