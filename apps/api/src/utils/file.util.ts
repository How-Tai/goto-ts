import * as fs from 'fs'
import * as fsExtra from 'fs-extra'
import { readFile } from 'fs/promises'
import { mkdir, rename, rm, statfs } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { BadRequestException, ConflictException } from '@nestjs/common'
import * as mime from 'mime-types'
import * as path from 'path'
import { FileManager } from 'src/core/fileManager'
import * as unzipper from 'unzipper'

import { statementFiles, StatementLanguage } from './problem-statement'
import { setProblemPdfTitle } from './pdf-title.util'

export const DOC_DIR = 'docs'
export const TESTCASE_DIR = 'source'
export const UPLOAD_DIR = 'volumes/upload'
const activeArchives = new Set<string>()
// Reserve each upload's expansion allowance until its staging cleanup finishes.
let reservedArchiveBytes = 0

export async function updateProblemDoc(
  problemName: string,
  pdfFullPath: string,
  fileManager: FileManager,
  language?: StatementLanguage
) {
  // Validate and normalize before replacing an existing statement.
  const buffer = await setProblemPdfTitle(await readFile(pdfFullPath), problemName)
  await fileManager.createDirIfNotExist(DOC_DIR)
  const uploadDocPath = path.join(DOC_DIR, `${problemName}${language ? `.${language}` : ''}.pdf`)

  // save pdf file
  await fileManager.putFile(uploadDocPath, buffer, {
    ContentType: 'application/pdf',
  })

  // remove pdf file
  await fsExtra.remove(pdfFullPath)
}

export async function updateProblemTestCase(
  problemName: string,
  zipFullPath: string,
  fileManager: FileManager
) {
  if (!/^[1-9][0-9]*$/.test(problemName)) throw new BadRequestException('Invalid problem ID.')
  if (activeArchives.has(problemName)) throw new ConflictException('A testcase upload for this problem is already in progress.')
  activeArchives.add(problemName)
  const base = path.resolve(TESTCASE_DIR)
  let stage: string | undefined
  let old: string | undefined
  let reserved = 0
  const target = path.join(base, problemName)
  try {
    await mkdir(base, { recursive: true })
    const disk = await statfs(base)
    const available = disk.bavail * disk.bsize
    const budget = Math.min(4 * 1024 ** 3, available - reservedArchiveBytes - 2 * 1024 ** 3)
    if (budget <= 0) throw new BadRequestException('Not enough disk space for a safe testcase upload.')
    reserved = budget
    reservedArchiveBytes += reserved
    // The production service forbids explicitly setting setgid bits. mkdir
    // inherits the shared parent's group/setgid flag without a chmod syscall.
    const candidate = path.join(base, `.upload-${randomUUID()}`)
    await mkdir(candidate, { mode: 0o770 })
    stage = candidate
    let count = 0, expanded = 0
    const entries = fs.createReadStream(zipFullPath).pipe(unzipper.Parse({ forceStream: true }))
    for await (const entry of entries) {
      if (++count > 10000) throw new BadRequestException('Too many archive entries.')
      const name = String(entry.path).replace(/\\/g, '/')
      const parts = name.split('/')
      if (!name || name.includes('\0') || name.startsWith('/') || /^[a-z]:/i.test(name) ||
          parts.includes('..') || Buffer.byteLength(name) > 512) throw new BadRequestException('Unsafe archive path.')
      const destination = path.resolve(stage, name)
      if (!destination.startsWith(stage + path.sep)) throw new BadRequestException('Unsafe archive path.')
      if (entry.type === 'Directory') {
        // The ZIP header can claim zero bytes even when the entry has a payload.
        await pipeline(entry, new Writable({
          write(_chunk, _encoding, callback) {
            callback(new BadRequestException('Archive directory entries must be empty.'))
          },
        }))
        await mkdir(destination, { recursive: true })
        continue
      }
      await mkdir(path.dirname(destination), { recursive: true })
      let fileBytes = 0
      const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        expanded += chunk.length; fileBytes += chunk.length
        callback(expanded > budget || fileBytes > 512 * 1024 ** 2 ? new BadRequestException('Expanded archive is too large.') : null, chunk)
      } })
      await pipeline(entry, limit, fs.createWriteStream(destination, { flags: 'wx', mode: 0o660 }))
    }
    if (count === 0) throw new BadRequestException('The archive is empty.')
    old = stage + '-previous'
    try { await rename(target, old) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; old = undefined }
    try { await rename(stage, target); stage = undefined } catch (error) {
      if (old) { await rename(old, target); old = undefined }
      throw error
    }
    if (old) await rm(old, { recursive: true, force: true })
  } finally {
    try {
      if (stage) await rm(stage, { recursive: true, force: true })
    } finally {
      try {
        await rm(zipFullPath, { force: true })
      } finally {
        reservedArchiveBytes -= reserved
        activeArchives.delete(problemName)
      }
    }
  }
}

export async function removeProblemSource(
  problemName: string,
  fileManager: FileManager
) {
  const testCasePath = path.join(TESTCASE_DIR, problemName)

  for (const file of statementFiles(problemName)) await fileManager.removeDirIfExist(file)
  await fileManager.removeDirIfExist(testCasePath)
}

export async function getProblemDocStream(
  problemName: string,
  fileManager: FileManager
) {
  const docDir = path.join(DOC_DIR, `${problemName}.pdf`)
  if (!(await fileManager.isExists(docDir))) return null
  return await fileManager.getFileReadStream(docDir)
}
