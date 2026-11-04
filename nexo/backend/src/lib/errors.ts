export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'REQUISICAO_INVALIDA', msg, details);
export const unauthorized = (msg = 'Autenticação necessária.') => new AppError(401, 'NAO_AUTENTICADO', msg);
export const forbidden = (msg = 'Você não tem permissão para esta operação.') => new AppError(403, 'SEM_PERMISSAO', msg);
export const notFound = (what = 'Registro') => new AppError(404, 'NAO_ENCONTRADO', `${what} não encontrado(a).`);
export const conflict = (code: string, msg: string, details?: unknown) => new AppError(409, code, msg, details);
export const unprocessable = (code: string, msg: string, details?: unknown) => new AppError(422, code, msg, details);
