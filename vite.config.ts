import { defineConfig, type Plugin } from "vite";

/**
 * KaTeX ships every math font as woff2, woff and ttf. Every webview Tauri
 * targets picks woff2, so the other two formats are ~600 KB of dead weight.
 */
const dropLegacyMathFonts: Plugin = {
  name: "drop-legacy-math-fonts",
  generateBundle(_options, bundle) {
    for (const name of Object.keys(bundle)) {
      if (/KaTeX.*\.(ttf|woff)$/.test(name)) delete bundle[name];
    }
  },
};

export default defineConfig({
  clearScreen: false,
  plugins: [dropLegacyMathFonts],
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4000,
  },
});
