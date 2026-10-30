// Error con código HTTP y mensaje apto para el usuario final.
export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const badRequest = (code: string, message: string) => new HttpError(400, code, message);
export const unauthorized = () => new HttpError(401, 'unauthorized', 'Inicia sesión para continuar.');
export const forbidden = () => new HttpError(403, 'forbidden', 'No tienes permiso para esta acción.');
export const notFound = (what = 'Recurso') => new HttpError(404, 'not_found', `${what} no encontrado.`);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
