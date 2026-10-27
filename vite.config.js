import { defineConfig } from 'vite';

// base relativa: el build funciona en cualquier hosting estático o subcarpeta
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
  },
});
