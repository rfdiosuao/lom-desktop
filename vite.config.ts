import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  build: { target: 'safari16' },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
});
