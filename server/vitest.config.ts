import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // todas las pruebas comparten una base de datos de pruebas: se ejecutan en serie
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
