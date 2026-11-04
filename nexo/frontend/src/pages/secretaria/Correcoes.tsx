import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { data, dataHora } from '../../api/format';
import type { SolicitacaoCorrecao } from '../../api/types';
import { Aviso, Botao, Cabecalho, Campo, Cartao, Modal, Vazio, useAcao, useCarregar } from '../../components/ui';

const rot = (s: string | null) => (s === 'PRESENTE' ? 'Presente' : s === 'AUSENTE' ? 'Ausente' : '—');

export function Correcoes() {
  const lista = useCarregar(() => api.get<SolicitacaoCorrecao[]>('/secretaria/solicitacoes-correcao'));
  const [alvo, setAlvo] = useState<{ s: SolicitacaoCorrecao; modo: 'aplicar' | 'rejeitar' } | null>(null);
  const [texto, setTexto] = useState('');
  const acao = useAcao();

  const confirmar = async () => {
    if (!alvo) return;
    const { s, modo } = alvo;
    const ok = await acao.executar(async () => {
      if (modo === 'aplicar') {
        await api.post(`/secretaria/chamadas/${s.chamadaId}/correcoes`, { jovemId: s.jovemId, status: s.statusSugerido, justificativa: texto, solicitacaoId: s.id });
      } else {
        await api.post(`/secretaria/solicitacoes-correcao/${s.id}/rejeicao`, { resposta: texto });
      }
      return true;
    });
    if (ok) {
      setAlvo(null);
      await lista.recarregar();
    }
  };

  return (
    <>
      <Cabecalho titulo="Correções pendentes" descricao="Solicitações da secretaria para alterar chamadas já finalizadas." />
      <Aviso>{lista.erro}</Aviso>
      <Cartao>
        {lista.dados && !lista.dados.length ? <Vazio>Nenhuma solicitação pendente.</Vazio> : null}
        <ul className="lista-linhas">
          {lista.dados?.map((s) => (
            <li key={s.id}>
              <div>
                <strong>{s.jovem}</strong> em <Link to={`/secretaria/chamadas/${s.chamadaId}`}>{s.atividade} · {data(s.data)}</Link>: {rot(s.statusAtual)} → <strong>{rot(s.statusSugerido)}</strong>
                <div className="muted pequeno">{s.solicitadoPor} em {dataHora(s.solicitadoEm)}: “{s.justificativa}”</div>
              </div>
              <div className="acoes">
                <Botao variante="secundario" onClick={() => { setTexto(''); setAlvo({ s, modo: 'rejeitar' }); }}>Rejeitar</Botao>
                <Botao onClick={() => { setTexto(s.justificativa); setAlvo({ s, modo: 'aplicar' }); }}>Aplicar</Botao>
              </div>
            </li>
          ))}
        </ul>
      </Cartao>
      <Modal
        titulo={alvo?.modo === 'aplicar' ? 'Aplicar correção' : 'Rejeitar solicitação'}
        aberto={!!alvo}
        aoFechar={() => setAlvo(null)}
        rodape={<Botao variante={alvo?.modo === 'aplicar' ? 'primario' : 'perigo'} onClick={confirmar} carregando={acao.enviando} disabled={!texto.trim()}>Confirmar</Botao>}
      >
        <div className="form">
          <Aviso>{acao.erro}</Aviso>
          <Campo rotulo={alvo?.modo === 'aplicar' ? 'Justificativa (fica registrada na auditoria)' : 'Motivo da rejeição'}>
            <textarea rows={3} maxLength={500} value={texto} onChange={(e) => setTexto(e.target.value)} />
          </Campo>
        </div>
      </Modal>
    </>
  );
}
