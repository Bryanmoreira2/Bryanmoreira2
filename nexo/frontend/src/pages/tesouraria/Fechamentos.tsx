import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { abrirPdf, api, mensagemErro } from '../../api/client';
import { dataHora, MESES, moeda } from '../../api/format';
import type { Fechamento, FechamentoDetalhe as TDetalhe, StatusFechamento } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { Aviso, Botao, Cabecalho, Campo, Carregando, Cartao, Indicador, Modal, Selo, Vazio, useAcao, useCarregar } from '../../components/ui';

const COR: Record<StatusFechamento, 'neutro' | 'azul' | 'verde' | 'vermelho' | 'amarelo'> = {
  RASCUNHO: 'neutro', ENVIADO: 'amarelo', APROVADO: 'verde', DEVOLVIDO: 'vermelho', REABERTO: 'azul',
};
const ROTULO: Record<StatusFechamento, string> = {
  RASCUNHO: 'Rascunho', ENVIADO: 'Aguardando aprovação', APROVADO: 'Aprovado', DEVOLVIDO: 'Devolvido', REABERTO: 'Reaberto',
};

export function Fechamentos() {
  const navegar = useNavigate();
  const lista = useCarregar(() => api.get<Fechamento[]>('/tesouraria/fechamentos'));
  const hoje = new Date();
  const anterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const [form, setForm] = useState<{ ano: number; mes: number; observacao: string } | null>(null);
  const acao = useAcao();

  const preparar = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const f = await acao.executar(() => api.post<TDetalhe>('/tesouraria/fechamentos', { ...form, observacao: form.observacao || null }));
    if (f) navegar(`/tesouraria/fechamentos/${f.id}`);
  };

  return (
    <>
      <Cabecalho
        titulo="Fechamentos mensais"
        descricao="A tesouraria prepara e envia; o líder aprova e o período fica bloqueado."
        acoes={<Botao onClick={() => setForm({ ano: anterior.getFullYear(), mes: anterior.getMonth() + 1, observacao: '' })}>Preparar fechamento</Botao>}
      />
      <Aviso>{lista.erro}</Aviso>
      <Cartao>
        {lista.carregando && !lista.dados ? <Carregando /> : null}
        {lista.dados && !lista.dados.length ? <Vazio>Nenhum fechamento ainda.</Vazio> : null}
        <ul className="lista-linhas">
          {lista.dados?.map((f) => (
            <li key={f.id} className="linha-clicavel" onClick={() => navegar(`/tesouraria/fechamentos/${f.id}`)}>
              <div>
                <Link to={`/tesouraria/fechamentos/${f.id}`}><strong>{MESES[f.mes - 1]} de {f.ano}</strong></Link>
                <div className="muted pequeno">Preparado por {f.preparadoPor} em {dataHora(f.preparadoEm)}{f.decididoPor ? ` · decisão de ${f.decididoPor} em ${dataHora(f.decididoEm)}` : ''}</div>
              </div>
              <Selo cor={COR[f.status]}>{ROTULO[f.status]}</Selo>
            </li>
          ))}
        </ul>
      </Cartao>
      <Modal titulo="Preparar fechamento" aberto={!!form} aoFechar={() => setForm(null)} rodape={<Botao form="form-fech" type="submit" carregando={acao.enviando}>Preparar</Botao>}>
        {form ? (
          <form id="form-fech" className="form form-grade" onSubmit={preparar}>
            <Aviso>{acao.erro}</Aviso>
            <Campo rotulo="Mês">
              <select value={form.mes} onChange={(e) => setForm({ ...form, mes: Number(e.target.value) })}>
                {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </Campo>
            <Campo rotulo="Ano"><input type="number" min={2000} max={2100} value={form.ano} onChange={(e) => setForm({ ...form, ano: Number(e.target.value) })} /></Campo>
            <Campo rotulo="Observações" largo><textarea rows={3} maxLength={1000} value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} /></Campo>
          </form>
        ) : null}
      </Modal>
    </>
  );
}

