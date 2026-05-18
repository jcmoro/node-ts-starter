import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    fs: {
      // Allow Vite to import files from the parent directory (docs/)
      allow: ['..'],
    },
  },
});
