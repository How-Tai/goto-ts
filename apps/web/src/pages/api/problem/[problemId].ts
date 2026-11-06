import type { NextApiRequest, NextApiResponse } from 'next'

import { problemDocumentUrl } from '../../../utils/problem-document'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const problemId = req.query.problemId
  const language = req.query.lang
  if (language !== undefined && language !== 'th' && language !== 'en') return res.status(400).end()
  if (req.method === 'GET' && problemId && !Array.isArray(problemId)) {
    return res
      .status(307)
      .redirect(problemDocumentUrl(problemId, language))
  }
  return res.status(404).end()
}
