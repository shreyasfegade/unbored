// Kept separate from vite.config.ts on purpose: vitest ships its own nested
// copy of vite, and pulling its types into the app's typecheck makes the two
// vite versions collide. Vitest picks this file up automatically.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
