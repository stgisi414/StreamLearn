import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      // ADDITION: Configure Rollup to treat Firebase packages as external
      // to resolve the "failed to resolve import" error.
      build: {
        rollupOptions: {
          external: [
            'firebase/app',
            'firebase/auth',
            'firebase/firestore',
            'firebase/functions'
          ],
        },
      },
    };
});