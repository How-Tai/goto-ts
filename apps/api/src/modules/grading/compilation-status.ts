import { readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'

// Match the compiler's standard C/C++ eligibility without reading test data.
// Unknown metadata stays unknown in the dashboard instead of reporting zero.
export async function compilationProblemIds(root = 'source'): Promise<number[] | null> {
  try {
    const directories = await readdir(root, { withFileTypes: true })
    const candidates = directories.filter(entry => entry.isDirectory() && /^[0-9]+$/.test(entry.name)
      && Number.isSafeInteger(Number(entry.name)))
    const eligible = await Promise.all(candidates.map(async entry => {
      const files = await readdir(join(root, entry.name))
      return files.some(name => ['command.yaml', 'interactive_script.py'].includes(name)
        || ['.c', '.cpp', '.h', '.hpp', '.py'].includes(extname(name))) ? null : Number(entry.name)
    }))
    return eligible.filter((id): id is number => id !== null)
  } catch { return null }
}
