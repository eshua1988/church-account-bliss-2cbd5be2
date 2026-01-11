import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
<<<<<<< HEAD
export default defineConfig(({ mode }) => ({
  base: '/',
=======
const base = process.env.VITE_BASE_URL ?? './';

export default defineConfig(({ mode }) => ({
  base,
>>>>>>> fd9e39d (fix: sidebar no longer overlaps main content)
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
