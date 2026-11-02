// Cliente de la API del backend comercial. Misma web, misma cookie de sesión.
import { lang, t } from './i18n.js';

let csrf = null;

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || t('Error de conexión. Inténtalo de nuevo.'));
    this.status = status;
    this.code = body?.error;
    this.fields = body?.fields || [];
  }
}

export async function api(method, path, body) {
  // el servidor responde los mensajes en el idioma de la página
  const headers = { Accept: 'application/json', 'Accept-Language': lang() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, null);
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  if (data?.csrfToken) csrf = data.csrfToken;
  return data;
}

// Sesión actual o null si no hay.
export async function me() {
  try {
    return (await api('GET', '/auth/me')).user;
  } catch (err) {
    if (err.status === 401) return null;
    throw err;
  }
}

export async function logout() {
  await api('POST', '/auth/logout').catch(() => {});
  csrf = null;
}
