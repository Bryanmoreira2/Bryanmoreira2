import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { abrirPdf, api, mensagemErro } from '../../api/client';
import { data, dataHora, pct } from '../../api/format';
import type { Chamada as TChamada, MiniRelatorio, SolicitacaoCorrecao, StatusPresenca } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { Aviso, Botao, Campo, Carregando, Cartao, Indicador, Modal, Selo, useAcao, useCarregar } from '../../components/ui';

export function Chamada() {
  const id = Number(useParams().id);
  const { tem } = useAuth();
  const { dados: c, erro, setDados, recarregar } = useCarregar(() => api.get<TChamada>(`/secretaria/chamadas/${id}`), [id]);
  const resumo = useCarregar(() => (c?.status === 'FINALIZADA' ? api.get<MiniRelatorio>(`/secretaria/chamadas/${id}/resumo`) : Promise.resolve(null)), [c?.status, c?.correcoes.length]);
  const solicitacoes = useCarregar(() => (c?.status === 'FINALIZADA' ? api.get<SolicitacaoCorrecao[]>(`/secretaria/chamadas/${id}/solicitacoes-correcao`) : Promise.resolve([])), [c?.status, c?.correcoes.length]);
  const [busca, setBusca] = useState('');
  const [erroMarcacao, setErroMarcacao] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<Set<number>>(new Set());
  const final = useAcao();
  const [correcao, setCorrecao] = useState<{ jovemId: number; nome: string; status: StatusPresenca; solicitacaoId?: number } | null>(null);
  const [justificativa, setJustificativa] = useState('');
  const acaoCorrecao = useAcao();

  const filtradas = useMemo(
    () => (c?.presencas ?? []).filter((p) => p.nome.toLocaleLowerCase('pt-BR').includes(busca.toLocaleLowerCase('pt-BR'))),
    [c, busca],
  );

  if (erro) return <Aviso>{erro}</Aviso>;
  if (!c) return <Carregando />;

  const aberta = c.status === 'ABERTA';
  const presentes = c.presencas.filter((p) => p.status === 'PRESENTE').length;
  const ausentes = c.presencas.filter((p) => p.status === 'AUSENTE').length;

  // Atualização otimista: a marcação aparece na hora e é revertida se o servidor recusar.
  const marcar = async (jovemId: number, status: StatusPresenca) => {
    const anterior = c.presencas.find((p) => p.jovemId === jovemId)?.status ?? null;
    if (anterior === status) return;
    setErroMarcacao(null);
    setDados({ ...c, presencas: c.presencas.map((p) => (p.jovemId === jovemId ? { ...p, status } : p)), pendentes: c.pendentes - (anterior ? 0 : 1) });
    setSalvando((s) => new Set(s).add(jovemId));
    try {
      await api.put(`/secretaria/chamadas/${id}/presencas/${jovemId}`, { status });
    } catch (e) {
      setErroMarcacao(mensagemErro(e));
      await recarregar();
    } finally {
      setSalvando((s) => {
        const n = new Set(s);
        n.delete(jovemId);
        return n;
      });
    }
  };

  const restantesAusentes = async () => {
    const pend = c.presencas.filter((p) => !p.status);
    if (!pend.length) return;
    if (!confirm(`Marcar ${pend.length} jovem(ns) sem marcação como ausente(s)?`)) return;
    const r = await final.executar(() => api.put<TChamada>(`/secretaria/chamadas/${id}/presencas`, { marcacoes: pend.map((p) => ({ jovemId: p.jovemId, status: 'AUSENTE' })) }));
    if (r) setDados(r);
  };

  const finalizar = async () => {
    if (!confirm('Finalizar a chamada? Depois disso, alterações só com autorização do líder.')) return;
    const r = await final.executar(() => api.post<MiniRelatorio>(`/secretaria/chamadas/${id}/finalizacao`));
    if (r) await recarregar();
  };

  const enviarCorrecao = async () => {
    if (!correcao) return;
    const ok = await acaoCorrecao.executar(async () => {
      if (tem('LIDER')) {
        const r = await api.post<TChamada>(`/secretaria/chamadas/${id}/correcoes`, { jovemId: correcao.jovemId, status: correcao.status, justificativa, solicitacaoId: correcao.solicitacaoId });
        setDados(r);
      } else {
        await api.post(`/secretaria/chamadas/${id}/solicitacoes-correcao`, { jovemId: correcao.jovemId, status: correcao.status, justificativa });
        await solicitacoes.recarregar();
      }
      return true;
    });
    if (ok) {
      setCorrecao(null);
      setJustificativa('');
    }
  };

  return (
    <div className="chamada">
      <div className="chamada-topo">
        <div>
          <Link to="/secretaria/chamadas" className="muted pequeno">← Chamadas</Link>
          <h1>{c.atividade}</h1>
          <p className="muted">
            {data(c.data)}{c.descricao ? ` · ${c.descricao}` : ''} · aberta por {c.abertaPor}
          </p>
        </div>
        {aberta ? <Selo cor="amarelo">Aberta</Selo> : <Selo cor="verde">Finalizada por {c.finalizadaPor} em {dataHora(c.finalizadaEm)}</Selo>}
      </div>

      <div className="chamada-contadores">
        <Indicador rotulo="Presentes" valor={presentes} destaque="verde" />
        <Indicador rotulo="Ausentes" valor={ausentes} destaque="vermelho" />
        <Indicador rotulo="Pendentes" valor={c.pendentes} destaque={c.pendentes ? 'amarelo' : undefined} />
        <Indicador rotulo="Total elegível" valor={c.presencas.length} />
      </div>

      <Aviso>{erroMarcacao ?? final.erro}</Aviso>

      {!aberta && resumo.dados ? (
        <Cartao titulo="Mini relatório" acoes={<Botao variante="secundario" onClick={() => abrirPdf(`/relatorios/secretaria/chamadas/${id}`).catch((e) => alert(mensagemErro(e)))}>Gerar PDF</Botao>}>
          <p className="destaque-grande">{pct(resumo.dados.percentualPresenca)} de presença</p>
          <div className="duas-colunas">
            <div>
              <h3>Presentes ({resumo.dados.totalPresentes})</h3>
              <p>{resumo.dados.presentes.join(', ') || '—'}</p>
            </div>
            <div>
              <h3>Ausentes ({resumo.dados.totalAusentes})</h3>
              <p>{resumo.dados.ausentes.join(', ') || '—'}</p>
            </div>
          </div>
        </Cartao>
      ) : null}

      <div className="chamada-barra">
        <input className="busca" type="search" placeholder="Buscar jovem…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        {aberta ? (
          <>
            <Botao variante="secundario" onClick={restantesAusentes} disabled={!c.pendentes}>Restantes ausentes</Botao>
            <Botao variante="sucesso" onClick={finalizar} carregando={final.enviando} disabled={c.pendentes > 0 || salvando.size > 0}>
              Finalizar chamada
            </Botao>
          </>
        ) : null}
      </div>

      {!c.presencas.length ? <Aviso tipo="info">Nenhum jovem estava ativo nesta data.</Aviso> : null}

      <ul className="lista-presenca">
        {filtradas.map((p) => (
          <li key={p.jovemId} className={`presenca presenca-${p.status?.toLowerCase() ?? 'pendente'}`}>
            <span className="presenca-nome">{p.nome}</span>
            {aberta ? (
              <div className="presenca-botoes" role="group" aria-label={`Marcação de ${p.nome}`}>
                <button className={`toque toque-presente ${p.status === 'PRESENTE' ? 'ativo' : ''}`} aria-pressed={p.status === 'PRESENTE'} onClick={() => marcar(p.jovemId, 'PRESENTE')}>
                  Presente
                </button>
                <button className={`toque toque-ausente ${p.status === 'AUSENTE' ? 'ativo' : ''}`} aria-pressed={p.status === 'AUSENTE'} onClick={() => marcar(p.jovemId, 'AUSENTE')}>
                  Ausente
                </button>
              </div>
            ) : (
              <div className="presenca-botoes">
                <Selo cor={p.status === 'PRESENTE' ? 'verde' : 'vermelho'}>{p.status === 'PRESENTE' ? 'Presente' : 'Ausente'}</Selo>
                <Botao variante="fantasma" onClick={() => setCorrecao({ jovemId: p.jovemId, nome: p.nome, status: p.status === 'PRESENTE' ? 'AUSENTE' : 'PRESENTE' })}>
                  {tem('LIDER') ? 'Corrigir' : 'Solicitar correção'}
                </Botao>
              </div>
            )}
          </li>
        ))}
      </ul>

      {!aberta && (solicitacoes.dados?.length || c.correcoes.length) ? (
        <Cartao titulo="Correções">
          {solicitacoes.dados?.map((s) => (
            <div key={s.id} className="linha-correcao">
              <div>
                <strong>{s.jovem}</strong>: {s.statusAtual === 'PRESENTE' ? 'Presente' : 'Ausente'} → {s.statusSugerido === 'PRESENTE' ? 'Presente' : 'Ausente'}
                <div className="muted pequeno">Solicitado por {s.solicitadoPor} em {dataHora(s.solicitadoEm)}: “{s.justificativa}”</div>
                {s.resposta ? <div className="muted pequeno">Resposta: {s.resposta}</div> : null}
              </div>
              {s.situacao === 'PENDENTE' && tem('LIDER') ? (
                <Botao variante="secundario" onClick={() => { setJustificativa(s.justificativa); setCorrecao({ jovemId: s.jovemId, nome: s.jovem, status: s.statusSugerido, solicitacaoId: s.id }); }}>
                  Aplicar
                </Botao>
              ) : (
                <Selo cor={s.situacao === 'APLICADA' ? 'verde' : s.situacao === 'REJEITADA' ? 'vermelho' : 'amarelo'}>{s.situacao.toLowerCase()}</Selo>
              )}
            </div>
          ))}
          {c.correcoes.map((x) => (
            <div key={`c${x.id}`} className="linha-correcao">
              <div>
                <strong>{x.jovem}</strong>: {x.statusAnterior ?? '—'} → {x.statusNovo}
                <div className="muted pequeno">Autorizado por {x.autorizadoPor} em {dataHora(x.criadoEm)}: “{x.justificativa}”</div>
              </div>
              <Selo cor="azul">corrigido</Selo>
            </div>
          ))}
        </Cartao>
      ) : null}

      <Modal
        titulo={tem('LIDER') ? 'Corrigir marcação' : 'Solicitar correção ao líder'}
        aberto={!!correcao}
        aoFechar={() => setCorrecao(null)}
        rodape={<Botao onClick={enviarCorrecao} carregando={acaoCorrecao.enviando} disabled={!justificativa.trim()}>{tem('LIDER') ? 'Aplicar correção' : 'Enviar solicitação'}</Botao>}
      >
        {correcao ? (
          <div className="form">
            <Aviso>{acaoCorrecao.erro}</Aviso>
            <p>
              <strong>{correcao.nome}</strong> passará a constar como <strong>{correcao.status === 'PRESENTE' ? 'presente' : 'ausente'}</strong>. O registro original é mantido no histórico.
            </p>
            <Campo rotulo="Justificativa">
              <textarea required rows={3} maxLength={500} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
            </Campo>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
