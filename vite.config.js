import { defineConfig } from 'vite';

export default defineConfig({
  // Pages supplies its publication path; local/Beget builds stay portable.
  base: process.env.VITE_BASE_PATH || './',
});
