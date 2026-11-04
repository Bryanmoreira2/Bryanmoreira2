import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { data, hojeISO, moeda, paraCentavos } from '../../api/format';
import type { Posicao, Recebivel } from '../../api/types';
import { CampoMoeda } from '../../components/CampoMoeda';
import { Aviso, Botao, Cabecalho, Campo, Carregando, Cartao, Indicador, Modal, Selo, Vazio, useAcao, useCarregar } from '../../components/ui';

export function Recebiveis() {
  const [status, setStatus] = useState('PENDENTE');
  const lista = useCarregar(() => api.get<Recebivel[]>('/tesouraria/recebiveis', { status }), [status]);
  const pos = useCarregar(() => api.get<Posicao>('/tesouraria/posicao'));
  const vazio = { dataVenda: hojeISO(), bruto: '', taxa: '', categoria: '', descricao: '', previsao: '', contaDestinoId: '' };
  const [form, setForm] = useState<typeof vazio | null>(null);
  const [liq, setLiq] = useState<{ r: Recebivel; data: string; contaId: string } | null>(null);
  const [canc, setCanc] = useState<{ r: Recebivel; justificativa: string } | null>(null);
  const acao = useAcao();

  const bruto = form ? paraCentavos(form.bruto) : null;
  const taxa = form ? (form.taxa ? paraCentavos(form.taxa) : 0) : null;
  const liquido = bruto !== null && taxa !== null ? bruto - taxa : null;
  const bancos = pos.dados?.contas.filter((c) => c.ativa && c.tipo === 'BANCO') ?? [];
  const recarregar = () => Promise.all([lista.recarregar(), pos.recarregar()]);

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || !bruto || taxa === null) return acao.setErro('Informe valores válidos.');
    const ok = await acao.executar(() =>
      api.post('/tesouraria/recebiveis', {
        dataVenda: form.dataVenda, valorBrutoCentavos: bruto, taxaCentavos: taxa, categoria: form.categoria, descricao: form.descricao,
        previsaoLiquidacao: form.previsao || null, contaDestinoId: form.contaDestinoId ? Number(form.contaDestinoId) : undefined,
      }, true),
    );
    if (ok) {
      setForm(null);
      await recarregar();
    }
  };

  const liquidar = async (e: FormEvent) => {
    e.preventDefault();
    if (!liq) return;
    if (await acao.executar(() => api.post(`/tesouraria/recebiveis/${liq.r.id}/liquidacao`, { data: liq.data, contaId: Number(liq.contaId) }, true))) {
      setLiq(null);
      await recarregar();
    }
  };

  const cancelar = async () => {
    if (!canc) return;
    if (await acao.executar(() => api.post(`/tesouraria/recebiveis/${canc.r.id}/cancelamento`, { justificativa: canc.justificativa }))) {
      setCanc(null);
      await recarregar();
    }
  };

  return (
    <>
      <Cabecalho
        titulo="Maquininha de cartão"
        descricao="Vendas no cartão ficam como valores a receber até a liquidação na conta bancária."
        acoes={<Botao onClick={() => setForm({ ...vazio, contaDestinoId: pos.dados?.contaDestinoMaquininhaId ? String(pos.dados.contaDestinoMaquininhaId) : '' })}>Registrar venda</Botao>}
      />
      <div className="grade-indicadores">
        <Indicador rotulo="Total a receber" valor={moeda(pos.dados?.aReceberCentavos)} destaque="amarelo" />
      </div>
      <Cartao>
        <div className="filtros">
          <Campo rotulo="Situação">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="PENDENTE">A receber</option>
              <option value="LIQUIDADO">Liquidados</option>
              <option value="CANCELADO">Cancelados</option>
              <option value="">Todos</option>
            </select>
          </Campo>
        </div>
        <Aviso>{lista.erro}</Aviso>
        {lista.carregando && !lista.dados ? <Carregando /> : null}
        {lista.dados && !lista.dados.length ? <Vazio>Nenhum registro.</Vazio> : null}
        {lista.dados?.length ? (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr><th>Venda</th><th>Descrição</th><th className="num">Bruto</th><th className="num">Taxa</th><th className="num">Líquido</th><th>Destino</th><th>Situação</th><th /></tr>
              </thead>
              <tbody>
                {lista.dados.map((r) => (
                  <tr key={r.id}>
                    <td>{data(r.dataVenda)}</td>
                    <td>{r.descricao}<div className="muted pequeno">{r.categoria}</div></td>
                    <td className="num">{moeda(r.valorBrutoCentavos)}</td>
                    <td className="num">{moeda(r.taxaCentavos)}</td>
                    <td className="num"><strong>{moeda(r.valorLiquidoCentavos)}</strong></td>
                    <td>{r.contaDestino}</td>
                    <td>
                      {r.status === 'PENDENTE' ? <Selo cor="amarelo">A receber{r.previsaoLiquidacao ? ` · prev. ${data(r.previsaoLiquidacao)}` : ''}</Selo> : null}
                      {r.status === 'LIQUIDADO' ? <Selo cor="verde">Liquidado {data(r.dataLiquidacao)}</Selo> : null}
                      {r.status === 'CANCELADO' ? <Selo>Cancelado</Selo> : null}
                    </td>
                    <td>
                      {r.status === 'PENDENTE' ? (
                        <div className="acoes">
                          <Botao variante="secundario" onClick={() => setLiq({ r, data: hojeISO(), contaId: String(r.contaDestinoId) })}>Liquidar</Botao>
                          <Botao variante="fantasma" onClick={() => setCanc({ r, justificativa: '' })}>Cancelar</Botao>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Cartao>

      <Modal titulo="Registrar venda no cartão" aberto={!!form} aoFechar={() => setForm(null)} rodape={<Botao form="form-rec" type="submit" carregando={acao.enviando}>Registrar</Botao>}>
        {form ? (
          <form id="form-rec" className="form form-grade" onSubmit={salvar}>
            <Aviso>{acao.erro}</Aviso>
            <Campo rotulo="Data da venda"><input type="date" required value={form.dataVenda} onChange={(e) => setForm({ ...form, dataVenda: e.target.value })} /></Campo>
            <Campo rotulo="Previsão de liquidação"><input type="date" value={form.previsao} min={form.dataVenda} onChange={(e) => setForm({ ...form, previsao: e.target.value })} /></Campo>
            <Campo rotulo="Valor bruto"><CampoMoeda valor={form.bruto} aoMudar={(bruto) => setForm({ ...form, bruto })} /></Campo>
            <Campo rotulo="Taxa da maquininha"><CampoMoeda valor={form.taxa} obrigatorio={false} aoMudar={(taxa) => setForm({ ...form, taxa })} /></Campo>
            <div className="campo-largo resumo-liquido">Valor líquido a receber: <strong>{liquido !== null && liquido > 0 ? moeda(liquido) : '—'}</strong></div>
            <Campo rotulo="Categoria"><input required maxLength={80} value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} placeholder="Ex.: Cantina" /></Campo>
            <Campo rotulo="Conta de destino">
              <select value={form.contaDestinoId} onChange={(e) => setForm({ ...form, contaDestinoId: e.target.value })} required>
                <option value="">Selecione…</option>
                {bancos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </Campo>
            <Campo rotulo="Descrição" largo><input required maxLength={300} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></Campo>
          </form>
        ) : null}
      </Modal>

      <Modal titulo="Registrar liquidação" aberto={!!liq} aoFechar={() => setLiq(null)} rodape={<Botao form="form-liq" type="submit" carregando={acao.enviando}>Confirmar liquidação</Botao>}>
        {liq ? (
          <form id="form-liq" className="form" onSubmit={liquidar}>
            <Aviso>{acao.erro}</Aviso>
            <p><strong>{moeda(liq.r.valorLiquidoCentavos)}</strong> entrarão na conta selecionada. A liquidação não gera nova receita — a venda já foi contabilizada.</p>
            <Campo rotulo="Data do crédito"><input type="date" required min={liq.r.dataVenda} value={liq.data} onChange={(e) => setLiq({ ...liq, data: e.target.value })} /></Campo>
            <Campo rotulo="Conta">
              <select value={liq.contaId} onChange={(e) => setLiq({ ...liq, contaId: e.target.value })}>
                {bancos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </Campo>
          </form>
        ) : null}
      </Modal>

      <Modal titulo="Cancelar venda" aberto={!!canc} aoFechar={() => setCanc(null)} rodape={<Botao variante="perigo" onClick={cancelar} carregando={acao.enviando} disabled={!canc?.justificativa.trim()}>Cancelar venda</Botao>}>
        {canc ? (
          <div className="form">
            <Aviso>{acao.erro}</Aviso>
            <Campo rotulo="Justificativa"><textarea rows={3} maxLength={300} value={canc.justificativa} onChange={(e) => setCanc({ ...canc, justificativa: e.target.value })} /></Campo>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
