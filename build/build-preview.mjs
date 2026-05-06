// Bundles the preview-side webview script and the extension entry.
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const previewOpts = {
  entryPoints: ['src/preview/index.ts'],
  bundle: true,
  outfile: 'out/preview/index.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info'
};

/** @type {import('esbuild').BuildOptions} */
const extensionOpts = {
  entryPoints: ['src/extension/index.ts'],
  bundle: true,
  outfile: 'out/extension/index.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: true,
  minify: !watch,
  logLevel: 'info'
};

if (watch) {
  const previewCtx = await esbuild.context(previewOpts);
  const extensionCtx = await esbuild.context(extensionOpts);
  await Promise.all([previewCtx.watch(), extensionCtx.watch()]);
} else {
  await Promise.all([esbuild.build(previewOpts), esbuild.build(extensionOpts)]);
}

