import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // fps-earth runs on 5280 by default (5173 is Vite's default and tends to
    // collide with other projects). The Launch preview panel can still override
    // the port via the PORT env var. If 5280 is ever busy too, Vite picks the
    // next free port automatically.
    port: process.env.PORT ? Number(process.env.PORT) : 5280,
  },
});
