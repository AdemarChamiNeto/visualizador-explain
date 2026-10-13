/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  // em desenvolvimento a API roda à parte (npm run dev no backend, porta 3003)
  server: { port: 5175, proxy: { "/api": "http://localhost:3003" } },
  test: { environment: "jsdom" },
});