export function FechamentoDetalhe() {
  const id = Number(useParams().id);
  const { tem } = useAuth();
  const f = useCarregar(() => api.get<TDetalhe>(`/tesouraria/fechamentos/${id}`), [id]);
  const [decisao, setDecisao] = useState<{ tipo: 'DEVOLVER' | 'REABRIR'; justificativa: string } | null>(null);
  const acao = useAcao();
  const d = f.dados;
  if (f.erro) return <Aviso>{f.erro}</Aviso>;
  if (!d) return <Carregando />;
  const r = d.resumo;

  const executar = async (fn: () => Promise<TDetalhe>) => {
    const novo = await acao.executar(fn);
    if (novo) {
      f.setDados(novo);
      setDecisao(null);
    }
  };

  return (
    <>
      <Link to="/tesouraria/fechamentos" className="muted pequeno">← Fechamentos</Link>
      <Cabecalho
        titulo={`Fechamento de ${MESES[d.mes - 1]} de ${d.ano}`}
        descricao={`Preparado por ${d.preparadoPor} em ${dataHora(d.preparadoEm)}`}
        acoes={
          <>
            <Selo cor={COR[d.status]}>{ROTULO[d.status]}</Selo>
            <Botao variante="secundario" onClick={() => abrirPdf(`/relatorios/tesouraria/fechamentos/${id}`).catch((e) => acao.setErro(mensagemErro(e)))}>
              {d.status === 'APROVADO' ? 'Relatório definitivo (PDF)' : 'Prévia (PDF)'}
            </Botao>
          </>
        }
      />
      <Aviso>{acao.erro}</Aviso>
      {d.status === 'APROVADO' ? <Aviso tipo="sucesso">Período aprovado e bloqueado para alterações. Somente o líder pode reabrir, com justificativa.</Aviso> : null}
      {d.status === 'DEVOLVIDO' || d.status === 'REABERTO' ? <Aviso tipo="atencao">Faça os ajustes necessários e prepare o fechamento novamente na lista de fechamentos.</Aviso> : null}

      <div className="acoes barra-acoes">
        {d.status === 'RASCUNHO' ? <Botao onClick={() => executar(() => api.post(`/tesouraria/fechamentos/${id}/envio`))} carregando={acao.enviando}>Enviar ao líder</Botao> : null}
        {d.status === 'ENVIADO' && tem('LIDER') ? (
          <>
            <Botao variante="sucesso" onClick={() => confirm('Aprovar e bloquear o período?') && executar(() => api.post(`/tesouraria/fechamentos/${id}/aprovacao`, { decisao: 'APROVAR' }))} carregando={acao.enviando}>Aprovar</Botao>
            <Botao variante="perigo" onClick={() => setDecisao({ tipo: 'DEVOLVER', justificativa: '' })}>Devolver</Botao>
          </>
        ) : null}
        {d.status === 'APROVADO' && tem('LIDER') ? <Botao variante="secundario" onClick={() => setDecisao({ tipo: 'REABRIR', justificativa: '' })}>Reabrir período</Botao> : null}
      </div>

      <div className="grade-indicadores">
        <Indicador rotulo="Disponível no início" valor={moeda(r.saldoInicial.disponivelCentavos)} />
        <Indicador rotulo="Disponível no fim" valor={moeda(r.saldoFinal.disponivelCentavos)} destaque="azul" />
        <Indicador rotulo="A receber no fim" valor={moeda(r.saldoFinal.aReceberCentavos)} destaque="amarelo" />
        <Indicador rotulo="Resultado do mês" valor={moeda(r.resultado.resultadoCentavos)} destaque={r.resultado.resultadoCentavos >= 0 ? 'verde' : 'vermelho'} />
      </div>

      <div className="grade-2">
        <Cartao titulo="Contas">
          <table className="tabela">
            <thead><tr><th>Conta</th><th className="num">Início</th><th className="num">Fim</th></tr></thead>
            <tbody>
              {r.saldoFinal.contas.map((c) => (
                <tr key={c.id}><td>{c.nome}</td><td className="num">{moeda(r.saldoInicial.contas.find((x) => x.id === c.id)?.saldoCentavos ?? 0)}</td><td className="num">{moeda(c.saldoCentavos)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="muted pequeno">{r.quantidadeMovimentacoes} movimentação(ões) no período.</p>
        </Cartao>
        <Cartao titulo="Resultado">
          <table className="tabela">
            <tbody>
              {r.resultado.receitas.map((x) => <tr key={`r${x.categoria}`}><td>{x.categoria}</td><td className="num positivo">{moeda(x.totalCentavos)}</td></tr>)}
              <tr className="total"><td>Total de receitas</td><td className="num">{moeda(r.resultado.totalReceitasCentavos)}</td></tr>
              {r.resultado.despesas.map((x) => <tr key={`d${x.categoria}`}><td>{x.categoria}</td><td className="num negativo">{moeda(x.totalCentavos)}</td></tr>)}
              <tr className="total"><td>Total de despesas</td><td className="num">{moeda(r.resultado.totalDespesasCentavos)}</td></tr>
            </tbody>
          </table>
        </Cartao>
      </div>

      {d.observacao ? <Cartao titulo="Observações"><p>{d.observacao}</p></Cartao> : null}

      <Cartao titulo="Histórico">
        <ul className="linha-tempo">
          {d.eventos.map((e, i) => (
            <li key={i}>
              <strong>{e.evento.toLowerCase()}</strong> por {e.usuario} <span className="muted">em {dataHora(e.criadoEm)}</span>
              {e.justificativa ? <div className="muted pequeno">“{e.justificativa}”</div> : null}
            </li>
          ))}
        </ul>
      </Cartao>

      <Modal
        titulo={decisao?.tipo === 'DEVOLVER' ? 'Devolver para ajustes' : 'Reabrir período aprovado'}
        aberto={!!decisao}
        aoFechar={() => setDecisao(null)}
        rodape={
          <Botao
            variante="perigo"
            disabled={!decisao?.justificativa.trim()}
            carregando={acao.enviando}
            onClick={() =>
              decisao &&
              executar(() =>
                decisao.tipo === 'DEVOLVER'
                  ? api.post(`/tesouraria/fechamentos/${id}/aprovacao`, { decisao: 'DEVOLVER', justificativa: decisao.justificativa })
                  : api.post(`/tesouraria/fechamentos/${id}/reabertura`, { justificativa: decisao.justificativa }),
              )
            }
          >
            Confirmar
          </Botao>
        }
      >
        {decisao ? (
          <div className="form">
            <Aviso>{acao.erro}</Aviso>
            <Campo rotulo="Justificativa (registrada na auditoria)">
              <textarea rows={3} maxLength={1000} value={decisao.justificativa} onChange={(e) => setDecisao({ ...decisao, justificativa: e.target.value })} />
            </Campo>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
