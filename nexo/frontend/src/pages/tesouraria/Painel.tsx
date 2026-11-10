import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { hojeISO, moeda, paraCentavos } from '../../api/format';
import type { Posicao } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { CampoMoeda } from '../../components/CampoMoeda';
import { Aviso, Botao, Cabecalho, Campo, Carregando, Cartao, Indicador, Modal, Selo, useAcao, useCarregar } from '../../components/ui';

export function Painel() {
  const { tem } = useAuth();
  const lider = tem('LIDER');
  const pos = useCarregar(() => api.get<Posicao>('/tesouraria/posicao'));
  const [novaConta, setNovaConta] = useState<{ nome: string; tipo: 'BANCO' | 'CAIXA' } | null>(null);
  const [transf, setTransf] = useState<{ contaOrigemId: string; contaDestinoId: string; valor: string; data: string; descricao: string } | null>(null);
  const acao = useAcao();
  const p = pos.dados;

  const criarConta = async (e: FormEvent) => {
    e.preventDefault();
    if (await acao.executar(() => api.post('/tesouraria/contas', novaConta))) {
      setNovaConta(null);
      await pos.recarregar();
    }
  };

  const transferir = async (e: FormEvent) => {
    e.preventDefault();
    if (!transf) return;
    const valorCentavos = paraCentavos(transf.valor);
    if (!valorCentavos) return acao.setErro('Informe um valor válido maior que zero.');
    const ok = await acao.executar(() =>
      api.post('/tesouraria/transferencias', { contaOrigemId: Number(transf.contaOrigemId), contaDestinoId: Number(transf.contaDestinoId), valorCentavos, data: transf.data, descricao: transf.descricao }, true),
    );
    if (ok) {
      setTransf(null);
      await pos.recarregar();
    }
  };

  const definirMaquininha = async (contaId: string) => {
    if (await acao.executar(() => api.put('/tesouraria/configuracoes/conta-maquininha', { contaId: Number(contaId) }))) await pos.recarregar();
  };

  const alternarConta = async (id: number, ativa: boolean) => {
    if (await acao.executar(() => api.patch(`/tesouraria/contas/${id}`, { ativa }))) await pos.recarregar();
  };

  const ativas = p?.contas.filter((c) => c.ativa) ?? [];

  return (
    <>
      <Cabecalho
        titulo="Painel da Tesouraria"
        descricao="Saldos calculados a partir dos lançamentos registrados."
        acoes={
          <>
            <Botao variante="secundario" onClick={() => setTransf({ contaOrigemId: '', contaDestinoId: '', valor: '', data: hojeISO(), descricao: '' })}>Transferir entre contas</Botao>
            {lider ? <Botao onClick={() => setNovaConta({ nome: '', tipo: 'BANCO' })}>Nova conta</Botao> : null}
          </>
        }
      />
      <Aviso>{pos.erro ?? acao.erro}</Aviso>
      {!p ? <Carregando /> : (
        <>
          <div className="grade-indicadores grande">
            <Indicador rotulo="Saldo disponível" valor={moeda(p.disponivelCentavos)} destaque="azul" detalhe="Banco + caixa físico" />
            <Indicador rotulo="A receber da maquininha" valor={moeda(p.aReceberCentavos)} destaque="amarelo" detalhe="Ainda não disponível" />
            <Indicador rotulo="Posição total" valor={moeda(p.disponivelCentavos + p.aReceberCentavos)} />
          </div>
          <Cartao titulo="Contas">
            <ul className="lista-linhas">
              {p.contas.map((c) => (
                <li key={c.id}>
                  <div>
                    <strong>{c.nome}</strong> <Selo cor="azul">{c.tipo === 'BANCO' ? 'Banco' : 'Caixa físico'}</Selo>
                    {!c.ativa ? <Selo>Inativa</Selo> : null}
                    {p.contaDestinoMaquininhaId === c.id ? <Selo cor="amarelo">Recebe a maquininha</Selo> : null}
                  </div>
                  <div className="acoes">
                    <strong className={c.saldoCentavos < 0 ? 'negativo' : ''}>{moeda(c.saldoCentavos)}</strong>
                    {lider ? <Botao variante="fantasma" onClick={() => alternarConta(c.id, !c.ativa)}>{c.ativa ? 'Inativar' : 'Reativar'}</Botao> : null}
                  </div>
                </li>
              ))}
            </ul>
            {lider ? (
              <Campo rotulo="Conta de destino padrão das vendas no cartão">
                <select value={p.contaDestinoMaquininhaId ?? ''} onChange={(e) => definirMaquininha(e.target.value)}>
                  <option value="" disabled>Selecione…</option>
                  {ativas.filter((c) => c.tipo === 'BANCO').map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </Campo>
            ) : null}
          </Cartao>
        </>
      )}

      <Modal titulo="Nova conta" aberto={!!novaConta} aoFechar={() => setNovaConta(null)} rodape={<Botao form="form-conta" type="submit" carregando={acao.enviando}>Criar</Botao>}>
        {novaConta ? (
          <form id="form-conta" className="form" onSubmit={criarConta}>
            <Aviso>{acao.erro}</Aviso>
            <Campo rotulo="Nome"><input required maxLength={80} value={novaConta.nome} onChange={(e) => setNovaConta({ ...novaConta, nome: e.target.value })} /></Campo>
            <Campo rotulo="Tipo">
              <select value={novaConta.tipo} onChange={(e) => setNovaConta({ ...novaConta, tipo: e.target.value as 'BANCO' | 'CAIXA' })}>
                <option value="BANCO">Conta bancária</option>
                <option value="CAIXA">Caixa (dinheiro físico)</option>
              </select>
            </Campo>
          </form>
        ) : null}
      </Modal>

      <Modal titulo="Transferência entre contas" aberto={!!transf} aoFechar={() => setTransf(null)} rodape={<Botao form="form-transf" type="submit" carregando={acao.enviando}>Registrar</Botao>}>
        {transf ? (
          <form id="form-transf" className="form form-grade" onSubmit={transferir}>
            <Aviso>{acao.erro}</Aviso>
            <Aviso tipo="info">Transferências não contam como receita nem despesa.</Aviso>
            <Campo rotulo="De">
              <select required value={transf.contaOrigemId} onChange={(e) => setTransf({ ...transf, contaOrigemId: e.target.value })}>
                <option value="">Selecione…</option>
                {ativas.map((c) => <option key={c.id} value={c.id}>{c.nome} ({moeda(c.saldoCentavos)})</option>)}
              </select>
            </Campo>
            <Campo rotulo="Para">
              <select required value={transf.contaDestinoId} onChange={(e) => setTransf({ ...transf, contaDestinoId: e.target.value })}>
                <option value="">Selecione…</option>
                {ativas.filter((c) => String(c.id) !== transf.contaOrigemId).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </Campo>
            <Campo rotulo="Valor"><CampoMoeda valor={transf.valor} aoMudar={(valor) => setTransf({ ...transf, valor })} /></Campo>
            <Campo rotulo="Data"><input type="date" required value={transf.data} onChange={(e) => setTransf({ ...transf, data: e.target.value })} /></Campo>
            <Campo rotulo="Descrição" largo><input required maxLength={300} value={transf.descricao} onChange={(e) => setTransf({ ...transf, descricao: e.target.value })} placeholder="Ex.: Depósito das ofertas" /></Campo>
          </form>
        ) : null}
      </Modal>
    </>
  );
}
