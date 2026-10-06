import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * One Vite config serves both the interactive preview (`mvs dev`) and the
 * headless renderer (`mvs still` / `mvs render`), so preview and export run
 * exactly the same code. The CLI adds its frame-sink middleware on top.
 */
export default defineConfig({
  root,
  clearScreen: false,
  resolve: {
    alias: { '@mvs/engine': fileURLToPath(new URL('./engine/index.ts', import.meta.url)) },
  },
  define: {
    __MVS_DEFAULT_PROJECT__: JSON.stringify(process.env.MVS_PROJECT ?? ''),
  },
  server: {
    port: Number(process.env.MVS_PORT ?? 5173),
    strictPort: false,
    watch: { ignored: ['**/out/**', '**/build/frames/**', '**/.cache/**'] },
  },
  optimizeDeps: {
    include: ['lucide'],
    entries: ['index.html'],
  },
})
