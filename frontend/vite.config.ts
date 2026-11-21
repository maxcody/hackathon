import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react()],
    base: mode === "production" ? "/static/react/" : "/",
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "^/(status|findings|files|products|components|bom-changes|sync|pipeline|master|health|openapi.json)": {
          target: env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8000",
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "../backend/app/static/react",
      emptyOutDir: true,
    },
  };
});
