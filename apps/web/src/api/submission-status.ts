import type { SubmissionSchema } from '@otog/contract'

export const isSubmissionPending = (submission: Pick<SubmissionSchema, 'status'>) =>
  submission.status === 'waiting' || submission.status === 'grading'
