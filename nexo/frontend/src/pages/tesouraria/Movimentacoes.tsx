import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { data, hojeISO, inicioDoMesISO, moeda, paraCentavos } from '../../api/format';
import type { Conta, Movimentacao, ResultadoPeriodo } from '../../api/types';
import { CampoMoeda } from '../../components/CampoMoeda';
import { Aviso, Botao, Cabecalho, Campo, Carregando, Cartao, Indicador, Modal, Selo, Vazio, useAcao, useCarregar } from '../../components/ui';

const ORIGEM: Record<Movimentacao['origem'], string> = { MANUAL: '', TRANSFERENCIA: 'Transferência', LIQUIDACAO: 'Liquidação cartão', ESTORNO: 'Estorno' };

export function Movimentacoes() {
  const [params, setParams] = useSearchParams();
  const [filtro, setFiltro] = useState({ contaId: '', inicio: inicioDoMesISO(), fim: hojeISO(), tipo: '', categoria: '' });
  const contas = useCarregar(() => api.get<Conta[]>('/tesouraria/contas'));
  const categorias = useCarregar(() => api.get<string[]>('/tesouraria/categorias'));
  const lista = useCarregar(() => api.get<Movimentacao[]>('/tesouraria/movimentacoes', filtro), [filtro]);
  const resultado = useCarregar(
    () => (filtro.inicio && filtro.fim ? api.get<ResultadoPeriodo>('/tesouraria/resultado', { inicio: filtro.inicio, fim: filtro.fim, contaId: filtro.contaId }) : Promise.resolve(null)),
    [filtro.inicio, filtro.fim, filtro.contaId],
  );
  const vazio = { contaId: '', tipo: 'ENTRADA' as 'ENTRADA' | 'SAIDA', valor: '', data: hojeISO(), categoria: '', descricao: '' };
  const [form, setForm] = useState(vazio);
  const [estorno, setEstorno] = useState<{ m: Movimentacao; justificativa: string } | null>(null);
  const acao = useAcao();
  const novaAberta = params.get('nova') === '1';

  const recarregarTudo = async () => {
    await Promise.all([lista.recarregar(), resultado.recarregar(), categorias.recarregar()]);
  };

  const salvar = async (e: FormEvent, continuar = false) => {
    e.preventDefault();
    const valorCentavos = paraCentavos(form.valor);
    if (!valorCentavos) return acao.setErro('Informe um valor válido maior que zero.');
    const ok = await acao.executar(() =>
      api.post('/tesouraria/movimentacoes', { contaId: Number(form.contaId), tipo: form.tipo, valorCentavos, data: form.data, categoria: form.categoria, descricao: form.descricao }, true),
    );
    if (ok) {
      setForm({ ...vazio, contaId: form.contaId, data: form.data, tipo: form.tipo });
      if (!continuar) setParams({});
      await recarregarTudo();
    }
  };

  const estornar = async () => {
    if (!estorno) return;
    if (await acao.executar(() => api.post(`/tesouraria/movimentacoes/${estorno.m.id}/estorno`, { justificativa: estorno.justificativa }, true))) {
      setEstorno(null);
      await recarregarTudo();
    }
  };

  const r = resultado.dados;

  return (
    <>
      <Cabecalho titulo="Movimentações" descricao="Entradas e saídas de banco e caixa." acoes={<Botao onClick={() => setParams({ nova: '1' })}>Novo lançamento</Botao>} />
      <Cartao>
        <div className="filtros">
          <Campo rotulo="Conta">
            <select value={filtro.contaId} onChange={(e) => setFiltro({ ...filtro, contaId: e.target.value })}>
              <option value="">Todas</option>
              {contas.dados?.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="De"><input type="date" value={filtro.inicio} onChange={(e) => setFiltro({ ...filtro, inicio: e.target.value })} /></Campo>
          <Campo rotulo="Até"><input type="date" value={filtro.fim} onChange={(e) => setFiltro({ ...filtro, fim: e.target.value })} /></Campo>
          <Campo rotulo="Tipo">
            <select value={filtro.tipo} onChange={(e) => setFiltro({ ...filtro, tipo: e.target.value })}>
              <option value="">Todos</option><option value="ENTRADA">Entradas</option><option value="SAIDA">Saídas</option>
            </select>
          </Campo>
          <Campo rotulo="Categoria">
            <select value={filtro.categoria} onChange={(e) => setFiltro({ ...filtro, categoria: e.target.value })}>
              <option value="">Todas</option>
              {categorias.dados?.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Campo>
        </div>
        {r ? (
          <div className="grade-indicadores">
            <Indicador rotulo="Receitas do período" valor={moeda(r.totalReceitasCentavos)} destaque="verde" />
            <Indicador rotulo="Despesas do período" valor={moeda(r.totalDespesasCentavos)} destaque="vermelho" />
            <Indicador rotulo="Resultado" valor={moeda(r.resultadoCentavos)} detalhe="Sem transferências e liquidações" />
          </div>
        ) : null}
        <Aviso>{lista.erro}</Aviso>
        {lista.carregando && !lista.dados ? <Carregando /> : null}
        {lista.dados && !lista.dados.length ? <Vazio>Nenhuma movimentação no filtro selecionado.</Vazio> : null}
        {lista.dados?.length ? (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr><th>Data</th><th>Conta</th><th>Categoria</th><th>Descrição</th><th className="num">Valor</th><th>Resp.</th><th /></tr>
              </thead>
              <tbody>
                {lista.dados.map((m) => (
                  <tr key={m.id} className={m.estornadaPor ? 'riscado' : ''}>
                    <td>{data(m.data)}</td>
                    <td>{m.conta}</td>
                    <td>{m.categoria} {ORIGEM[m.origem] ? <Selo cor="azul">{ORIGEM[m.origem]}</Selo> : null}</td>
                    <td>{m.descricao}{m.estornadaPor ? <span className="muted"> (estornado)</span> : null}</td>
                    <td className={`num ${m.tipo === 'SAIDA' ? 'negativo' : 'positivo'}`}>{m.tipo === 'SAIDA' ? '−' : '+'} {moeda(m.valorCentavos)}</td>
                    <td>{m.responsavel}</td>
                    <td>{m.origem === 'MANUAL' && !m.estornadaPor ? <Botao variante="fantasma" onClick={() => setEstorno({ m, justificativa: '' })}>Estornar</Botao> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Cartao>

      <Modal
        titulo="Novo lançamento"
        aberto={novaAberta}
        aoFechar={() => setParams({})}
        rodape={
          <>
            <Botao variante="secundario" carregando={acao.enviando} onClick={(e) => { const f = document.getElementById('form-mov') as HTMLFormElement; if (f.reportValidity()) void salvar(e as unknown as FormEvent, true); }}>
              Salvar e lançar outro
            </Botao>
            <Botao form="form-mov" type="submit" carregando={acao.enviando}>Salvar</Botao>
          </>
        }
      >
        <form id="form-mov" className="form form-grade" onSubmit={(e) => salvar(e)}>
          <Aviso>{acao.erro}</Aviso>
          <div className="alternador campo-largo" role="radiogroup">
            <button type="button" className={form.tipo === 'ENTRADA' ? 'ativo entrada' : ''} onClick={() => setForm({ ...form, tipo: 'ENTRADA' })}>Entrada</button>
            <button type="button" className={form.tipo === 'SAIDA' ? 'ativo saida' : ''} onClick={() => setForm({ ...form, tipo: 'SAIDA' })}>Saída</button>
          </div>
          <Campo rotulo="Conta">
            <select required value={form.contaId} onChange={(e) => setForm({ ...form, contaId: e.target.value })}>
              <option value="">Selecione…</option>
              {contas.dados?.filter((c) => c.ativa).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Valor"><CampoMoeda valor={form.valor} aoMudar={(valor) => setForm({ ...form, valor })} /></Campo>
          <Campo rotulo="Data"><input type="date" required value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></Campo>
          <Campo rotulo="Categoria">
            <input required list="lista-categorias" maxLength={80} value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} placeholder="Ex.: Ofertas, Cantina, Materiais" />
            <datalist id="lista-categorias">{categorias.dados?.map((c) => <option key={c} value={c} />)}</datalist>
          </Campo>
          <Campo rotulo="Descrição" largo><input required maxLength={300} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></Campo>
        </form>
      </Modal>

      <Modal titulo="Estornar lançamento" aberto={!!estorno} aoFechar={() => setEstorno(null)} rodape={<Botao variante="perigo" onClick={estornar} carregando={acao.enviando} disabled={!estorno?.justificativa.trim()}>Estornar</Botao>}>
        {estorno ? (
          <div className="form">
            <Aviso>{acao.erro}</Aviso>
            <p>
              Será criado um lançamento inverso de <strong>{moeda(estorno.m.valorCentavos)}</strong> em <strong>{estorno.m.conta}</strong>, datado de hoje. O lançamento original permanece no histórico.
            </p>
            <Campo rotulo="Justificativa"><textarea rows={3} maxLength={300} value={estorno.justificativa} onChange={(e) => setEstorno({ ...estorno, justificativa: e.target.value })} /></Campo>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
