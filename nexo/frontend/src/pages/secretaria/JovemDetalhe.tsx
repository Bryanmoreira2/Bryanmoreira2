import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { data, dataHora, hojeISO, pct } from '../../api/format';
import type { FrequenciaJovem, JovemDetalhe as TJovem } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { Aviso, Botao, Cabecalho, Campo, Carregando, Cartao, Indicador, Modal, Selo, Vazio, useAcao, useCarregar } from '../../components/ui';
import { CamposJovem, paraPayload, type FormJovem } from './Jovens';

export function JovemDetalhe() {
  const id = Number(useParams().id);
  const { tem } = useAuth();
  const jovem = useCarregar(() => api.get<TJovem>(`/jovens/${id}`), [id]);
  const [periodo, setPeriodo] = useState({ inicio: '', fim: '' });
  const freq = useCarregar(() => api.get<FrequenciaJovem>(`/jovens/${id}/frequencia`, periodo), [id, periodo]);
  const [editando, setEditando] = useState<FormJovem | null>(null);
  const [situacao, setSituacao] = useState<{ motivo: string; desde: string } | null>(null);
  const acao = useAcao();

  if (jovem.erro) return <Aviso>{jovem.erro}</Aviso>;
  const j = jovem.dados;
  if (!j) return <Carregando />;

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (!editando) return;
    if (await acao.executar(() => api.patch(`/jovens/${id}`, paraPayload(editando, false)))) {
      setEditando(null);
      await jovem.recarregar();
    }
  };

  const alterarSituacao = async (e: FormEvent) => {
    e.preventDefault();
    if (!situacao) return;
    const nova = j.situacao === 'ATIVO' ? 'INATIVO' : 'ATIVO';
    if (await acao.executar(() => api.patch(`/jovens/${id}/situacao`, { situacao: nova, motivo: situacao.motivo || null, desde: situacao.desde }))) {
      setSituacao(null);
      await jovem.recarregar();
    }
  };

  return (
    <>
      <Link to="/secretaria/jovens" className="muted pequeno">← Jovens</Link>
      <Cabecalho
        titulo={j.nome}
        descricao={`No grupo desde ${data(j.dataIngresso)}`}
        acoes={
          tem('LIDER') ? (
            <>
              <Botao variante="secundario" onClick={() => setEditando({ nome: j.nome, dataNascimento: j.dataNascimento ?? '', telefone: j.telefone ?? '', responsavelNome: j.responsavelNome ?? '', responsavelTelefone: j.responsavelTelefone ?? '', observacoes: j.observacoes ?? '', dataIngresso: j.dataIngresso })}>
                Editar
              </Botao>
              <Botao variante={j.situacao === 'ATIVO' ? 'perigo' : 'sucesso'} onClick={() => setSituacao({ motivo: '', desde: hojeISO() })}>
                {j.situacao === 'ATIVO' ? 'Inativar' : 'Reativar'}
              </Botao>
            </>
          ) : null
        }
      />

      <div className="grade-2">
        <Cartao titulo="Cadastro">
          <dl className="definicoes">
            <dt>Situação</dt><dd><Selo cor={j.situacao === 'ATIVO' ? 'verde' : 'neutro'}>{j.situacao === 'ATIVO' ? 'Ativo' : 'Inativo'}</Selo></dd>
            <dt>Nascimento</dt><dd>{data(j.dataNascimento)}</dd>
            <dt>Telefone</dt><dd>{j.telefone ?? '—'}</dd>
            <dt>Responsável</dt><dd>{j.responsavelNome ?? '—'} {j.responsavelTelefone ? `· ${j.responsavelTelefone}` : ''}</dd>
            <dt>Observações</dt><dd>{j.observacoes ?? '—'}</dd>
          </dl>
          <h3>Histórico de situação</h3>
          <ul className="lista-simples pequeno">
            {j.historicoSituacao.map((h, i) => (
              <li key={i}>
                {data(h.desde)} — <strong>{h.situacao === 'ATIVO' ? 'Ativo' : 'Inativo'}</strong>
                {h.motivo ? ` (${h.motivo})` : ''} <span className="muted">por {h.usuario} em {dataHora(h.criadoEm)}</span>
              </li>
            ))}
          </ul>
        </Cartao>

        <Cartao titulo="Frequência">
          <div className="filtros">
            <Campo rotulo="De"><input type="date" value={periodo.inicio} onChange={(e) => setPeriodo({ ...periodo, inicio: e.target.value })} /></Campo>
            <Campo rotulo="Até"><input type="date" value={periodo.fim} onChange={(e) => setPeriodo({ ...periodo, fim: e.target.value })} /></Campo>
          </div>
          {freq.dados ? (
            <>
              {freq.dados.alerta.ativo ? <Aviso tipo="atencao">Atenção: {freq.dados.alerta.motivos.join(' e ')}. Este alerta é apenas informativo.</Aviso> : null}
              <div className="grade-indicadores">
                <Indicador rotulo="Frequência" valor={pct(freq.dados.percentual)} destaque="azul" />
                <Indicador rotulo="Presenças" valor={freq.dados.presencas} />
                <Indicador rotulo="Ausências" valor={freq.dados.ausencias} />
                <Indicador rotulo="Atividades elegíveis" valor={freq.dados.atividadesElegiveis} />
              </div>
              {!freq.dados.historico.length ? <Vazio>Sem chamadas finalizadas no período.</Vazio> : (
                <div className="tabela-rolagem altura-limitada">
                  <table className="tabela">
                    <thead><tr><th>Data</th><th>Atividade</th><th>Marcação</th></tr></thead>
                    <tbody>
                      {freq.dados.historico.map((h) => (
                        <tr key={h.chamadaId}>
                          <td><Link to={`/secretaria/chamadas/${h.chamadaId}`}>{data(h.data)}</Link></td>
                          <td>{h.atividade}</td>
                          <td><Selo cor={h.status === 'PRESENTE' ? 'verde' : 'vermelho'}>{h.status === 'PRESENTE' ? 'Presente' : 'Ausente'}</Selo></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : <Carregando />}
        </Cartao>
      </div>

      <Modal titulo="Editar cadastro" aberto={!!editando} aoFechar={() => setEditando(null)} rodape={<Botao form="form-editar" type="submit" carregando={acao.enviando}>Salvar</Botao>}>
        {editando ? (
          <form id="form-editar" className="form form-grade" onSubmit={salvar}>
            <Aviso>{acao.erro}</Aviso>
            <CamposJovem v={editando} set={setEditando} />
          </form>
        ) : null}
      </Modal>

      <Modal titulo={j.situacao === 'ATIVO' ? 'Inativar jovem' : 'Reativar jovem'} aberto={!!situacao} aoFechar={() => setSituacao(null)} rodape={<Botao form="form-situacao" type="submit" carregando={acao.enviando}>Confirmar</Botao>}>
        {situacao ? (
          <form id="form-situacao" className="form" onSubmit={alterarSituacao}>
            <Aviso>{acao.erro}</Aviso>
            <p className="muted">A mudança vale a partir da data informada e não altera chamadas e relatórios anteriores.</p>
            <Campo rotulo="A partir de"><input type="date" required max={hojeISO()} value={situacao.desde} onChange={(e) => setSituacao({ ...situacao, desde: e.target.value })} /></Campo>
            <Campo rotulo="Motivo (opcional)"><input maxLength={300} value={situacao.motivo} onChange={(e) => setSituacao({ ...situacao, motivo: e.target.value })} /></Campo>
          </form>
        ) : null}
      </Modal>
    </>
  );
}
