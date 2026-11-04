import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Em desenvolvimento, /api é encaminhado ao backend (mesma origem = cookie de sessão funciona)
    proxy: { '/api': { target: process.env.VITE_PROXY_API ?? 'http://localhost:3333', changeOrigin: true } },
  },
});
