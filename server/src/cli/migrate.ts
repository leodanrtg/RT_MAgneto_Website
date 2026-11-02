import { loadConfig } from '../config.ts';
import { connect, migrate } from '../db.ts';

const sql = connect(loadConfig().DATABASE_URL, 1);
const applied = await migrate(sql, console.log);
console.log(applied.length ? `${applied.length} migraciones aplicadas.` : 'La base de datos ya está al día.');
await sql.end();
