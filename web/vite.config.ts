import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/pool/",
  plugins: [react()],
  server: { proxy: { "/pool/api": "http://127.0.0.1:8317" } },
});
