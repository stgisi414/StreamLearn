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
        'process.env.VITE_GEMINI_API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY),
        'process.env.VITE_BRIGHTDATA_CUSTOMER_ID': JSON.stringify(env.VITE_BRIGHTDATA_CUSTOMER_ID),
        'process.env.VITE_BRIGHTDATA_ZONE_NAME': JSON.stringify(env.VITE_BRIGHTDATA_ZONE_NAME),
        'process.env.VITE_BRIGHTDATA_API_TOKEN': JSON.stringify(env.VITE_BRIGHTDATA_API_TOKEN)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
