import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Temporary. Deleted in Task 9 once Next owns the build.
export default defineConfig({
  plugins: [react()],
})
