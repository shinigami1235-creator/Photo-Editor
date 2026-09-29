import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  // Rust build files change while the app compiles, so Vite must not watch them.
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  optimizeDeps: { exclude: ['onnxruntime-web', 'libraw-wasm', 'lcms-wasm', '@jsquash/webp'] },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
