import { useState } from 'react';
import { Link } from 'react-router-dom';
import { abrirPdf, api, mensagemErro } from '../../api/client';
import { data, pct } from '../../api/format';
import type { AlertaFrequencia, Atividade, FrequenciaGeral } from '../../api/types';
import { Aviso, Botao, Cabecalho, Campo, Carregando, Cartao, Indicador, Vazio, useCarregar } from '../../components/ui';

function Barra({ valor }: { valor: number | null }) {
  return (
    <div className="barra" aria-hidden>
      <div className="barra-preenchida" style={{ width: `${valor ?? 0}%` }} />
    </div>
  );
}

export function Frequencia() {
  const [filtro, setFiltro] = useState({ inicio: '', fim: '', atividadeId: '' });
  const atividades = useCarregar(() => api.get<Atividade[]>('/secretaria/atividades', { incluirInativas: 'true' }));
  const geral = useCarregar(() => api.get<FrequenciaGeral>('/secretaria/frequencia', filtro), [filtro]);
  const alertas = useCarregar(() => api.get<AlertaFrequencia[]>('/secretaria/alertas-frequencia'));
  const [erroPdf, setErroPdf] = useState<string | null>(null);
  const g = geral.dados;

  return (
    <>
      <Cabecalho
        titulo="Frequência e alertas"
        descricao="Calculada apenas sobre atividades em que cada jovem era elegível."
        acoes={<Botao variante="secundario" onClick={() => abrirPdf('/relatorios/secretaria', filtro).catch((e) => setErroPdf(mensagemErro(e)))}>Gerar PDF</Botao>}
      />
      <Aviso>{erroPdf ?? geral.erro}</Aviso>

      <Cartao titulo={`Alertas de participação (${alertas.dados?.length ?? 0})`}>
        <p className="muted pequeno">2 faltas consecutivas ou menos de 50% nas últimas 4 atividades. Os alertas servem para acompanhamento e cuidado — não alteram a situação do jovem.</p>
        {alertas.dados && !alertas.dados.length ? <Vazio>Nenhum alerta no momento. 🙌</Vazio> : null}
        <ul className="lista-linhas">
          {alertas.dados?.map((a) => (
            <li key={a.jovemId}>
              <div>
                <Link to={`/secretaria/jovens/${a.jovemId}`}><strong>{a.nome}</strong></Link>
                <div className="muted pequeno">{a.motivos.join(' · ')} · última presença: {data(a.ultimaPresenca)}</div>
              </div>
            </li>
          ))}
        </ul>
      </Cartao>

      <Cartao titulo="Indicadores">
        <div className="filtros">
          <Campo rotulo="De"><input type="date" value={filtro.inicio} onChange={(e) => setFiltro({ ...filtro, inicio: e.target.value })} /></Campo>
          <Campo rotulo="Até"><input type="date" value={filtro.fim} onChange={(e) => setFiltro({ ...filtro, fim: e.target.value })} /></Campo>
          <Campo rotulo="Atividade">
            <select value={filtro.atividadeId} onChange={(e) => setFiltro({ ...filtro, atividadeId: e.target.value })}>
              <option value="">Todas</option>
              {atividades.dados?.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </select>
          </Campo>
        </div>
        {!g ? <Carregando /> : (
          <>
            <div className="grade-indicadores">
              <Indicador rotulo="Frequência média" valor={pct(g.percentual)} destaque="azul" />
              <Indicador rotulo="Chamadas finalizadas" valor={g.totalChamadas} />
              <Indicador rotulo="Presenças" valor={g.presencas} />
              <Indicador rotulo="Ausências" valor={g.ausencias} />
            </div>
            {g.porAtividade.length ? (
              <>
                <h3>Por atividade</h3>
                <table className="tabela">
                  <thead><tr><th>Atividade</th><th className="num">Chamadas</th><th className="num">Frequência</th><th className="col-barra" /></tr></thead>
                  <tbody>
                    {g.porAtividade.map((a) => (
                      <tr key={a.atividadeId}><td>{a.atividade}</td><td className="num">{a.chamadas}</td><td className="num">{pct(a.percentual)}</td><td className="col-barra"><Barra valor={a.percentual} /></td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
            <h3>Por jovem</h3>
            {!g.porJovem.length ? <Vazio>Sem chamadas finalizadas no período.</Vazio> : (
              <div className="tabela-rolagem">
                <table className="tabela">
                  <thead><tr><th>Jovem</th><th className="num">Elegíveis</th><th className="num">Presenças</th><th className="num">Frequência</th><th className="col-barra" /></tr></thead>
                  <tbody>
                    {g.porJovem.map((j) => (
                      <tr key={j.jovemId}>
                        <td><Link to={`/secretaria/jovens/${j.jovemId}`}>{j.nome}</Link>{j.situacao === 'INATIVO' ? <span className="muted"> (inativo)</span> : null}</td>
                        <td className="num">{j.atividadesElegiveis}</td><td className="num">{j.presencas}</td><td className="num">{pct(j.percentual)}</td>
                        <td className="col-barra"><Barra valor={j.percentual} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Cartao>
    </>
  );
}
