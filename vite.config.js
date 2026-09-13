import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        cliente: resolve(__dirname, 'cliente.html'),
        admin: resolve(__dirname, 'admin.html')
      }
    }
  }
});