import { BadRequestException, NotFoundException } from '@nestjs/common'

import type { FileManager } from '../core/fileManager'

export type StatementLanguage = 'th' | 'en'

export function statementLanguage(value?: unknown): StatementLanguage {
  if (value === undefined || value === 'th') return 'th'
  if (value === 'en') return 'en'
  throw new BadRequestException('Statement language must be th or en.')
}

export function statementFiles(id: number | string) {
  return [`docs/${id}.th.pdf`, `docs/${id}.en.pdf`, `docs/${id}.pdf`]
}

export async function resolveProblemStatement(
  id: number | string,
  manager: FileManager,
  preferred: StatementLanguage = 'th'
) {
  const other = preferred === 'th' ? 'en' : 'th'
  for (const language of [preferred, other, undefined] as const) {
    const filePath = `docs/${id}${language ? `.${language}` : ''}.pdf`
    const metadata = await manager.getFileMetadata(filePath)
    if (metadata)
      return {
        ...metadata,
        // Validators belong to the selected representation, including fallback.
        etag: metadata.etag.replace('"', `"${language ?? 'legacy'}-`),
        filePath,
        language,
      }
  }
  throw new NotFoundException('Statement not found.')
}
