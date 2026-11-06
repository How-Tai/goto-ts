import { environment } from '../env'

export const problemDocumentUrl = (problemId: number | string | undefined, language: 'th' | 'en' = 'th') =>
  `${environment.API_HOST}/problem/doc/${problemId}?lang=${language}`
