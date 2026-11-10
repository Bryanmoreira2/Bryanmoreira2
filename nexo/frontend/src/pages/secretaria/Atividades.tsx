import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import type { Atividade } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { Aviso, Botao, Cabecalho, Campo, Carregando, Cartao, Selo, Vazio, useAcao, useCarregar } from '../../components/ui';

export function Atividades() {
  const { tem } = useAuth();
  const lider = tem('LIDER');
  const lista = useCarregar(() => api.get<Atividade[]>('/secretaria/atividades', { incluirInativas: lider ? 'true' : undefined }));
  const [form, setForm] = useState({ nome: '', descricao: '' });
  const acao = useAcao();

  const criar = async (e: FormEvent) => {
    e.preventDefault();
    if (await acao.executar(() => api.post('/secretaria/atividades', { nome: form.nome, descricao: form.descricao || null }))) {
      setForm({ nome: '', descricao: '' });
      await lista.recarregar();
    }
  };

  const alternar = async (a: Atividade) => {
    if (await acao.executar(() => api.patch(`/secretaria/atividades/${a.id}`, { ativa: !a.ativa }))) await lista.recarregar();
  };

  return (
    <>
      <Cabecalho titulo="Atividades" descricao="Tipos de atividade em que a secretaria pode abrir chamadas. Definidos pelo líder." />
      <Aviso>{acao.erro ?? lista.erro}</Aviso>
      {lider ? (
        <Cartao titulo="Nova atividade">
          <form className="filtros" onSubmit={criar}>
            <Campo rotulo="Nome"><input required maxLength={80} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Culto de Jovens" /></Campo>
            <Campo rotulo="Descrição"><input maxLength={300} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Opcional" /></Campo>
            <Botao type="submit" carregando={acao.enviando}>Adicionar</Botao>
          </form>
        </Cartao>
      ) : null}
      <Cartao>
        {lista.carregando && !lista.dados ? <Carregando /> : null}
        {lista.dados && !lista.dados.length ? <Vazio>Nenhuma atividade cadastrada.</Vazio> : null}
        <ul className="lista-linhas">
          {lista.dados?.map((a) => (
            <li key={a.id}>
              <div>
                <strong>{a.nome}</strong> {a.ativa ? <Selo cor="verde">Autorizada</Selo> : <Selo>Inativa</Selo>}
                {a.descricao ? <div className="muted pequeno">{a.descricao}</div> : null}
              </div>
              {lider ? <Botao variante="secundario" onClick={() => alternar(a)}>{a.ativa ? 'Desativar' : 'Reativar'}</Botao> : null}
            </li>
          ))}
        </ul>
      </Cartao>
    </>
  );
}
