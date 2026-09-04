import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Bind IPv4 as well as localhost. Default "localhost" can listen on ::1 only; Stripe
    // success_url uses 127.0.0.1 (see storefrontWebOrigin), which then gets ERR_CONNECTION_REFUSED.
    host: true,
    port: 5173,
    // cloudflared (`make tunnel`) always targets :5173. Do not silently move —
    // a leftover Vite on 5173 makes the tunnel serve a stale bundle.
    strictPort: true,
    // cloudflared quick tunnels use random *.trycloudflare.com Host headers; Vite blocks unknown hosts by default.
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  preview: {
    allowedHosts: [".trycloudflare.com"],
  },
});
