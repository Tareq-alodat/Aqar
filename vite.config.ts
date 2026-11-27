import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The SSR build is React Router's default server build (build/server/index.js
// exports the ServerBuild); server/createServer.ts wraps it in the Express handler.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  build: {
    // MapLibre GL is ~1.2 MB (≈320 kB gzipped) in its own chunk, loaded only when the map renders.
    chunkSizeWarningLimit: 1300,
  },
  plugins: [tailwindcss(), reactRouter()],
});
