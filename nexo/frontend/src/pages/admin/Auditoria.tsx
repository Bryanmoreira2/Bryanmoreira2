import { useState } from 'react';
import { api } from '../../api/client';
import { dataHora } from '../../api/format';
import type { RegistroAuditoria } from '../../api/types';
import { Aviso, Cabecalho, Campo, Carregando, Cartao, Vazio, useCarregar } from '../../components/ui';

const ENTIDADES = ['usuario', 'jovem', 'atividade', 'chamada', 'solicitacao_correcao', 'conta', 'movimentacao', 'transferencia', 'recebivel', 'fechamento', 'relatorio', 'configuracao'];

export function Auditoria() {
  const [f, setF] = useState({ entidade: '', inicio: '', fim: '' });
  const lista = useCarregar(() => api.get<RegistroAuditoria[]>('/auditoria', f), [f]);
  return (
    <>
      <Cabecalho titulo="Auditoria" descricao="Registro somente-inclusão das operações administrativas e financeiras." />
      <Cartao>
        <div className="filtros">
          <Campo rotulo="Entidade">
            <select value={f.entidade} onChange={(e) => setF({ ...f, entidade: e.target.value })}>
              <option value="">Todas</option>
              {ENTIDADES.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </Campo>
          <Campo rotulo="De"><input type="date" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} /></Campo>
          <Campo rotulo="Até"><input type="date" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} /></Campo>
        </div>
        <Aviso>{lista.erro}</Aviso>
        {!lista.dados ? <Carregando /> : !lista.dados.length ? <Vazio>Nenhum registro.</Vazio> : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Registro</th><th>Detalhes</th></tr></thead>
              <tbody>
                {lista.dados.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap">{dataHora(a.criadoEm)}</td>
                    <td>{a.usuario ?? 'sistema'}</td>
                    <td><code>{a.acao}</code></td>
                    <td>{a.entidade} #{a.entidadeId}</td>
                    <td className="detalhes">{a.detalhes ? <code>{JSON.stringify(a.detalhes)}</code> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
    </>
  );
}
