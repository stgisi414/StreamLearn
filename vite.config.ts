import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        // CRITICAL FIX: Vite Proxy to bypass CORS issues for Firebase Functions Emulator
        proxy: {
            '/api': {
                // The emulator port defined in firebase.json
                target: 'http://127.0.0.1:5001/streamlearnxyz/us-central1',
                // Rewrite /api/functionName to /functionName for the target
                rewrite: (path) => path.replace(/^\/api/, ''),
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
