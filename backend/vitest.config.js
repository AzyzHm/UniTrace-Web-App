import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 60000,
    hookTimeout: 60000,
    env: {
      MONGODB_URI: 'mongodb://127.0.0.1:27017/unitrace_test',
      LOG_LEVEL: 'silent',
    },
  },
});
