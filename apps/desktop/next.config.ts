import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const assetTarget=fileURLToPath(new URL('./public/assets/mediapipe',import.meta.url));
mkdirSync(assetTarget,{recursive:true});
cpSync(fileURLToPath(new URL('../vision/public/assets/mediapipe',import.meta.url)),assetTarget,{recursive:true});
const require = createRequire(import.meta.url);
// A browser worker must use the web export even during Next's server compilation.
const transformers = require.resolve('@huggingface/transformers', {
  paths: [dirname(require.resolve('kokoro-js'))],
});
const config: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@huggingface/transformers$': join(dirname(transformers), 'transformers.web.js'),
    };
    return config;
  },
};
export default config;
