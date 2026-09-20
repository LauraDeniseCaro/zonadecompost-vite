import { defineConfig } from 'vite';
import { resolve } from 'path';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'img/*.png', 'img/*.jpg'],
      manifest: {
        name: 'Zona de Compost',
        short_name: 'ZonaDeCompost',
        description: 'Gestión y recolección comunitaria de orgánicos',
        theme_color: '#16a34a',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: '/img/logo.png', // Verificá que exista esta imagen en tu carpeta public/img/
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/img/logo.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
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