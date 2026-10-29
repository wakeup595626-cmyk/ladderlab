#!/usr/bin/env node

import { gzipSync } from 'node:zlib'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const jsonOutput = args.includes('--json')
const distArg = args.find((arg) => arg !== '--json')
const assetsDir = path.resolve(repoRoot, distArg ?? 'dist/assets')

const formatKiB = (bytes) => (bytes / 1024).toFixed(2)
const formatPercent = (bytes, total) =>
  total === 0 ? '0.00%' : `${((bytes / total) * 100).toFixed(2)}%`

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolutePath)))
    } else if (entry.isFile()) {
      files.push(absolutePath)
    }
  }

  return files
}

let hasAssetsDirectory = true
try {
  const assetsStat = await stat(assetsDir)
  hasAssetsDirectory = assetsStat.isDirectory()
  if (!hasAssetsDirectory) {
    throw new Error(`${assetsDir} is not a directory`)
  }
} catch (error) {
  hasAssetsDirectory = false
  console.error(`Cannot read build assets at ${assetsDir}`)
  console.error(error instanceof Error ? error.message : String(error))
  console.error('Run "npm run build" first, or pass another dist directory.')
  process.exitCode = 1
}

if (hasAssetsDirectory) {
  const absoluteFiles = await collectFiles(assetsDir)
  const files = await Promise.all(
    absoluteFiles.map(async (absolutePath) => {
      const contents = await readFile(absolutePath)
      return {
        file: path.relative(assetsDir, absolutePath).split(path.sep).join('/'),
        rawBytes: contents.byteLength,
        gzipBytes: gzipSync(contents).byteLength,
      }
    }),
  )

  files.sort(
    (left, right) =>
      right.rawBytes - left.rawBytes ||
      (left.file < right.file ? -1 : left.file > right.file ? 1 : 0),
  )

  const totals = files.reduce(
    (sum, file) => ({
      rawBytes: sum.rawBytes + file.rawBytes,
      gzipBytes: sum.gzipBytes + file.gzipBytes,
    }),
    { rawBytes: 0, gzipBytes: 0 },
  )

  const report = {
    assetsDir: path.relative(repoRoot, assetsDir).split(path.sep).join('/'),
    fileCount: files.length,
    files: files.map((file) => ({
      ...file,
      rawShare: formatPercent(file.rawBytes, totals.rawBytes),
    })),
    totals,
  }

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`Bundle report: ${report.assetsDir} (${files.length} files)`)
    console.log('File | Raw KiB | Gzip KiB | Raw share')
    console.log('--- | ---: | ---: | ---:')
    for (const file of files) {
      console.log(
        `${file.file} | ${formatKiB(file.rawBytes)} | ` +
          `${formatKiB(file.gzipBytes)} | ` +
          formatPercent(file.rawBytes, totals.rawBytes),
      )
    }
    console.log(
      `Total: ${totals.rawBytes} B raw (${formatKiB(totals.rawBytes)} KiB), ` +
        `${totals.gzipBytes} B gzip (${formatKiB(totals.gzipBytes)} KiB)`,
    )
  }
}
