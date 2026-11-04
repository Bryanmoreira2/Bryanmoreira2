import { z, type ZodTypeAny } from 'zod';
import { badRequest } from './errors.js';

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest(
      'Dados inválidos.',
      r.error.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })),
    );
  }
  return r.data;
}

const isValidDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export const dataISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.')
  .refine(isValidDate, 'Data inválida.');

/** Valor em centavos inteiros, estritamente positivo (RN-026, RNF-005). */
export const centavos = z
  .number({ invalid_type_error: 'Informe o valor em centavos.' })
  .int('Use centavos inteiros.')
  .positive('O valor deve ser maior que zero.')
  .max(100_000_000_00, 'Valor acima do limite permitido.');

export const idParam = z.coerce.number().int().positive();

export const texto = (max = 500) => z.string().trim().min(1, 'Campo obrigatório.').max(max);
export const textoOpcional = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
