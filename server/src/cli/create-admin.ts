import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfig } from '../config.ts';
import { connect } from '../db.ts';
import { hashPassword } from '../auth/passwords.ts';
import { audit } from '../audit.ts';

// Crea el primer administrador desde la consola del servidor (no existe ninguna ruta web para ello).
// Uso: npm run create-admin -- correo@dominio.com "Nombre"
// La contraseña se pide por teclado y no queda en el historial de la terminal.
const [email, name] = process.argv.slice(2);
if (!email || !name) {
  console.error('Uso: npm run create-admin -- correo@dominio.com "Nombre"');
  process.exit(1);
}
const rl = createInterface({ input: stdin, output: stdout, terminal: true });
const password = await rl.question('Contraseña (mínimo 12 caracteres): ');
rl.close();
if (password.length < 12) {
  console.error('La contraseña es demasiado corta.');
  process.exit(1);
}

const sql = connect(loadConfig().DATABASE_URL, 1);
const hash = await hashPassword(password);
const [user] = await sql`
  INSERT INTO users (name, email, password_hash, role, email_verified_at)
  VALUES (${name}, ${email.toLowerCase()}, ${hash}, 'admin', now())
  ON CONFLICT (lower(email)) DO UPDATE SET role = 'admin', updated_at = now()
  RETURNING id, (xmax = 0) AS created`;
await audit(sql, { actorUserId: user.id, action: user.created ? 'admin.created_cli' : 'admin.promoted_cli', targetType: 'user', targetId: user.id });
console.log(user.created ? 'Administrador creado.' : 'La cuenta ya existía: ahora es administradora (su contraseña no cambia).');
await sql.end();
