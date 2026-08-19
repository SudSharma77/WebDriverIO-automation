import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API = process.env.VITE_API_ORIGIN ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxying keeps the browser same-origin, so SSE needs no CORS dance and
      // the app ships as static files behind any reverse proxy unchanged.
      "/api": { target: API, changeOrigin: true },
      "/health": { target: API, changeOrigin: true },
    },
  },
});
