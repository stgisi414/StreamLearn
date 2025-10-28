import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: 'localhost', // Standardize on localhost for consistency.
        // CRITICAL FIX: Vite Proxy to handle CORS and route to the local Functions emulator.
        proxy: {
            '/api': {
                // Target the Functions emulator directly.
                target: 'http://localhost:5001',
                // CRITICAL FIX: Rewrite the path to match the Firebase Functions emulator's expected format.
                // Example: /api/myFunction -> /streamlearnxyz/us-central1/myFunction
                rewrite: (path) => path.replace(/^\/api/, `/streamlearnxyz/us-central1`),
                changeOrigin: true,
                secure: false,
            }
        }
      },
      plugins: [react()],
      define: {
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      // Configure Rollup to treat Firebase packages as external
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
