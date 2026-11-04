import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { data, hojeISO } from '../../api/format';
import type { Jovem } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { Aviso, Botao, Cabecalho, Campo, Carregando, Cartao, Modal, Selo, Vazio, useAcao, useCarregar } from '../../components/ui';

export const jovemVazio = { nome: '', dataNascimento: '', telefone: '', responsavelNome: '', responsavelTelefone: '', observacoes: '', dataIngresso: hojeISO() };
export type FormJovem = typeof jovemVazio;

export function CamposJovem({ v, set, novo }: { v: FormJovem; set: (v: FormJovem) => void; novo?: boolean }) {
  return (
    <>
      <Campo rotulo="Nome completo" largo>
        <input required maxLength={120} value={v.nome} onChange={(e) => set({ ...v, nome: e.target.value })} />
      </Campo>
      <Campo rotulo="Data de nascimento">
        <input type="date" value={v.dataNascimento} max={hojeISO()} onChange={(e) => set({ ...v, dataNascimento: e.target.value })} />
      </Campo>
      <Campo rotulo="Telefone">
        <input type="tel" maxLength={30} value={v.telefone} onChange={(e) => set({ ...v, telefone: e.target.value })} />
      </Campo>
      <Campo rotulo="Responsável (se menor)">
        <input maxLength={120} value={v.responsavelNome} onChange={(e) => set({ ...v, responsavelNome: e.target.value })} />
      </Campo>
      <Campo rotulo="Telefone do responsável">
        <input type="tel" maxLength={30} value={v.responsavelTelefone} onChange={(e) => set({ ...v, responsavelTelefone: e.target.value })} />
      </Campo>
      {novo ? (
        <Campo rotulo="Data de ingresso no grupo" dica="Chamadas anteriores a esta data não contam como falta.">
          <input type="date" required max={hojeISO()} value={v.dataIngresso} onChange={(e) => set({ ...v, dataIngresso: e.target.value })} />
        </Campo>
      ) : null}
      <Campo rotulo="Observações" largo dica="Registre apenas o necessário. Evite dados sensíveis.">
        <textarea rows={2} maxLength={1000} value={v.observacoes} onChange={(e) => set({ ...v, observacoes: e.target.value })} />
      </Campo>
    </>
  );
}

export function paraPayload(v: FormJovem, novo: boolean) {
  const n = (s: string) => (s.trim() ? s.trim() : null);
  return {
    nome: v.nome.trim(),
    dataNascimento: v.dataNascimento || null,
    telefone: n(v.telefone),
    responsavelNome: n(v.responsavelNome),
    responsavelTelefone: n(v.responsavelTelefone),
    observacoes: n(v.observacoes),
    ...(novo ? { dataIngresso: v.dataIngresso } : {}),
  };
}

export function Jovens() {
  const { tem } = useAuth();
  const navegar = useNavigate();
  const [filtro, setFiltro] = useState({ situacao: 'ATIVO', busca: '' });
  const lista = useCarregar(() => api.get<Jovem[]>('/jovens', filtro), [filtro]);
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState(jovemVazio);
  const acao = useAcao();

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    const j = await acao.executar(() => api.post<Jovem>('/jovens', paraPayload(form, true)));
    if (j) {
      setAberto(false);
      setForm(jovemVazio);
      navegar(`/secretaria/jovens/${j.id}`);
    }
  };

  return (
    <>
      <Cabecalho
        titulo="Jovens"
        descricao={tem('LIDER') ? 'Cadastro e situação dos jovens do grupo.' : 'Consulta dos jovens cadastrados. Cadastros e alterações são feitos pelo líder.'}
        acoes={tem('LIDER') ? <Botao onClick={() => setAberto(true)}>Cadastrar jovem</Botao> : null}
      />
      <Cartao>
        <div className="filtros">
          <Campo rotulo="Buscar">
            <input type="search" placeholder="Nome…" value={filtro.busca} onChange={(e) => setFiltro({ ...filtro, busca: e.target.value })} />
          </Campo>
          <Campo rotulo="Situação">
            <select value={filtro.situacao} onChange={(e) => setFiltro({ ...filtro, situacao: e.target.value })}>
              <option value="ATIVO">Ativos</option>
              <option value="INATIVO">Inativos</option>
              <option value="">Todos</option>
            </select>
          </Campo>
        </div>
        <Aviso>{lista.erro}</Aviso>
        {lista.carregando && !lista.dados ? <Carregando /> : null}
        {lista.dados && !lista.dados.length ? <Vazio>Nenhum jovem encontrado.</Vazio> : null}
        {lista.dados?.length ? (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr><th>Nome</th><th>Ingresso</th><th>Telefone</th><th>Situação</th></tr>
              </thead>
              <tbody>
                {lista.dados.map((j) => (
                  <tr key={j.id} className="linha-clicavel" onClick={() => navegar(`/secretaria/jovens/${j.id}`)}>
                    <td><Link to={`/secretaria/jovens/${j.id}`}>{j.nome}</Link></td>
                    <td>{data(j.dataIngresso)}</td>
                    <td>{j.telefone ?? '—'}</td>
                    <td><Selo cor={j.situacao === 'ATIVO' ? 'verde' : 'neutro'}>{j.situacao === 'ATIVO' ? 'Ativo' : 'Inativo'}</Selo></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="muted pequeno">{lista.dados?.length ?? 0} jovem(ns)</p>
      </Cartao>

      <Modal titulo="Cadastrar jovem" aberto={aberto} aoFechar={() => setAberto(false)} rodape={<Botao form="form-jovem" type="submit" carregando={acao.enviando}>Salvar</Botao>}>
        <form id="form-jovem" className="form form-grade" onSubmit={salvar}>
          <Aviso>{acao.erro}</Aviso>
          <CamposJovem v={form} set={setForm} novo />
        </form>
      </Modal>
    </>
  );
}
