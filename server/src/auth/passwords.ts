import { hash, verify } from '@node-rs/argon2';

// Argon2id con los parámetros recomendados por OWASP (19 MiB, 2 iteraciones).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string) => hash(password, OPTIONS);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

// Hash fijo para gastar el mismo tiempo cuando el correo no existe (evita enumerar cuentas).
let dummy: Promise<string> | undefined;
export const dummyHash = () => (dummy ??= hashPassword('rt-magneto-dummy-password'));
