import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Aviso, Botao, Cabecalho, Campo, Cartao, useAcao } from '../components/ui';

export function MinhaConta() {
  const { usuario } = useAuth();
  const [f, setF] = useState({ senhaAtual: '', novaSenha: '', confirmar: '' });
  const [ok, setOk] = useState(false);
  const acao = useAcao();
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setOk(false);
    if (f.novaSenha !== f.confirmar) return acao.setErro('A confirmação não confere com a nova senha.');
    const r = await acao.executar(async () => { await api.post('/auth/senha', { senhaAtual: f.senhaAtual, novaSenha: f.novaSenha }); return true; });
    if (r) {
      setOk(true);
      setF({ senhaAtual: '', novaSenha: '', confirmar: '' });
    }
  };
  return (
    <>
      <Cabecalho titulo="Minha conta" descricao={`${usuario?.nome} · ${usuario?.email}`} />
      <Cartao titulo="Alterar senha" className="estreito">
        <form className="form" onSubmit={enviar}>
          <Aviso>{acao.erro}</Aviso>
          {ok ? <Aviso tipo="sucesso">Senha alterada com sucesso.</Aviso> : null}
          <Campo rotulo="Senha atual"><input type="password" required autoComplete="current-password" value={f.senhaAtual} onChange={(e) => setF({ ...f, senhaAtual: e.target.value })} /></Campo>
          <Campo rotulo="Nova senha" dica="Mínimo de 10 caracteres."><input type="password" required minLength={10} autoComplete="new-password" value={f.novaSenha} onChange={(e) => setF({ ...f, novaSenha: e.target.value })} /></Campo>
          <Campo rotulo="Confirmar nova senha"><input type="password" required minLength={10} autoComplete="new-password" value={f.confirmar} onChange={(e) => setF({ ...f, confirmar: e.target.value })} /></Campo>
          <Botao type="submit" carregando={acao.enviando}>Salvar</Botao>
        </form>
      </Cartao>
    </>
  );
}
