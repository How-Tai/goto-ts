import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Columns2Icon } from 'lucide-react'
import Head from 'next/head'
import NextLink from 'next/link'
import { useRouter } from 'next/router'
import ErrorPage from 'next/error'
import { useSession } from 'next-auth/react'
import dynamic from 'next/dynamic'
import type { ContestSchema, SubmissionDetailSchema } from '@otog/contract'
import type { Problem } from '@otog/database'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@otog/ui/breadcrumb'
import { Button } from '@otog/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@otog/ui/resizable'
import { Separator } from '@otog/ui/separator'
import { SidebarTrigger } from '@otog/ui/sidebar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@otog/ui/tabs'
import { Toggle } from '@otog/ui/toggle'
import { clsx } from '@otog/ui/utils'
import { submissionKey } from '../../../../api/query'
import { contestProblemPageOptions, problemRouteId } from '../../../../api/contest-problem-page'
import { getAccessToken } from '../../../../api/auth'
import { redirectToLogin } from '../../../../api/session-expiry'
import { ExampleTable } from '../../../../components/example-table'
import { Footer } from '../../../../components/footer'
import { ClientInPortal, ClientOutPortal, useHtmlPortalNode } from '../../../../components/portals'
import { ProblemStatement } from '../../../../components/problem-statement'
import { useContainerBreakpoint } from '../../../../hooks/use-container-breakpoint'
import { useProblemPageOverlap } from '../../../../hooks/use-problem-page-overlap'
import { ContestLayout, useContest } from '../../../../modules/contest/sidebar'

const CodeEditorForm = dynamic(() => import('../../../../modules/contest/problem-editor'), { ssr: false, loading: () => <p role="status">กำลังโหลดตัวแก้ไข...</p> })
const ContestSubmissionTable = dynamic(() => import('../../../../modules/contest/problem-submissions'), { ssr: false, loading: () => <p role="status">กำลังโหลดรายการส่ง...</p> })

interface ContestProblemPageProps {
  contestId: string
  contest: ContestSchema
  serverTime: string
  problem: Problem
  latestSubmission: SubmissionDetailSchema | null
}

// No server-side props: Next builds one generic HTML layout for this route.
// Contest access and all private contents remain guarded by the page API.
export default function ContestPage() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const contestId = problemRouteId(router.query.contestId)
  const problemId = problemRouteId(router.query.problemId)
  const viewerId = session?.user?.id ?? 0
  const invalidSession = (session as { error?: string } | null)?.error === 'RefreshAccessTokenError'
  const options = contestProblemPageOptions(contestId ?? '0', problemId ?? '0', viewerId)
  const { overlap, key: overlapKey } = useProblemPageOverlap()
  const page = useQuery({
    ...options,
    queryFn: async context => {
      const early = await overlap.take(overlapKey, session?.accessToken, getAccessToken)
      if (early?.status === 200) return early as Awaited<ReturnType<typeof options.queryFn>>
      // A failed early credential check uses the existing refresh/logout path.
      if (early && early.status !== 401) throw early
      return options.queryFn(context)
    },
    enabled: router.isReady && !!contestId && !!problemId && status === 'authenticated' && !invalidSession,
    // Preserve only the same viewer's same-contest frame during navigation.
    // The old problem and editor are hidden until the new request succeeds.
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey.at(-1) === viewerId
      && previous?.body.contest.id.toString() === contestId ? previous : undefined,
  })
  const failure = (page.error as { status?: number } | null)?.status
  useEffect(() => {
    if (status === 'unauthenticated' || invalidSession || failure === 401) void redirectToLogin()
  }, [status, invalidSession, failure])

  if (!router.isReady || status !== 'authenticated' || invalidSession) return <ProblemPageLoading />
  if (!contestId || !problemId || [400, 403, 404].includes(failure ?? 0)) return <ErrorPage statusCode={404} />
  if (page.isError) return <main id="content" className="container py-12" role="alert">
    <p className="mb-4">กรุณารอสักครู่แล้วลองใหม่</p>
    <Button onClick={() => { void page.refetch() }}>ลองใหม่</Button>
  </main>
  if (!page.data) return <ProblemPageLoading />
  const { contest, problem, latestSubmission, serverTime } = page.data.body
  const props = { contestId, contest, problem, latestSubmission, serverTime: serverTime.toString() }
  return <ContestLayout {...props}>
    {problem.id.toString() === problemId && !page.isPlaceholderData
      ? <ContestPageContent {...props} /> : <ProblemPageLoading inset />}
  </ContestLayout>
}

function ProblemPageLoading({ inset = false }: { inset?: boolean }) {
  return <div id={inset ? undefined : 'content'} role="status" aria-busy="true" className="container flex-1 py-12">
    <Head><title>OTOG</title></Head>
    <p>กำลังโหลดโจทย์...</p>
  </div>
}

