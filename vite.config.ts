import { defineConfig } from 'vite'
import path from 'path'
import { writeFileSync, existsSync } from 'fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

// Generate index.html when it doesn't exist (needed for production / GitHub Pages builds).
// The Figma Make dev server uses __figma__entrypoint__.ts instead, so this only
// kicks in during `vite build`.
if (!existsSync('index.html')) {
  writeFileSync(
    'index.html',
    `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Willow Kitchen — real-time Kitchen Display System" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>Willow Kitchen — KDS</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  )
}


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  // Use relative asset paths so the app works on any GitHub Pages URL
  // (e.g. https://user.github.io/repo-name/ not just https://user.github.io/)
  base: './',

  plugins: [
    figmaAssetResolver(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
