import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// API'et proxies i udvikling, så frontenden altid kan kalde relative /api-stier.
// De samme stier virker uændret, når backenden serverer den byggede frontend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.UBS_API_URL ?? "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
