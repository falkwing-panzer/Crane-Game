import { defineConfig } from 'vite';

// Rutas relativas: la versión publicada vive en una subcarpeta
// (https://falkwing-panzer.github.io/Crane-Game/) y así funciona en cualquier sitio.
export default defineConfig({
  base: './',
  build: {
    // El wasm de Rapier va dentro del JS (~5 MB sin comprimir): es lo esperado.
    chunkSizeWarningLimit: 6000,
  },
});
