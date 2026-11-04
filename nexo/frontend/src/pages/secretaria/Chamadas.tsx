import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { data, hojeISO, pct } from '../../api/format';
import type { Atividade, Chamada, ChamadaResumoLista } from '../../api/types';
import { Aviso, Botao, Cabecalho, Campo, Carregando, Cartao, Modal, Selo, Vazio, useAcao, useCarregar } from '../../components/ui';

export function Chamadas() {
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const [filtro, setFiltro] = useState({ atividadeId: '', status: '', inicio: '', fim: '' });
  const atividades = useCarregar(() => api.get<Atividade[]>('/secretaria/atividades'));
  const lista = useCarregar(() => api.get<ChamadaResumoLista[]>('/secretaria/chamadas', filtro), [filtro]);
  const [nova, setNova] = useState({ atividadeId: '', data: hojeISO(), descricao: '' });
  const acao = useAcao();
  const modalAberto = params.get('nova') === '1';

  const abrir = async (e: FormEvent) => {
    e.preventDefault();
    const c = await acao.executar(() =>
      api.post<Chamada>('/secretaria/chamadas', { atividadeId: Number(nova.atividadeId), data: nova.data, descricao: nova.descricao || null }, true),
    );
    if (c) navegar(`/secretaria/chamadas/${c.id}`);
  };

  return (
    <>
      <Cabecalho titulo="Chamadas" descricao="Abra a chamada no tablet, marque os jovens e finalize." acoes={<Botao onClick={() => setParams({ nova: '1' })}>Nova chamada</Botao>} />
      <Cartao>
        <div className="filtros">
          <Campo rotulo="Atividade">
            <select value={filtro.atividadeId} onChange={(e) => setFiltro({ ...filtro, atividadeId: e.target.value })}>
              <option value="">Todas</option>
              {atividades.dados?.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Situação">
            <select value={filtro.status} onChange={(e) => setFiltro({ ...filtro, status: e.target.value })}>
              <option value="">Todas</option>
              <option value="ABERTA">Abertas</option>
              <option value="FINALIZADA">Finalizadas</option>
            </select>
          </Campo>
          <Campo rotulo="De">
            <input type="date" value={filtro.inicio} onChange={(e) => setFiltro({ ...filtro, inicio: e.target.value })} />
          </Campo>
          <Campo rotulo="Até">
            <input type="date" value={filtro.fim} onChange={(e) => setFiltro({ ...filtro, fim: e.target.value })} />
          </Campo>
        </div>
        <Aviso>{lista.erro}</Aviso>
        {lista.carregando && !lista.dados ? <Carregando /> : null}
        {lista.dados && !lista.dados.length ? <Vazio>Nenhuma chamada encontrada.</Vazio> : null}
        {lista.dados?.length ? (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr><th>Data</th><th>Atividade</th><th>Situação</th><th className="num">Presentes</th><th className="num">Frequência</th><th>Responsável</th></tr>
              </thead>
              <tbody>
                {lista.dados.map((c) => (
                  <tr key={c.id} className="linha-clicavel" onClick={() => navegar(`/secretaria/chamadas/${c.id}`)}>
                    <td>{data(c.data)}</td>
                    <td>
                      <Link to={`/secretaria/chamadas/${c.id}`}>{c.atividade}</Link>
                      {c.descricao ? <span className="muted"> — {c.descricao}</span> : null}
                    </td>
                    <td>{c.status === 'ABERTA' ? <Selo cor="amarelo">Aberta · {c.pendentes} pendente(s)</Selo> : <Selo cor="verde">Finalizada</Selo>}</td>
                    <td className="num">{c.presentes}/{c.elegiveis}</td>
                    <td className="num">{c.status === 'FINALIZADA' ? pct(c.percentualPresenca) : '—'}</td>
                    <td>{c.finalizadaPor ?? c.abertaPor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Cartao>

      <Modal
        titulo="Nova chamada"
        aberto={modalAberto}
        aoFechar={() => setParams({})}
        rodape={<Botao form="form-nova-chamada" type="submit" carregando={acao.enviando}>Abrir chamada</Botao>}
      >
        <form id="form-nova-chamada" className="form" onSubmit={abrir}>
          <Aviso>{acao.erro}</Aviso>
          {atividades.dados && !atividades.dados.length ? <Aviso tipo="atencao">Nenhuma atividade autorizada. O líder precisa cadastrar as atividades.</Aviso> : null}
          <Campo rotulo="Atividade">
            <select required value={nova.atividadeId} onChange={(e) => setNova({ ...nova, atividadeId: e.target.value })}>
              <option value="">Selecione…</option>
              {atividades.dados?.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Data">
            <input type="date" required max={hojeISO()} value={nova.data} onChange={(e) => setNova({ ...nova, data: e.target.value })} />
          </Campo>
          <Campo rotulo="Descrição (opcional)" dica="Ex.: Culto especial de missões">
            <input value={nova.descricao} maxLength={200} onChange={(e) => setNova({ ...nova, descricao: e.target.value })} />
          </Campo>
        </form>
      </Modal>
    </>
  );
}
