/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "chrome110",
    outDir: "dist",
  },
  test: {
    // The suite covers the pure decision-making modules under `src/lib` — the
    // ones a browser bug hides in. Anything needing a DOM belongs in the app.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
