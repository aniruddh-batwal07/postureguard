import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../', '');

  const backendHost = env.HOST || '127.0.0.1';
  const backendPort = Number(env.BACKEND_PORT) || 4000;

  return {
    plugins: [react()],
    server: {
      host: env.HOST || '127.0.0.1',
      port: Number(env.WEB_PORT) || 5173,
      proxy: {
        '/api': `http://${backendHost}:${backendPort}`,
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./test/setup.js'],
    },
  };
});