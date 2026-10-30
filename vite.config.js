import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// base relativa: el build funciona en cualquier hosting estático o subcarpeta.
// Las páginas de cuenta y administración llaman a /api, que sirve el backend de server/.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        entrar: resolve(import.meta.dirname, 'entrar/index.html'),
        cuenta: resolve(import.meta.dirname, 'cuenta/index.html'),
        admin: resolve(import.meta.dirname, 'admin/index.html'),
      },
    },
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
  preview: {
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
});
