import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { data, moeda, pct } from '../api/format';
import type { AlertaFrequencia, ChamadaResumoLista, Fechamento, Posicao, SolicitacaoCorrecao } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Aviso, Cabecalho, Cartao, Indicador, Selo, Vazio, useCarregar } from '../components/ui';

function PainelSecretaria() {
  const { tem } = useAuth();
  const chamadas = useCarregar(() => api.get<ChamadaResumoLista[]>('/secretaria/chamadas'));
  const alertas = useCarregar(() => api.get<AlertaFrequencia[]>('/secretaria/alertas-frequencia'));
  const correcoes = useCarregar(() => (tem('LIDER') ? api.get<SolicitacaoCorrecao[]>('/secretaria/solicitacoes-correcao') : Promise.resolve([])));
  const abertas = chamadas.dados?.filter((c) => c.status === 'ABERTA') ?? [];
  const ultima = chamadas.dados?.find((c) => c.status === 'FINALIZADA');
  return (
    <Cartao titulo="Secretaria" acoes={<Link className="btn btn-primario" to="/secretaria/chamadas?nova=1">Nova chamada</Link>}>
      <Aviso>{chamadas.erro ?? alertas.erro}</Aviso>
      <div className="grade-indicadores">
        <Indicador rotulo="Chamadas abertas" valor={abertas.length} destaque={abertas.length ? 'amarelo' : undefined} />
        <Indicador rotulo="Última chamada" valor={ultima ? pct(ultima.percentualPresenca) : '—'} detalhe={ultima ? `${ultima.atividade} · ${data(ultima.data)}` : 'Nenhuma finalizada'} />
        <Indicador rotulo="Alertas de frequência" valor={alertas.dados?.length ?? '—'} destaque={alertas.dados?.length ? 'vermelho' : 'verde'} />
        {tem('LIDER') ? <Indicador rotulo="Correções pendentes" valor={correcoes.dados?.length ?? '—'} destaque={correcoes.dados?.length ? 'amarelo' : undefined} /> : null}
      </div>
      {abertas.length ? (
        <ul className="lista-simples">
          {abertas.map((c) => (
            <li key={c.id}>
              <Link to={`/secretaria/chamadas/${c.id}`}>
                {c.atividade} — {data(c.data)}
              </Link>{' '}
              <Selo cor="amarelo">{c.pendentes} pendente(s)</Selo>
            </li>
          ))}
        </ul>
      ) : null}
    </Cartao>
  );
}

function PainelTesouraria() {
  const pos = useCarregar(() => api.get<Posicao>('/tesouraria/posicao'));
  const fech = useCarregar(() => api.get<Fechamento[]>('/tesouraria/fechamentos'));
  const aguardando = fech.dados?.filter((f) => f.status === 'ENVIADO').length ?? 0;
  return (
    <Cartao titulo="Tesouraria" acoes={<Link className="btn btn-primario" to="/tesouraria/movimentacoes?nova=1">Novo lançamento</Link>}>
      <Aviso>{pos.erro}</Aviso>
      <div className="grade-indicadores">
        <Indicador rotulo="Disponível" valor={moeda(pos.dados?.disponivelCentavos)} destaque="azul" />
        <Indicador rotulo="A receber (maquininha)" valor={moeda(pos.dados?.aReceberCentavos)} detalhe="Não compõe o disponível" />
        {pos.dados?.contas.filter((c) => c.ativa).map((c) => <Indicador key={c.id} rotulo={c.nome} valor={moeda(c.saldoCentavos)} />)}
        <Indicador rotulo="Fechamentos aguardando aprovação" valor={aguardando} destaque={aguardando ? 'amarelo' : undefined} />
      </div>
    </Cartao>
  );
}

export function Inicio() {
  const { usuario, tem } = useAuth();
  const semFuncao = !usuario?.funcoes.length;
  return (
    <>
      <Cabecalho titulo={`Olá, ${usuario?.nome.split(' ')[0]}`} descricao="Resumo do que precisa da sua atenção." />
      {semFuncao ? <Vazio>Sua conta ainda não possui funções. Fale com o líder para liberar o acesso.</Vazio> : null}
      <div className="pilha">
        {tem('SECRETARIO') ? <PainelSecretaria /> : null}
        {tem('TESOUREIRO') ? <PainelTesouraria /> : null}
      </div>
    </>
  );
}
