import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The offline Docker stack publishes its services through one HTTP port.
// Keep the browser on Vite's origin so cookies and CSRF checks still work.
const backend = process.env.GAMEHUB_DEV_BACKEND || 'http://127.0.0.1:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': backend,
      '/socket.io': { target: backend, ws: true },
      '/arena/socket.io': { target: backend, ws: true },
      '/play': backend,
    },
  },
});
