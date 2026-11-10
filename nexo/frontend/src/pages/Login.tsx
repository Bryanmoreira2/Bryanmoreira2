import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Aviso, Botao, Campo, useAcao } from '../components/ui';

export function Login() {
  const { usuario, entrar } = useAuth();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const { enviando, erro, executar } = useAcao();

  if (usuario) return <Navigate to="/" replace />;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    void executar(() => entrar(email, senha));
  };

  return (
    <div className="login">
      <form className="login-cartao" onSubmit={enviar}>
        <div className="login-marca">
          <span className="marca-logo marca-logo-grande">N</span>
          <div>
            <h1>NEXO JOVEM</h1>
            <p className="muted">Secretaria e Tesouraria</p>
          </div>
        </div>
        <Aviso>{erro}</Aviso>
        <Campo rotulo="E-mail">
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Campo>
        <Campo rotulo="Senha">
          <input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </Campo>
        <Botao type="submit" carregando={enviando} className="btn-bloco">
          Entrar
        </Botao>
        <p className="muted pequeno">O acesso é individual e concedido pelo líder. Não compartilhe sua senha.</p>
      </form>
    </div>
  );
}
