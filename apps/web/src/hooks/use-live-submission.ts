import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SubmissionDetailSchema } from '@otog/contract'

import { submissionKey } from '../api/query'
import { isSubmissionPending } from '../api/submission-state'
import { pendingSubmissionUpdate } from '../api/live-submission'
import { initialDataSuccess } from '../utils/initial-data-success'
import { useEffect, useRef } from 'react'
import { useSubmissionProgress } from '../context/submission-updates-context'

export function useLiveSubmission(
  submissionId: number | undefined,
  initialSubmission?: SubmissionDetailSchema,
  enabled = true
) {
  const queryClient = useQueryClient()
  const params = { submissionId: submissionId?.toString()! }
  const detail = submissionKey.getSubmissionWithSourceCode({ params })
  const progress = useSubmissionProgress(submissionId, initialSubmission?.status, enabled)
  const previous = useRef<typeof progress>()
  useEffect(() => {
    if (!progress) return
    previous.current = progress
    if (isSubmissionPending(progress)) {
      queryClient.setQueryData(detail.queryKey, (current: any) => current?.status === 200
        ? { ...current, body: pendingSubmissionUpdate(current.body, progress) } : current)
    } else {
      void queryClient.invalidateQueries({ queryKey: detail.queryKey, exact: true })
    }
  }, [progress, queryClient, submissionId])
  const result = useQuery({
    ...detail,
    queryFn: async context => {
      const response = await detail.queryFn(context)
      const latest = previous.current
      if (response.status === 200 && latest && isSubmissionPending(latest)) {
        return { ...response, body: pendingSubmissionUpdate(response.body, latest)! }
      }
      return response
    },
    staleTime: 2000,
    initialData: initialSubmission ? initialDataSuccess(initialSubmission) : undefined,
    enabled: !!submissionId && enabled,
  })
  if (progress && isSubmissionPending(progress) && result.data?.status === 200) {
    return { ...result, data: { ...result.data, body: pendingSubmissionUpdate(result.data.body, progress)! } }
  }
  return result
}
