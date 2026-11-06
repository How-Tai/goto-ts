import { useRef } from 'react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import { zodResolver } from '@hookform/resolvers/zod'
import dynamic from 'next/dynamic'
import { z } from 'zod'
import type { SubmissionDetailSchema } from '@otog/contract'
import type { Problem } from '@otog/database'
import { Button } from '@otog/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@otog/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@otog/ui/select'
import { Language, LanguageExtension, LanguageName } from '../../enums'
import { useSubmissionUpload } from '../../hooks/use-submission-upload'
import { useKeywordCheck } from '../problem/use-keyword-check'
import { SubmitCode } from '../problem/submit-code'
const MonacoEditor = dynamic(() => import('../../components/monaco-editor').then(module => module.MonacoEditor), { ssr: false })

const CodeEditorFormSchema = z.object({
  sourceCode: z.string(),
  language: z.nativeEnum(Language),
})
type CodeEditorFormSchema = z.infer<typeof CodeEditorFormSchema>

interface CodeEditorForm {
  problem: Problem
  contestId: number
  latestSubmission: SubmissionDetailSchema | null
  onSuccess: () => void
}
export default function CodeEditorForm(props: CodeEditorForm) {
  const formRef = useRef<HTMLFormElement>(null)
  const form = useForm<CodeEditorFormSchema>({
    defaultValues: { language: 'cpp' },
    resolver: zodResolver(CodeEditorFormSchema),
  })

  const keywords = useKeywordCheck()
  const uploadFile = useSubmissionUpload()
  const onSubmit = form.handleSubmit(async (values) => {
    keywords.reset()
    const toastId = toast.loading(`กำลังส่งข้อ ${props.problem.name}...`)
    const blob = new Blob([values.sourceCode])
    const file = new File([blob], `${props.problem.id}.${LanguageExtension[values.language]}`)
    await uploadFile.mutateAsync(
      {
        params: { problemId: props.problem.id.toString() },
        query: { contestId: props.contestId.toString() },
        body: {
          sourceCode: file,
          language: values.language,
        },
      },
      {
        onError: (result) => {
          if (!keywords.handleError(result, toastId)) {
            toast.error('ส่งไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', { id: toastId })
          }
        },
        onSuccess: () => {
          toast.success('ส่งสำเร็จแล้ว', { id: toastId })
          props.onSuccess?.()
        },
      }
    ).catch(() => { /* The mutation callbacks display the error and retain the draft. */ })
  }, console.error)

  return (
    <Form {...form}>
      <form
        ref={formRef}
        onSubmit={onSubmit}
        className="flex flex-col gap-4 h-[800px]"
      >
        {keywords.error}
        <FormField
          control={form.control}
          name="sourceCode"
          render={({ field }) => (
            <FormItem className="space-y-0">
              <FormLabel className="sr-only">โค้ด</FormLabel>
              <MonacoEditor
                height="744px"
                language={form.watch('language')}
                defaultValue={props.latestSubmission?.sourceCode}
                onChange={field.onChange}
              />
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-3">
          <FormField
            control={form.control}
            name="language"
            render={({ field }) => (
              <FormItem className="flex-1 space-y-0">
                <FormLabel className="sr-only">ภาษา</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger {...field}>
                      <SelectValue placeholder="เลือกภาษา" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {Object.entries(LanguageName).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                  <FormMessage />
                </Select>
              </FormItem>
            )}
          />
          <div className="col-start-3 flex gap-2">
            <Button className="flex-1" type="submit" disabled={form.formState.isSubmitting}>
              ส่ง
            </Button>
            <SubmitCode
              problem={props.problem}
              contestId={props.contestId}
              onSuccess={props.onSuccess}
            />
          </div>
        </div>
      </form>
    </Form>
  )
}

