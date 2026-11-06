import type { SubmissionDetailSchema, SubmissionProgressSchema } from '@otog/contract'
import { isSubmissionPending } from './submission-status'

export function pendingSubmissionUpdate(
  current: SubmissionDetailSchema,
  progress: SubmissionProgressSchema
): SubmissionDetailSchema | null {
  if (progress.id !== current.id) throw new Error('Submission status does not match the open submission.')
  if (!isSubmissionPending(progress)) return null
  // Rejudges must never bring back the preceding score or testcase verdicts.
  return { ...current, status: progress.status, submissionResult: null }
}
