import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig(({ isSsrBuild }) => ({
  resolve: { tsconfigPaths: true },
  build: {
    // The SSR bundle exports the React Router Express handler from server/app.ts.
    rollupOptions: isSsrBuild ? { input: "./server/app.ts" } : undefined,
  },
  plugins: [tailwindcss(), reactRouter()],
}));
