import { rename, unlink, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { getFsImplementation } from './fsOperations.js'

/**
 * Write a file atomically using write-to-temp + rename pattern.
 * On Windows, rename across devices can fail with EXDEV; we fall back
 * to copy + unlink in that case.
 */
export async function atomicWriteFile(
  filePath: string,
  data: string | Buffer,
  options?: { encoding?: BufferEncoding; mode?: number },
): Promise<void> {
  const dir = dirname(filePath)
  const tmpPath = `${filePath}.${process.pid}.tmp`
  const fs = getFsImplementation()

  try { fs.mkdirSync(dir) } catch { /* recursive */ }

  try {
    await writeFile(tmpPath, data, {
      encoding: options?.encoding ?? 'utf-8',
      mode: options?.mode,
    })
    try {
      await rename(tmpPath, filePath)
    } catch (renameErr) {
      const code = (renameErr as { code?: string })?.code
      if (code === 'EXDEV') {
        await fs.promises.copyFile(tmpPath, filePath)
        await unlink(tmpPath)
      } else { throw renameErr }
    }
  } catch (error) {
    try { await unlink(tmpPath) } catch { /* cleanup */ }
    throw error
  }
}

/**
 * Backup the existing file (if any) before writing.
 */
export async function backupAndWriteFile(
  filePath: string,
  data: string | Buffer,
  options?: { encoding?: BufferEncoding; mode?: number },
): Promise<void> {
  const fs = getFsImplementation()
  try {
    const stats = await fs.promises.stat(filePath)
    if (stats.size > 0) {
      await fs.promises.copyFile(filePath, `${filePath}.bak`)
    }
  } catch { /* no existing file */ }
  await atomicWriteFile(filePath, data, options)
}
