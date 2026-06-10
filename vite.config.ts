import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // the Launch preview panel assigns a port via the PORT env var
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
});