function ContestPageContent(props: ContestProblemPageProps) {
  const router = useRouter()
  const { contest, contestStatus } = useContest()
  const { problem } = props

  useEffect(() => {
    if (contestStatus !== 'RUNNING') {
      router.push(`/contest/${props.contestId}`)
    }
  }, [contestStatus])

  return (
    <>
      <Head>
        <title>
          {problem.name} - {contest.name} | OTOG
        </title>
      </Head>
      <div className="flex items-center gap-2 p-4">
        <SidebarTrigger />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbLink
              className="font-heading text-lg font-semibold hidden md:block"
              asChild
            >
              <NextLink href={`/contest/${props.contestId}`}>
                {contest.name}
              </NextLink>
            </BreadcrumbLink>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage className="font-heading text-lg font-semibold">
                {problem.name}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <ContestProblemSection {...props} key={problem.id} />
      <Footer className="pt-8 px-4 max-w-full" />
    </>
  )
}
ContestPage.footer = false

const ContestProblemSection = (props: ContestProblemPageProps) => {
  type Tab = 'problem' | 'editor' | 'submissions'
  const [tab, setTab] = useState<Tab>('problem')
  const queryClient = useQueryClient()
  const { containerRef, isBreakpoint: isLargeScreen } =
    useContainerBreakpoint<HTMLDivElement>({
      breakpoint: 960,
    })

  const codeEditorPortal = useHtmlPortalNode()
  const [twoColumn, setTwoColumn] = useState(false)
  const [editorOpened, setEditorOpened] = useState(false)
  const showEditor = editorOpened || tab === 'editor' || twoColumn
  useEffect(() => {
    if (tab === 'editor' || twoColumn) setEditorOpened(true)
  }, [tab, twoColumn])
  useEffect(() => {
    if (!isLargeScreen) {
      setTwoColumn(false)
    }
  }, [isLargeScreen])
  return (
    <section className="flex-1 @container" ref={containerRef} data-contest-problem-ready={props.problem.id}>
      <div
        className={clsx(
          'flex-1 flex flex-col gap-4 px-4',
          !twoColumn && 'max-w-4xl mx-auto'
        )}
      >
        <Tabs value={tab} onValueChange={(tab) => setTab(tab as Tab)}>
          <div className="flex justify-between">
            <TabsList className="bg-transparent p-0">
              <TabsTrigger
                value="problem"
                className="data-[state=active]:bg-muted data-[state=active]:shadow-none"
              >
                Problem
              </TabsTrigger>
              <TabsTrigger
                value="editor"
                className={clsx(
                  'data-[state=active]:bg-muted data-[state=active]:shadow-none',
                  twoColumn && 'hidden'
                )}
              >
                Editor
              </TabsTrigger>
              <TabsTrigger
                value="submissions"
                className="data-[state=active]:bg-muted data-[state=active]:shadow-none"
              >
                Submissions
              </TabsTrigger>
            </TabsList>
            <Toggle
              className={clsx(!isLargeScreen && 'hidden')}
              pressed={twoColumn}
              onPressedChange={(value) => {
                setTwoColumn(value)
                if (value === true && tab === 'editor') {
                  setTab('problem')
                }
              }}
            >
              <Columns2Icon />
            </Toggle>
          </div>

          <TabsContent
            className="data-[state=inactive]:hidden"
            forceMount
            value="problem"
          >
            <ResizablePanelGroup
              direction="horizontal"
              className="w-full flex gap-2"
            >
              <ResizablePanel
                defaultSize={50}
                className={clsx(
                  'flex flex-col gap-2',
                  twoColumn && '!overflow-y-auto max-h-[800px]'
                )}
              >
                <ProblemStatement key={props.problem.id} problem={props.problem} />
                <ExampleTable problem={props.problem} />
              </ResizablePanel>
              {twoColumn && (
                <>
                  <ResizableHandle />
                  <ResizablePanel defaultSize={50}>
                    <ClientOutPortal node={codeEditorPortal} />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </TabsContent>

          <TabsContent
            className="data-[state=inactive]:hidden"
            forceMount
            value="editor"
          >
            {showEditor && <ClientInPortal node={codeEditorPortal}>
              <CodeEditorForm
                contestId={props.contest.id}
                problem={props.problem}
                latestSubmission={props.latestSubmission}
                onSuccess={() => {
                  queryClient.invalidateQueries({
                    queryKey: submissionKey.getContestSubmissions({
                      params: { contestId: props.contestId.toString() },
                    }).queryKey,
                  })
                  setTab('submissions')
                }}
              />
            </ClientInPortal>}
            {!twoColumn && <ClientOutPortal node={codeEditorPortal} />}
          </TabsContent>
          <TabsContent
            className="data-[state=inactive]:hidden"
            forceMount
            value="submissions"
          >
            {tab === 'submissions' && <ContestSubmissionTable
              contestId={props.contest.id}
              problemId={props.problem.id}
            />}
          </TabsContent>
        </Tabs>
      </div>
    </section>
  )
}

