import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Относительный base: сборка не зависит от имени репозитория или подпути
// (GitHub Pages, поддиректория, локальный preview) — ассеты резолвятся
// относительно самого index.html.
export default defineConfig({
  plugins: [react()],
  base: './',
})
