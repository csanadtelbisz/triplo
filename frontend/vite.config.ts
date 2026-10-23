import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const climateData = (): Plugin => {
  const dataDir = fileURLToPath(new URL('../climate/data', import.meta.url))
  const script = fileURLToPath(new URL('../climate/scripts/build-json.py', import.meta.url))
  const output = fileURLToPath(new URL('../climate/src/generated/data.ts', import.meta.url))
  const isSource = (file: string) => file === script || (dirname(file) === dataDir && /\.(csv|json)$/.test(file))
  const generate = () => execFileSync('python3', ['-I', script, dataDir, output], { stdio: 'pipe' })
  return {
    name: 'triplo-climate-data',
    buildStart() {
      generate()
      this.addWatchFile(script)
      for (const file of readdirSync(dataDir)) if (isSource(join(dataDir, file))) this.addWatchFile(join(dataDir, file))
    },
    watchChange(file) {
      if (isSource(file)) generate()
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [climateData(), react()],
})
