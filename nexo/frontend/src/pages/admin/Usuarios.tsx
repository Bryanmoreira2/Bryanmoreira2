import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { dataHora } from '../../api/format';
import type { Funcao, UsuarioAdmin } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { Aviso, Botao, Cabecalho, Campo, Carregando, Cartao, Modal, Selo, useAcao, useCarregar } from '../../components/ui';

const FUNCOES: Array<{ v: Funcao; rotulo: string; desc: string }> = [
  { v: 'LIDER', rotulo: 'Líder', desc: 'Administrador geral: acessa tudo, cadastra jovens, atribui funções e aprova fechamentos.' },
  { v: 'SECRETARIO', rotulo: 'Secretário(a)', desc: 'Chamadas, frequência e relatórios da Secretaria.' },
  { v: 'TESOUREIRO', rotulo: 'Tesoureiro(a)', desc: 'Lançamentos, contas, maquininha e preparo de fechamentos.' },
];

function SeletorFuncoes({ valor, aoMudar }: { valor: Funcao[]; aoMudar: (f: Funcao[]) => void }) {
  return (
    <fieldset className="funcoes">
      <legend>Funções</legend>
      {FUNCOES.map((f) => (
        <label key={f.v} className="opcao">
          <input type="checkbox" checked={valor.includes(f.v)} onChange={(e) => aoMudar(e.target.checked ? [...valor, f.v] : valor.filter((x) => x !== f.v))} />
          <span><strong>{f.rotulo}</strong><span className="muted pequeno"> — {f.desc}</span></span>
        </label>
      ))}
    </fieldset>
  );
}

export function Usuarios() {
  const { usuario: eu } = useAuth();
  const lista = useCarregar(() => api.get<UsuarioAdmin[]>('/usuarios'));
  const [novo, setNovo] = useState<{ nome: string; email: string; senha: string; funcoes: Funcao[] } | null>(null);
  const [editar, setEditar] = useState<{ u: UsuarioAdmin; funcoes: Funcao[] } | null>(null);
  const [senha, setSenha] = useState<{ u: UsuarioAdmin; senha: string } | null>(null);
  const acao = useAcao();

  const criar = async (e: FormEvent) => {
    e.preventDefault();
    if (await acao.executar(() => api.post('/usuarios', novo))) {
      setNovo(null);
      await lista.recarregar();
    }
  };
  const salvarFuncoes = async () => {
    if (editar && (await acao.executar(() => api.put(`/usuarios/${editar.u.id}/funcoes`, { funcoes: editar.funcoes })))) {
      setEditar(null);
      await lista.recarregar();
    }
  };
  const alternar = async (u: UsuarioAdmin) => {
    if (!confirm(u.ativo ? `Desativar o acesso de ${u.nome}? O histórico é preservado.` : `Reativar o acesso de ${u.nome}?`)) return;
    if (await acao.executar(() => api.patch(`/usuarios/${u.id}/situacao`, { ativo: !u.ativo }))) await lista.recarregar();
  };
  const redefinir = async (e: FormEvent) => {
    e.preventDefault();
    if (!senha) return;
    const ok = await acao.executar(async () => { await api.patch(`/usuarios/${senha.u.id}/senha`, { senha: senha.senha }); return true; });
    if (ok) setSenha(null);
  };

  return (
    <>
      <Cabecalho titulo="Usuários e funções" descricao="Cada pessoa tem acesso individual. Ser jovem cadastrado não dá acesso ao sistema." acoes={<Botao onClick={() => setNovo({ nome: '', email: '', senha: '', funcoes: [] })}>Novo acesso</Botao>} />
      <Aviso>{acao.erro ?? lista.erro}</Aviso>
      <Cartao>
        {!lista.dados ? <Carregando /> : (
          <ul className="lista-linhas">
            {lista.dados.map((u) => (
              <li key={u.id}>
                <div>
                  <strong>{u.nome}</strong> {u.id === eu?.id ? <Selo cor="azul">você</Selo> : null} {!u.ativo ? <Selo cor="vermelho">Desativado</Selo> : null}
                  <div className="muted pequeno">{u.email} · desde {dataHora(u.criadoEm)}</div>
                  <div>{u.funcoes.length ? u.funcoes.map((f) => <Selo key={f} cor="verde">{FUNCOES.find((x) => x.v === f)?.rotulo}</Selo>) : <span className="muted pequeno">Sem funções</span>}</div>
                </div>
                <div className="acoes">
                  <Botao variante="secundario" onClick={() => setEditar({ u, funcoes: u.funcoes as Funcao[] })}>Funções</Botao>
                  <Botao variante="fantasma" onClick={() => setSenha({ u, senha: '' })}>Senha</Botao>
                  <Botao variante="fantasma" onClick={() => alternar(u)}>{u.ativo ? 'Desativar' : 'Reativar'}</Botao>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      <Modal titulo="Novo acesso" aberto={!!novo} aoFechar={() => setNovo(null)} rodape={<Botao form="form-usuario" type="submit" carregando={acao.enviando}>Criar acesso</Botao>}>
        {novo ? (
          <form id="form-usuario" className="form" onSubmit={criar}>
            <Aviso>{acao.erro}</Aviso>
            <Campo rotulo="Nome"><input required maxLength={120} value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} /></Campo>
            <Campo rotulo="E-mail"><input type="email" required value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} /></Campo>
            <Campo rotulo="Senha inicial" dica="Mínimo de 10 caracteres. Entregue pessoalmente e peça para a pessoa trocar em “Minha conta”.">
              <input type="text" required minLength={10} autoComplete="new-password" value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} />
            </Campo>
            <SeletorFuncoes valor={novo.funcoes} aoMudar={(funcoes) => setNovo({ ...novo, funcoes })} />
          </form>
        ) : null}
      </Modal>

      <Modal titulo={`Funções de ${editar?.u.nome ?? ''}`} aberto={!!editar} aoFechar={() => setEditar(null)} rodape={<Botao onClick={salvarFuncoes} carregando={acao.enviando}>Salvar</Botao>}>
        {editar ? (
          <div className="form">
            <Aviso>{acao.erro}</Aviso>
            <SeletorFuncoes valor={editar.funcoes} aoMudar={(funcoes) => setEditar({ ...editar, funcoes })} />
            <p className="muted pequeno">Revogar uma função bloqueia novas operações imediatamente e mantém o histórico.</p>
          </div>
        ) : null}
      </Modal>

      <Modal titulo={`Redefinir senha de ${senha?.u.nome ?? ''}`} aberto={!!senha} aoFechar={() => setSenha(null)} rodape={<Botao form="form-senha" type="submit" carregando={acao.enviando}>Redefinir</Botao>}>
        {senha ? (
          <form id="form-senha" className="form" onSubmit={redefinir}>
            <Aviso>{acao.erro}</Aviso>
            <Campo rotulo="Nova senha"><input type="text" required minLength={10} autoComplete="new-password" value={senha.senha} onChange={(e) => setSenha({ ...senha, senha: e.target.value })} /></Campo>
          </form>
        ) : null}
      </Modal>
    </>
  );
}
