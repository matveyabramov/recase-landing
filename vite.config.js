import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Pages supplies its publication path; local/Layero builds stay portable.
  base: process.env.VITE_BASE_PATH || './',
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        privacy: fileURLToPath(new URL('./privacy-policy.html', import.meta.url)),
        consent: fileURLToPath(new URL('./personal-data-consent.html', import.meta.url)),
      },
    },
  },
});
