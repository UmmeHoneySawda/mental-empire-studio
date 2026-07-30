import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { bundle } from '@remotion/bundler'

async function main(): Promise<void> {
  const rootDirectory = process.cwd()
  const entryPoint = resolve(rootDirectory, 'video-engine', 'remotion', 'entry.tsx')
  const publicDirectory = resolve(rootDirectory, 'public')
  const outputDirectory = resolve(
    process.env['VIDEO_ENGINE_REMOTION_BUNDLE_DIR'] ??
      resolve(rootDirectory, 'resources', 'video-engine', 'remotion-bundle'),
  )
  const serveUrl = await bundle({
    entryPoint,
    rootDir: rootDirectory,
    publicDir: existsSync(publicDirectory) ? publicDirectory : null,
    outDir: outputDirectory,
    enableCaching: true,
  })
  const indexPath = resolve(serveUrl, 'index.html')
  const metadata = await stat(indexPath)
  if (!metadata.isFile() || metadata.size < 1) {
    throw new Error('Remotion bundle completed without a usable index.html')
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        entryPoint,
        outputDirectory: serveUrl,
        indexBytes: metadata.size,
      },
      null,
      2,
    ),
  )
}

await main()
