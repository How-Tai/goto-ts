import { useRef } from 'react'
import { submissionQuery } from '../api/query'
import { submissionRequestId } from '../api/submission-request'

export function useSubmissionUpload() {
  const mutation = submissionQuery.uploadFile.useMutation({})
  const attempt = useRef<{ signature: string; key: string }>()
  const mutateAsync = async (
    args: Parameters<typeof mutation.mutateAsync>[0],
    options?: Parameters<typeof mutation.mutateAsync>[1]
  ) => {
    const file = args.body instanceof FormData ? args.body.get('sourceCode') : args.body.sourceCode
    const language = args.body instanceof FormData ? args.body.get('language') : args.body.language
    if (!file || typeof file === 'string') throw new Error('A source file is required.')
    const source = String.fromCharCode(...new Uint8Array(await file.arrayBuffer()))
    const signature = JSON.stringify([args.params.problemId, args.query?.contestId ?? null, language, source])
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: submissionRequestId() }
    const current = attempt.current
    const response = await mutation.mutateAsync({ ...args, headers: { ...args.headers, 'idempotency-key': current.key } }, options)
    if (attempt.current === current) attempt.current = undefined
    return response
  }
  return { ...mutation, mutateAsync }
}
