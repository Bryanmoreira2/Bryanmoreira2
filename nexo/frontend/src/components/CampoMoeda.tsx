import { paraCentavos } from '../api/format';

/** Entrada de valores em reais; o valor é enviado à API em centavos inteiros (RNF-005). */
export function CampoMoeda({ valor, aoMudar, obrigatorio = true }: { valor: string; aoMudar: (v: string) => void; obrigatorio?: boolean }) {
  const invalido = valor !== '' && paraCentavos(valor) === null;
  return (
    <div className="moeda">
      <span className="moeda-prefixo">R$</span>
      <input
        inputMode="decimal"
        placeholder="0,00"
        required={obrigatorio}
        value={valor}
        aria-invalid={invalido}
        onChange={(e) => aoMudar(e.target.value.replace(/[^\d.,]/g, ''))}
      />
    </div>
  );
}
