import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
const basePath = process.env.VITE_BASE_PATH || '/';

export default defineConfig(({ mode }) => ({
  base: basePath,
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(), 
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'Kosciol.ico.png', 'robots.txt'],
      // Safari reads the manifest before React mounts. index.html selects it synchronously.
      manifest: false, /* {
        name: 'Церковный учет',
        short_name: 'Учет',
        description: 'Система финансового учета церкви',
        theme_color: '#3b82f6',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: basePath,
        start_url: `${basePath}?source=pwa`,
        icons: [
          {
            src: `${basePath}Kosciol.ico.png`.replace('//', '/'),
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: `${basePath}Kosciol.ico.png`.replace('//', '/'),
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: `${basePath}Kosciol.ico.png`.replace('//', '/'),
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }, */
      workbox: {
        importScripts: ['push-sw.js'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB (default 2 MB, exceeded by Roboto base64 bundle)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,ttf}'],
        runtimeCaching: [
          {
            // The app shell is already precached at build time. This keeps
            // other same-origin assets (for example files loaded after an app
            // update) available without a new download on every visit.
            urlPattern: ({ url, request }) => request.method === 'GET' && url.origin === self.location.origin,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'church-app-runtime-assets',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
