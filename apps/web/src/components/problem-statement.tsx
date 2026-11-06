import { useState } from 'react'

import type { ProblemDetailSchema } from '@otog/contract'

import { problemDocumentUrl } from '../utils/problem-document'
import { ProblemDetail } from './problem-detail'
import { StatementLanguageSelect } from './statement-viewer'

export function ProblemStatement({
  problem,
}: {
  problem: ProblemDetailSchema
}) {
  const [language, setLanguage] = useState<'th' | 'en'>('th')
  return (
    <>
      <div className="mb-2">
        <StatementLanguageSelect value={language} onChange={setLanguage} />
      </div>
      <embed
        src={problemDocumentUrl(problem.id, language)}
        type="application/pdf"
        height="800px"
        className="w-full rounded-md border min-h-[800px]"
      />
      <ProblemDetail problem={problem} language={language} />
    </>
  )
}
