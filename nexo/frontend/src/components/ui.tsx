import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { mensagemErro } from '../api/client';

/** Carrega dados assíncronos com estados de carregamento/erro e recarga. */
export function useCarregar<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      setDados(await fnRef.current());
      setErro(null);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setCarregando(false);
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void recarregar(), deps);
  return { dados, erro, carregando, recarregar, setDados };
}

/** Executa uma ação com estado de "enviando" e mensagem de erro. */
export function useAcao() {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const executar = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setEnviando(true);
    setErro(null);
    try {
      return await fn();
    } catch (e) {
      setErro(mensagemErro(e));
      return undefined;
    } finally {
      setEnviando(false);
    }
  }, []);
  return { enviando, erro, setErro, executar };
}

type Variante = 'primario' | 'secundario' | 'perigo' | 'fantasma' | 'sucesso';
export function Botao({ variante = 'primario', carregando, children, className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; carregando?: boolean }) {
  return (
    <button {...p} className={`btn btn-${variante} ${className}`} disabled={p.disabled || carregando}>
      {carregando ? <span className="spinner" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Campo({ rotulo, children, dica, largo }: { rotulo: string; children: ReactNode; dica?: string; largo?: boolean }) {
  return (
    <label className={`campo ${largo ? 'campo-largo' : ''}`}>
      <span className="campo-rotulo">{rotulo}</span>
      {children}
      {dica ? <span className="campo-dica">{dica}</span> : null}
    </label>
  );
}

export function Aviso({ tipo = 'erro', children }: { tipo?: 'erro' | 'info' | 'sucesso' | 'atencao'; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className={`aviso aviso-${tipo}`} role={tipo === 'erro' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Selo({ cor = 'neutro', children }: { cor?: 'neutro' | 'verde' | 'vermelho' | 'amarelo' | 'azul'; children: ReactNode }) {
  return <span className={`selo selo-${cor}`}>{children}</span>;
}

export function Carregando() {
  return (
    <div className="carregando">
      <span className="spinner" /> Carregando…
    </div>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="vazio">{children}</div>;
}

export function Cabecalho({ titulo, descricao, acoes }: { titulo: string; descricao?: string; acoes?: ReactNode }) {
  return (
    <header className="pagina-cabecalho">
      <div>
        <h1>{titulo}</h1>
        {descricao ? <p className="muted">{descricao}</p> : null}
      </div>
      {acoes ? <div className="acoes">{acoes}</div> : null}
    </header>
  );
}

export function Cartao({ titulo, acoes, children, className = '' }: { titulo?: string; acoes?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`cartao ${className}`}>
      {titulo || acoes ? (
        <div className="cartao-topo">
          {titulo ? <h2>{titulo}</h2> : <span />}
          {acoes}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Indicador({ rotulo, valor, detalhe, destaque }: { rotulo: string; valor: ReactNode; detalhe?: ReactNode; destaque?: 'verde' | 'vermelho' | 'azul' | 'amarelo' }) {
  return (
    <div className={`indicador ${destaque ? `indicador-${destaque}` : ''}`}>
      <span className="indicador-rotulo">{rotulo}</span>
      <strong className="indicador-valor">{valor}</strong>
      {detalhe ? <span className="indicador-detalhe">{detalhe}</span> : null}
    </div>
  );
}

export function Modal({ titulo, aberto, aoFechar, children, rodape }: { titulo: string; aberto: boolean; aoFechar: () => void; children: ReactNode; rodape?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);
  return (
    <dialog ref={ref} className="modal" onClose={aoFechar} onCancel={aoFechar}>
      <div className="modal-topo">
        <h2>{titulo}</h2>
        <button className="btn btn-fantasma btn-icone" onClick={aoFechar} aria-label="Fechar">
          ✕
        </button>
      </div>
      <div className="modal-corpo">{aberto ? children : null}</div>
      {rodape ? <div className="modal-rodape">{rodape}</div> : null}
    </dialog>
  );
}
