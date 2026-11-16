import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // A API só aceita (CORS) a origem definida em infra/config.json. Por padrão, http://localhost:3000.
  server: { port: 3000, strictPort: true },
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.js'], globals: true },
});
