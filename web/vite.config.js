import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../', '');

  return {
    plugins: [react()],
    server: {
      host: env.HOST || '127.0.0.1',
      port: Number(env.WEB_PORT) || 5173,
    },
  };
});