import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

function copyMinimalPublicAssets(): Plugin {
  return {
    name: 'ashoka-minimal-public-assets',
    closeBundle() {
      const rootDir = __dirname;
      const publicDir = path.join(rootDir, 'public');
      const distDir = path.join(rootDir, 'dist');
      if (!fs.existsSync(distDir)) return;

      const copyIfExists = (relPath: string) => {
        const src = path.join(publicDir, relPath);
        const dst = path.join(distDir, relPath);
        if (fs.existsSync(src) && fs.statSync(src).isFile()) {
          fs.mkdirSync(path.dirname(dst), {recursive: true});
          fs.copyFileSync(src, dst);
        }
      };

      copyIfExists('manifest.json');
      copyIfExists('sw.js');
      copyIfExists('assets/ashoka-icon.svg');
      copyIfExists('assets/ashoka-icon.ico');

      const videosDir = path.join(publicDir, 'videos');
      if (fs.existsSync(videosDir)) {
        for (const f of fs.readdirSync(videosDir)) {
          if (f.toLowerCase().endsWith('.mp4')) {
            copyIfExists(path.join('videos', f));
          }
        }
      }
    },
  };
}

export default defineConfig(({command}) => {
  const isBuild = command === 'build';
  return {
    publicDir: isBuild ? false : 'public',
    plugins: [
      react(),
      tailwindcss(),
      ...(isBuild ? [copyMinimalPublicAssets()] : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
