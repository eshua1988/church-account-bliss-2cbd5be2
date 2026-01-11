const { defineConfig } = require('vite');
const react = require('@vitejs/plugin-react-swc');
const path = require('path');
const { componentTagger } = require('lovable-tagger');

const base = process.env.VITE_BASE_URL ?? './';

module.exports = defineConfig(({ mode }) => ({
  base,
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
