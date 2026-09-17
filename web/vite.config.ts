import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // respeita a porta atribuída pelo ambiente (ex.: preview do Claude), senão 5173
    port: Number(process.env.PORT) || 5173,
  },
})
