import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

// Fase 14: en el navegador, Rapier sin "compat": el .wasm va en un archivo aparte (el compat lo mete en el JS en
// base64, 4,3 MB). Las pruebas (vitest, en Node) siguen con el compat, que no necesita el plugin. Las dos versiones
// están fijadas iguales en package.json (misma API). `src/physics/rapier.ts` llama a init() solo si existe.
const browser = !process.env.VITEST;

export default defineConfig({
  // Rutas relativas: la versión publicada vive en una subcarpeta
  // (https://falkwing-panzer.github.io/Crane-Game/) y así funciona en cualquier sitio.
  base: './',
  plugins: browser ? [wasm()] : [],
  resolve: browser ? { alias: { '@dimforge/rapier3d-compat': '@dimforge/rapier3d' } } : {},
  optimizeDeps: browser ? { exclude: ['@dimforge/rapier3d'] } : {},
  build: {
    target: 'es2022',
    // three.js y el juego van en un trozo de ~1 MB (270 kB comprimido): es lo esperado
    chunkSizeWarningLimit: 1200,
  },
});
