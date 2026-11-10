import { useState } from 'react';
import { abrirPdf, api, mensagemErro } from '../api/client';
import { data, dataHora, hojeISO, inicioDoMesISO } from '../api/format';
import type { Atividade, Conta, RelatorioEmitido } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Aviso, Botao, Cabecalho, Campo, Cartao, Vazio, useCarregar } from '../components/ui';

const TIPOS: Record<string, string> = {
  SECRETARIA_FREQUENCIA: 'Frequência (Secretaria)',
  SECRETARIA_CHAMADA: 'Chamada (Secretaria)',
  TESOURARIA_PERIODO: 'Financeiro por período',
  TESOURARIA_FECHAMENTO: 'Fechamento mensal',
};

export function Relatorios() {
  const { tem } = useAuth();
  const emitidos = useCarregar(() => api.get<RelatorioEmitido[]>('/relatorios'));
  const atividades = useCarregar(() => (tem('SECRETARIO') ? api.get<Atividade[]>('/secretaria/atividades', { incluirInativas: 'true' }) : Promise.resolve([])));
  const contas = useCarregar(() => (tem('TESOUREIRO') ? api.get<Conta[]>('/tesouraria/contas') : Promise.resolve([])));
  const [sec, setSec] = useState({ inicio: inicioDoMesISO(), fim: hojeISO(), atividadeId: '' });
  const [tes, setTes] = useState({ inicio: inicioDoMesISO(), fim: hojeISO(), contaId: '' });
  const [erro, setErro] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);

  const gerar = async (path: string, q: Record<string, string>) => {
    setErro(null);
    setGerando(true);
    try {
      await abrirPdf(path, q);
      await emitidos.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setGerando(false);
    }
  };

  return (
    <>
      <Cabecalho titulo="Relatórios" descricao="PDFs numerados, prontos para impressão em A4, assinatura manual e arquivamento." />
      <Aviso>{erro ?? emitidos.erro}</Aviso>
      <div className="grade-2">
        {tem('SECRETARIO') ? (
          <Cartao titulo="Secretaria — frequência">
            <div className="form form-grade">
              <Campo rotulo="De"><input type="date" value={sec.inicio} onChange={(e) => setSec({ ...sec, inicio: e.target.value })} /></Campo>
              <Campo rotulo="Até"><input type="date" value={sec.fim} onChange={(e) => setSec({ ...sec, fim: e.target.value })} /></Campo>
              <Campo rotulo="Atividade" largo>
                <select value={sec.atividadeId} onChange={(e) => setSec({ ...sec, atividadeId: e.target.value })}>
                  <option value="">Todas</option>
                  {atividades.dados?.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
                </select>
              </Campo>
            </div>
            <Botao carregando={gerando} onClick={() => gerar('/relatorios/secretaria', sec)}>Gerar PDF</Botao>
            <p className="muted pequeno">O relatório de uma chamada específica é gerado na própria chamada.</p>
          </Cartao>
        ) : null}
        {tem('TESOUREIRO') ? (
          <Cartao titulo="Tesouraria — período">
            <div className="form form-grade">
              <Campo rotulo="De"><input type="date" value={tes.inicio} onChange={(e) => setTes({ ...tes, inicio: e.target.value })} /></Campo>
              <Campo rotulo="Até"><input type="date" value={tes.fim} onChange={(e) => setTes({ ...tes, fim: e.target.value })} /></Campo>
              <Campo rotulo="Conta" largo>
                <select value={tes.contaId} onChange={(e) => setTes({ ...tes, contaId: e.target.value })}>
                  <option value="">Todas</option>
                  {contas.dados?.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </Campo>
            </div>
            <Botao carregando={gerando} onClick={() => gerar('/relatorios/tesouraria', tes)}>Gerar PDF</Botao>
            <p className="muted pequeno">O relatório definitivo do mês é emitido no fechamento aprovado.</p>
          </Cartao>
        ) : null}
      </div>
      <Cartao titulo="Relatórios emitidos">
        {emitidos.dados && !emitidos.dados.length ? <Vazio>Nenhum relatório emitido ainda.</Vazio> : null}
        {emitidos.dados?.length ? (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead><tr><th>Número</th><th>Tipo</th><th>Período</th><th>Emitido por</th><th>Em</th></tr></thead>
              <tbody>
                {emitidos.dados.map((r) => (
                  <tr key={r.id}>
                    <td><code>{r.numero}</code></td>
                    <td>{TIPOS[r.tipo] ?? r.tipo}</td>
                    <td>{r.periodoInicio || r.periodoFim ? `${data(r.periodoInicio)} a ${data(r.periodoFim)}` : 'Todo o histórico'}</td>
                    <td>{r.emitidoPor}</td>
                    <td>{dataHora(r.emitidoEm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Cartao>
    </>
  );
}
