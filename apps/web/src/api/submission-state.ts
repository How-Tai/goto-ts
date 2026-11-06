import type { QueryClient } from '@tanstack/react-query'
import type { SubmissionDetailSchema, SubmissionSchema } from '@otog/contract'

import { initialDataSuccess } from '../utils/initial-data-success'
import { submissionKey } from './query'
import { submissionTrackerFor } from './submission-tracker'

export { isSubmissionPending } from './submission-status'

export async function applyRejudgeResult(
  queryClient: QueryClient,
  original: SubmissionDetailSchema,
  queued: SubmissionSchema
) {
  const params = { submissionId: original.id.toString() }
  const detailKey = submissionKey.getSubmissionWithSourceCode({ params }).queryKey
  const summaryKey = submissionKey.getSubmission({ params }).queryKey
  // A request started before rejudging must not restore the previous verdict.
  await Promise.all([
    queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
    queryClient.cancelQueries({ queryKey: summaryKey, exact: true }),
  ])
  queryClient.setQueryData(detailKey, initialDataSuccess({ ...original, ...queued, submissionResult: null }))
  queryClient.setQueryData(summaryKey, initialDataSuccess({ ...queued, submissionResult: null }))
  submissionTrackerFor(queryClient)?.queue(original.id)
  // Refresh open lists, latest-submission panels and the live detail observers.
  await queryClient.invalidateQueries({ queryKey: submissionKey._def })
}
