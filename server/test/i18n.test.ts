import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { knownMessages, pickLang, translate } from '../src/lib/i18n.ts';
import { createUser, setup, type Ctx } from './helpers.ts';

let ctx: Ctx;
beforeAll(async () => { ctx = await setup(); });
afterAll(async () => { await ctx.app.close(); await ctx.sql.end(); });

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
});

describe('idiomas de la API', () => {
  it('cada mensaje para el usuario tiene traducción', () => {
    const found = new Set<string>();
    for (const f of files('src')) {
      const s = readFileSync(f, 'utf8');
      for (const m of s.matchAll(/(?:badRequest|conflict)\(\s*'[^']*',\s*'((?:[^'\\]|\\.)*)'/g)) found.add(m[1]);
      for (const m of s.matchAll(/HttpError\(\s*\d+,\s*'[^']*',\s*'((?:[^'\\]|\\.)*)'/g)) found.add(m[1]);
      for (const m of s.matchAll(/\bmessage: '((?:[^'\\]|\\.)*)'/g)) found.add(m[1]);
      for (const m of s.matchAll(/notFound\('((?:[^'\\]|\\.)*)'\)/g)) found.add(m[1]);
    }
    const known = new Set(knownMessages());
    expect([...found].filter((m) => !known.has(m))).toEqual([]);
  });

  it('elige el idioma de Accept-Language y vuelve al español si no lo conoce', () => {
    expect(pickLang('en-US,en;q=0.9')).toBe('en');
    expect(pickLang('de')).toBe('de');
    expect(pickLang('ja')).toBe('es');
    expect(pickLang(undefined)).toBe('es');
    expect(translate('Sesión cerrada.', 'fr')).toBe('Session fermée.');
  });

  it('responde errores y avisos en el idioma pedido', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'accept-language': 'en' }, payload: { email: 'nadie@test.dev', password: 'x' } });
    expect(JSON.parse(r.body).message).toBe('Incorrect email or password.');
    const v = await ctx.app.inject({ method: 'POST', url: '/api/auth/register', headers: { 'accept-language': 'pt-BR' }, payload: { name: 'A', email: 'no-es-correo', password: 'corta' } });
    const body = JSON.parse(v.body);
    expect(body.message).toBe('Verifique os dados do formulário.');
    expect(body.fields.map((f: { message: string }) => f.message)).toEqual(expect.arrayContaining(['E-mail inválido', 'Mínimo de 10 caracteres']));
    const u = await createUser(ctx);
    const out = await u.client.req('POST', '/api/auth/logout');
    expect(out.body.message).toBe('Sesión cerrada.');
  });
});
