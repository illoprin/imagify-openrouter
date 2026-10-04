import { defineConfig } from 'vite';

export default defineConfig({
  srcDir: "./src",
  build: {
    outDir: "./dist"
  },
  server: {
    host: "127.0.0.1",
    port: 8080
  },
})