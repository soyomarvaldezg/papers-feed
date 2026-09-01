// rollup.config.js
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { terser } from 'rollup-plugin-terser';

// Replaces the __DEV_BUILD__ flag consumed by the background script so debug
// helpers stay available in development and are dead-code eliminated in
// production builds (NODE_ENV=production npm run build)
const devFlag = () => ({
  name: 'dev-flag',
  transform(code) {
    const isDev = process.env.NODE_ENV !== 'production';
    return code.replace(/__DEV_BUILD__/g, String(isDev));
  }
});

export default [
  // Background script as ESM (module)
  {
    input: 'background.ts',
    output: {
      file: 'dist/background.bundle.js',
      format: 'es',
      sourcemap: true
    },
    plugins: [
      devFlag(),
      typescript(),
      resolve(),
      commonjs()
    ]
  },
  // Content script as IIFE (non-module)
  {
    input: 'content.ts',
    output: {
      file: 'dist/content-script.js',
      format: 'iife', // Immediately-invoked function expression - no imports needed
      sourcemap: true
    },
    plugins: [
      typescript(),
      resolve(),
      commonjs(),
      terser() // Minify for production (optional)
    ]
  },
  // Options script
  {
    input: 'options.ts',
    output: {
      file: 'dist/options.bundle.js',
      format: 'es',
      sourcemap: true
    },
    plugins: [
      typescript(),
      resolve(),
      commonjs()
    ]
  },
  // Popup script - converted to TypeScript
  {
    input: 'popup.ts',
    output: {
      file: 'dist/popup.bundle.js',
      format: 'es',
      sourcemap: true
    },
    plugins: [
      typescript(),
      resolve(),
      commonjs()
    ]
  }
];
