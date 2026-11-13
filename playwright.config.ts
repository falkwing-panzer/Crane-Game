import { defineConfig } from '@playwright/test';

// Pruebas en el navegador (fase 14): el juego compilado (`dist/`, igual que en GitHub Pages) servido con
// `vite preview`. Antes hay que compilar: `npm run e2e` lo hace todo. Los archivos se llaman *.e2e.ts para que vitest
// no los tome por pruebas suyas.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  // WebGL por software (SwiftShader) en la acción de GitHub: cada página tarda unos segundos
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://localhost:4173/',
    trace: process.env.CI ? 'retain-on-failure' : 'off',
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      // sin gráfica en la acción: WebGL por software, pedido de forma explícita (si no, Chrome avisa en la consola)
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
