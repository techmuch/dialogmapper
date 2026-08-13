import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The build output lands directly in the Go package that embeds it, so
// `npm run build && go build` is the whole release pipeline.
//
// During `npm run dev`, API and WebSocket calls are proxied to a running
// `dialogmapper start`, which means the frontend gets hot reload against real
// data instead of a mock layer that drifts from the Go implementation.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../internal/web/dist",
    emptyOutDir: true,
    // Keep the chunk graph flat. The binary serves these from memory, so
    // splitting buys nothing and costs an extra round trip on first paint.
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:7373",
      // Uploaded images only. Never proxy /assets/ — that is where Vite serves
      // the app's own modules from, and forwarding it to Go breaks dev mode.
      "/media": "http://127.0.0.1:7373",
      "/ws": { target: "ws://127.0.0.1:7373", ws: true },
    },
  },
});
