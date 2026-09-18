import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// IMPORTANT: this base path must match your GitHub repo name so that
// GitHub Pages serves the built assets from the right sub-path, e.g.
// https://<your-username>.github.io/Familycirclecardgame/
//
// If you rename the repo, update the string below to match.
export default defineConfig({
  base: '/Familycirclecardgame/',
  plugins: [react()],
})