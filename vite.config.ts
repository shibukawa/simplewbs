import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` で起動するときは、別ターミナルで `npx wrangler dev` を動かしておく
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8787",
      "/auth": "http://localhost:8787",
    },
  },
});
