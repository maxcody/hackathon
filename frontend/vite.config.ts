import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react()],
    base: "/static/react/",
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: Object.fromEntries(
        ["/api", "/import", "/notifications", "/readiness", "/inbox"].map((path) => [
          path,
          env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8000",
        ]),
      ),
    },
    build: {
      outDir: "../backend/app/static/react",
      emptyOutDir: true,
    },
  };
});
