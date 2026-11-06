import { ReactNode, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import NextLink from 'next/link'
import Head from 'next/head'
import { Button } from '@otog/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@otog/ui/tabs'
import { client } from '../../api/browser'
import { withSession } from '../../api/server'
import { ResourceReadings, ResourceFreshness } from '../../components/grading/resource-readings'
import { historySegments, historyTime } from '../../components/grading/chart-data'
import { mergeResourceHistory } from '../../components/grading/resource-history'

type Worker = {
  id: number; enabled: boolean; connected: boolean; cpuId: number | null;
  startedAt: string | null; lastHeartbeat: string | null;
  submissionId: number | null; claimedAt: string | null;
  userId: number | null; problemId: number | null; problemName: string | null;
}
type QueueJob = { id: number; userId: number; problemId: number; problemName: string;
  language: string; queuedAt: string; waitingForUser: boolean; stage?: 'compile' | 'ready' | 'direct' | 'unknown' }
type Compilation = { waiting: number | null; compiling: number; ready: number; directWaiting: number | null;
  pausedForGraders: boolean; slots: Worker[] }
type Service = { name: string; state: string; uptimeSeconds: number | null;
  threads: number | null; memoryMb: number | null; virtualMb: number | null;
  cpuPercent: number | null; autoRestart: string; restarts: number | null;
  sampledAt?: string; cpuIntervalSeconds?: number | null }
type Point = { at: string; cpuUser: number | null; cpuSystem: number | null;
  cpuWait: number | null; memoryUsedMb: number; memoryCacheMb: number;
  memoryBuffersMb: number; memoryFreeMb?: number; swapUsedMb: number;
  cpuIdle?: number | null; cpuSteal?: number | null; monotonicSeconds?: number;
  cpuSampleIntervalSeconds?: number | null }
type Telemetry = { observedAt: string; machine: { name: string; cpuCount: number;
  uptimeSeconds: number; memoryTotalMb: number; memoryAvailableMb: number;
  swapTotalMb: number; diskTotalGb: number; diskFreeGb: number };
  history: Point[]; historyReset?: boolean; services: Service[]; warnings: string[] }
type Status = { observedAt: string; waiting: number; grading: number; queueLimit: number; maxWorkersPerUser: number; memoryReservationsEnabled: boolean; maxCompilerJobs: number;
  graderAllocation?: { count: number; revision: number; appliedRevision: number };
  cpuAllocation?: { observedAt: string; serviceCpus: number[]; drainingWorkers: number[]; error: string | null } | null;
  queue: QueueJob[]; workers: Worker[]; compilation?: Compilation; telemetry: Telemetry | null; resourceStatus: ResourceFreshness }

export const getServerSideProps = withSession(async ({ session }) => {
  if (session?.user.role !== 'admin') return { notFound: true }
  return { props: {} }
})

const number = (n: number | null | undefined, digits = 1) =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: digits })
const duration = (seconds: number | null) => {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`
}
const age = (since: string | null, now: string) => since ? duration((Date.parse(now) - Date.parse(since)) / 1000) : '—'
const stamp = (s: string) => new Date(s).toLocaleTimeString()
// Current dedicated compiler deployment: each job reserves 384 MiB + 128 MiB overhead.
const compilationReservationMiB = 512

export default function GradingPage() {
  const [limitDraft, setLimitDraft] = useState<number | null>(null)
  const workerActions = useRef(new Set<number>())
  const [pendingWorkers, setPendingWorkers] = useState<Record<number, 'control' | 'kill'>>({})
  const beginWorkerAction = (id: number, action: 'control' | 'kill') => {
    if (workerActions.current.has(id)) return false
    workerActions.current.add(id)
    setPendingWorkers(previous => ({ ...previous, [id]: action }))
    return true
  }
  const finishWorkerAction = (id: number) => {
    workerActions.current.delete(id)
    setPendingWorkers(previous => {
      const next = { ...previous }
      delete next[id]
      return next
    })
  }
  const queryClient = useQueryClient()
  const status = useQuery({ queryKey: ['admin-grading'],
    queryFn: async ({ signal }) => {
      const started = performance.now()
      const previous = queryClient.getQueryData<Status>(['admin-grading'])
      const cursor = previous?.telemetry?.history.at(-1)?.monotonicSeconds
      const url = '/admin/grading' + (typeof cursor === 'number' && Number.isFinite(cursor) ? `?after=${cursor}` : '')
      const snapshot = await client.options({ signal }).get(url).json<Status>()
      if (snapshot.telemetry) snapshot.telemetry = mergeResourceHistory(previous?.telemetry, snapshot.telemetry)
      const receivedAt = performance.now()
      return { ...snapshot, receivedAt, requestDurationMs: receivedAt-started }
    },
    staleTime: 500, refetchInterval: (query) => query.state.status === 'error' ? 15000 : 1000,
    refetchIntervalInBackground: false, retry: 1,
  })
  const control = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      client.patch({ enabled }, `/admin/grading/workers/${id}`).json(),
    onSuccess: async (_response, { id, enabled }) => {
      await queryClient.invalidateQueries({ queryKey: ['admin-grading'] })
      toast.success(enabled ? `Worker ${id} resumed` : `Worker ${id} will pause after its current submission`)
    },
    onError: (_error, { id }) => toast.error(`Could not change worker ${id}. Refresh and try again.`),
    onSettled: (_response, _error, { id }) => { finishWorkerAction(id) },
  })
  const settings = useMutation({
    mutationFn: (maxWorkersPerUser: number) => client.patch({ maxWorkersPerUser }, '/admin/grading/settings').json(),
    onSuccess: async () => {
      setLimitDraft(null)
      await queryClient.invalidateQueries({ queryKey: ['admin-grading'] })
      toast.success('Workers per user updated')
    },
    onError: () => toast.error('Could not save the limit. Refresh and try again.'),
  })
  const workerCount = useMutation({
    mutationFn: (count: number) => client.patch({ count }, '/admin/grading/worker-count').json(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-grading'] })
      toast.success('Grader allocation requested. Current submissions will finish.')
    },
    onError: () => toast.error('Could not change the grader count. Refresh and try again.'),
  })
  const compilerJobs = useMutation({
    mutationFn: (maxCompilerJobs: number) => client.patch({ maxCompilerJobs }, '/admin/grading/compiler-jobs').json(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-grading'] })
      toast.success('Compiler job limit updated')
    },
    onError: () => toast.error('Could not update compiler jobs. Refresh and try again.'),
  })
  const memoryReservations = useMutation({
    mutationFn: (enabled: boolean) => client.patch({ enabled }, '/admin/grading/memory-reservations').json(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-grading'] })
      toast.success('Memory reservation setting updated')
    },
    onError: () => toast.error('Could not update memory reservations. Refresh and try again.'),
  })
  const kill = useMutation({
    mutationFn: (worker: Worker) => client.post({ confirmed: true,
      startedAt: worker.startedAt, submissionId: worker.submissionId },
      `/admin/grading/workers/${worker.id}/kill`).json(),
    onSuccess: async (_response, worker) => {
      await queryClient.invalidateQueries({ queryKey: ['admin-grading'] })
      toast.success(`Worker ${worker.id} restarted. Its unfinished submission will return to the queue.`)
    },
    onError: (error: { status?: number }, worker) => toast.error(error.status === 409
      ? `Worker ${worker.id} or its job changed. Refresh and try again.`
      : `Could not verify worker ${worker.id} restart. Refresh its status before retrying.`),
    onSettled: (_response, _error, worker) => {
      finishWorkerAction(worker.id)
      void queryClient.invalidateQueries({ queryKey: ['admin-grading'] })
    },
  })
  const data = status.data
  const allocation = data?.graderAllocation
  const allocationPending = !!allocation && allocation.revision !== allocation.appliedRevision
  const allocationFresh = !!data?.cpuAllocation && Date.now()-Date.parse(data.cpuAllocation.observedAt)<10000
  const selectedCount = allocation?.count ?? data?.workers.filter(w => w.enabled).length ?? 6
  const drainingWorkers = allocationFresh ? data?.cpuAllocation?.drainingWorkers ?? [] : []
  const visibleWorkers = data?.workers.filter(w => w.id <= selectedCount || w.submissionId != null || drainingWorkers.includes(w.id)) ?? []
  const dedicatedCompiler = !!data?.compilation?.slots.length
  const telemetry = data?.telemetry
  const last = telemetry?.history.at(-1)
  return <main className="container flex-1 py-8 space-y-6">
    <Head><title>Grading status · OTOG</title></Head>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-sm text-muted-foreground mb-1">OTOG administration</p>
        <h1 className="text-2xl font-semibold font-heading">Grading status</h1>
        <p className="text-sm text-muted-foreground mt-2">Submission queues, grading workers and Linux VM resources. Refreshes every second while this page is visible.</p>
      </div>
      <Button variant="outline" disabled={status.isFetching} onClick={() => void status.refetch()}>Refresh</Button>
    </div>
    <Tabs value="grading">
      <TabsList aria-label="Administration" className="justify-start relative h-auto w-full gap-0.5 bg-transparent p-0 before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-border">
        {[['problem','/admin','โจทย์'],['contest','/admin/contest','แข่งขัน'],['user','/admin/user','ผู้ใช้งาน'],['grading','/admin/grading','Grading status']].map(([value,href,label]) =>
          <TabsTrigger key={value} value={value!} className="overflow-hidden rounded-b-none border-x border-t border-border bg-muted py-2 data-[state=active]:z-10 data-[state=active]:shadow-none" asChild>
            <NextLink href={href!}>{label}</NextLink>
          </TabsTrigger>)}
      </TabsList>
    </Tabs>
    {status.isPending && <p role="status">Loading grading status…</p>}
    {status.isError && <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">Could not refresh grading status. {data ? 'The last successful snapshot is shown below.' : 'Check your connection or sign in again.'}</div>}
    {data && <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Waiting submissions" value={String(data.waiting)} />
        <Metric label="Currently grading" value={String(data.grading)} />
        <Metric label="Connected graders" value={`${visibleWorkers.filter(w => w.connected).length} / ${visibleWorkers.length}`} />
        <Metric label="Idle graders" value={String(visibleWorkers.filter(w => w.connected && w.enabled && !w.submissionId).length)} />
      </div>
      {dedicatedCompiler && data.compilation && <Panel title="Compilation pipeline" description={`1 compiler worker · ${data.maxCompilerJobs} concurrent jobs · ${data.memoryReservationsEnabled ? `${compilationReservationMiB} MiB reserved/job` : 'Reservations off'}`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-5">
          <Metric label="Waiting for compilation" value={number(data.compilation.waiting,0)} />
          <Metric label="Compiling now" value={String(data.compilation.compiling)} />
          <Metric label="Ready for grading" value={String(data.compilation.ready)} />
          <Metric label="Waiting for direct grading" value={number(data.compilation.directWaiting,0)} />
        </div>
        {data.compilation.waiting == null && <p role="status" className="mb-3 text-sm text-muted-foreground">Problem metadata is unavailable. Compilation and direct-queue counts will return with the next successful reading.</p>}
        {data.compilation.pausedForGraders && <p role="status" className="mb-3 text-sm text-amber-600">New compilations are paused because all graders are paused. Current jobs can finish.</p>}
        <Table headings={['Compiler job slot', 'Heartbeat', 'Status', 'Current job', 'Since']}>
          {data.compilation.slots.filter((slot,index) => index < data.maxCompilerJobs || slot.submissionId != null).map(slot => <tr key={slot.id} className="h-16 border-t">
            <Cell><span className="font-medium">Job slot {slot.id-6}</span><div className="text-xs text-muted-foreground">{slot.cpuId == null ? 'CPU assignment pending' : `VM CPU ${slot.cpuId}`}</div></Cell>
            <Cell><Pill tone={slot.connected ? 'good' : 'warn'}>{slot.connected ? 'Connected' : 'Offline / stale'}</Pill></Cell>
            <Cell>{slot.submissionId ? (slot.enabled ? 'Compiling' : 'Finishing, then paused') : !slot.enabled ? 'Paused' : !slot.connected ? 'Unavailable' : data.compilation!.pausedForGraders ? 'Waiting for graders' : 'Idle'}</Cell>
            <Cell>{slot.submissionId ? <><NextLink className="underline underline-offset-4" href={`/submission/${slot.submissionId}`}>Submission #{slot.submissionId}</NextLink><div className="text-xs text-muted-foreground">{slot.problemName} · user #{slot.userId}</div></> : '—'}</Cell>
            <Cell>{slot.submissionId ? age(slot.claimedAt,data.observedAt) : '—'}</Cell>
          </tr>)}
        </Table>
      </Panel>}
      <Panel title="Grading settings" description="Limit how many submissions from one account can compile or grade at the same time. This limit is shared by both stages.">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <label htmlFor="grader-count" className="text-sm font-medium">Active graders</label>
          <select id="grader-count" className="rounded-md border bg-background px-3 py-2 text-sm"
            value={selectedCount}
            disabled={workerCount.isPending || Object.keys(pendingWorkers).length > 0 || status.isError || data.workers.length !== 7}
            onChange={event => workerCount.mutate(Number(event.target.value))}>
            {[1,2,3,4,5,6,7].map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <span role="status" className="text-xs text-muted-foreground">{workerCount.isPending || allocationPending ? 'Updating CPU allocation…' : `Grading: ${selectedCount === 1 ? 'CPU 0' : `CPUs 0–${selectedCount-1}`}. Unused grader CPUs go to web and other services.`}
            {allocationFresh && data.cpuAllocation && ` Web and services: CPUs ${data.cpuAllocation.serviceCpus.join(', ')}.`}
            {drainingWorkers.length > 0 && ' Retiring graders finish their current submissions before releasing CPUs.'}
            {(!allocationFresh || data.cpuAllocation?.error) && ' CPU allocation status is unavailable; changes are retried automatically.'}
          </span>
        </div>
        {dedicatedCompiler && <div className="flex flex-wrap items-center gap-3 mb-4">
          <label htmlFor="compiler-jobs" className="text-sm font-medium">Concurrent compiler jobs</label>
          <select id="compiler-jobs" className="rounded-md border bg-background px-3 py-2 text-sm"
            value={data.maxCompilerJobs} disabled={compilerJobs.isPending || status.isError}
            onChange={event => compilerJobs.mutate(Number(event.target.value))}>
            {Array.from({length:10},(_,index) => index+1).map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <span className="text-xs text-muted-foreground">{compilerJobs.isPending ? 'Updating…' : 'Running jobs finish when lowered.'}</span>
        </div>}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <label htmlFor="memory-reservations" className="text-sm font-medium">Memory reservations</label>
          <input id="memory-reservations" type="checkbox" role="switch" className="h-5 w-5 accent-primary"
            checked={data.memoryReservationsEnabled} disabled={memoryReservations.isPending || status.isError}
            onChange={event => memoryReservations.mutate(event.target.checked)} />
          <span className="text-sm text-muted-foreground">{memoryReservations.isPending ? 'Updating…' : data.memoryReservationsEnabled ? 'On' : 'Off'}</span>
          <span className="text-xs text-muted-foreground">Applies to new jobs. Job memory limits and the low-RAM guard stay active.</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="workers-per-user" className="text-sm font-medium">Maximum workers per user</label>
          <select id="workers-per-user" className="rounded-md border bg-background px-3 py-2 text-sm"
            value={limitDraft ?? data.maxWorkersPerUser} disabled={settings.isPending || status.isError}
            onChange={(event) => setLimitDraft(Number(event.target.value))}>
            {[1,2,3,4,5,6,7].map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <Button disabled={settings.isPending || status.isError || (limitDraft ?? data.maxWorkersPerUser) === data.maxWorkersPerUser}
            onClick={() => settings.mutate(limitDraft ?? data.maxWorkersPerUser)}>{settings.isPending ? 'Saving…' : 'Save'}</Button>
          <span className="text-sm text-muted-foreground">Current limit: {data.maxWorkersPerUser}</span>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">Changes apply to new jobs. Lowering the limit lets current jobs finish. Contest scores stay consistent even when jobs finish in a different order.</p>
      </Panel>
      <Panel title="Grading workers" description={`${dedicatedCompiler ? '' : 'Each worker compiles and grades its own submission. '}Pause lets the current submission finish. Kill immediately restarts the worker and requeues its unfinished submission.`}>
        <Table headings={['Worker', 'Connection', 'Status', 'Current job', 'Since', 'Action']}>
          {visibleWorkers.map(w => <tr key={w.id} className="h-20 border-t">
            <Cell><span className="font-medium">Worker {w.id}</span><div className="text-xs text-muted-foreground">{w.cpuId == null ? 'CPU assignment pending' : `VM CPU ${w.cpuId}`}</div></Cell>
            <Cell><Pill tone={w.connected ? 'good' : 'warn'}>{w.connected ? 'Connected' : 'Offline / stale'}</Pill></Cell>
            <Cell>{w.id > selectedCount ? 'Finishing, then releasing CPU' : w.submissionId ? (w.enabled ? 'Grading' : 'Finishing, then paused') : w.enabled ? (w.connected ? 'Idle' : 'Unavailable') : 'Paused'}</Cell>
            <Cell>{w.submissionId ? <><NextLink className="underline underline-offset-4" href={`/submission/${w.submissionId}`}>Submission #{w.submissionId}</NextLink><div className="text-xs text-muted-foreground">{w.problemName} · user #{w.userId}</div></> : '—'}</Cell>
            <Cell>{w.submissionId ? age(w.claimedAt, data.observedAt) : '—'}</Cell>
            <Cell><div className="ml-auto flex w-[14.5rem] gap-2 whitespace-nowrap"><Button size="sm" className="w-28 shrink-0 px-2" variant={w.enabled ? 'outline' : 'secondary'}
              disabled={allocationPending || w.id > selectedCount || workerCount.isPending || !!pendingWorkers[w.id] || status.isError}
              onClick={() => {
                if (beginWorkerAction(w.id, 'control')) control.mutate({ id: w.id, enabled: !w.enabled })
              }}>{pendingWorkers[w.id] === 'control' ? 'Updating…' : w.enabled ? 'Pause' : 'Resume'}</Button>
              <Button size="sm" className="w-28 shrink-0 px-2" variant="destructive" disabled={workerCount.isPending || !!pendingWorkers[w.id] || status.isError || !w.startedAt}
                onClick={() => {
                  if (beginWorkerAction(w.id, 'kill')) kill.mutate(w)
                }}>{pendingWorkers[w.id] === 'kill' ? 'Restarting…' : 'Kill'}</Button>
            </div></Cell>
          </tr>)}
        </Table>
      </Panel>
      <Panel title="Submission queue" description={`${dedicatedCompiler ? 'Waiting submissions across both stages.' : 'Waiting submissions are compiled and graded by the same worker.'} Each account can use up to ${data.maxWorkersPerUser} workers; job admission also checks memory and problem limits.`}>
        {data.queue.length === 0 ? <p className="py-4 text-sm text-muted-foreground">Queue empty.</p> : <>
          <Table headings={['Order', 'Submission', 'Problem', 'User', 'Stage', 'Waiting', 'Scheduling']}>
            {data.queue.map((job, index) => <tr key={job.id} className="border-t">
              <Cell>{index + 1}</Cell><Cell><NextLink className="underline underline-offset-4" href={`/submission/${job.id}`}>#{job.id}</NextLink></Cell>
              <Cell><NextLink href={`/problem/${job.problemId}`} className="hover:underline">{job.problemName}</NextLink><div className="text-xs text-muted-foreground">{job.language}</div></Cell>
              <Cell>#{job.userId}</Cell><Cell><Pill tone={dedicatedCompiler && job.stage === 'ready' ? 'good' : 'warn'}>{!dedicatedCompiler ? 'Waiting for worker' : job.stage === 'compile' ? 'Compilation queue' : job.stage === 'ready' ? 'Ready for grading' : job.stage === 'direct' ? 'Direct grading' : 'Stage unavailable'}</Pill></Cell><Cell>{age(job.queuedAt, data.observedAt)}</Cell>
              <Cell>{job.waitingForUser ? 'Waiting for this account’s slot or earlier queued job' : 'Waiting for a slot, memory or problem limit'}</Cell>
            </tr>)}
          </Table>
          {data.waiting > data.queueLimit && <p className="text-xs text-muted-foreground mt-3">Showing the first {data.queueLimit} of {data.waiting} queued submissions.</p>}
        </>}
      </Panel>
      <ResourceReadings freshness={data.resourceStatus} receivedAt={data.receivedAt} requestDurationMs={data.requestDurationMs}>
      {telemetry && <>
        <Panel title={`Linux VM · ${telemetry.machine.name}`} description={`${telemetry.machine.cpuCount} virtual CPUs · uptime ${duration(telemetry.machine.uptimeSeconds)} · resource samples kept in memory for up to 10 minutes`}>
          <div className="grid gap-3 sm:grid-cols-3 mb-6">
            <Metric label="CPU busy · % of entire VM" value={last?.cpuUser == null || last?.cpuSystem == null ? '—' : `${number(last.cpuUser + last.cpuSystem,2)}%`} />
            <Metric label="Available RAM" value={`${number(telemetry.machine.memoryAvailableMb)} / ${number(telemetry.machine.memoryTotalMb)} MiB`} />
            <Metric label="Available VM disk" value={`${number(telemetry.machine.diskFreeGb)} / ${number(telemetry.machine.diskTotalGb)} GiB`} />
          </div>
          <p className="text-xs text-muted-foreground mb-4">CPU is an interval average across all virtual CPUs; 100% means the entire VM. Current CPU interval: {number(last?.cpuSampleIntervalSeconds)} seconds. System includes interrupts. I/O wait is Linux’s estimate of idle time with outstanding disk I/O, not CPU work. Steal is shown as reported by the guest. Available RAM includes memory the kernel estimates it can reclaim. Memory Used excludes the separately shown cache and buffers. Gaps indicate missing readings.</p>
          <div className="grid gap-6 lg:grid-cols-2">
            <HistoryChart title="CPU (% of VM)" points={telemetry.history} maximum={100} series={[['cpuUser','User','#3b82f6'],['cpuSystem','System','#f59e0b'],['cpuWait','I/O wait','#94a3b8'],['cpuIdle','Idle','#10b981'],['cpuSteal','Steal','#8b5cf6']]} />
            <HistoryChart title="Memory (MiB)" points={telemetry.history} maximum={telemetry.machine.memoryTotalMb} series={[['memoryUsedMb','Used (excl. cache/buffers)','#3b82f6'],['memoryCacheMb','Cache','#94a3b8'],['memoryBuffersMb','Buffers','#f59e0b'],['memoryFreeMb','Free','#10b981']]} />
            <HistoryChart title="Swap used (MiB)" points={telemetry.history} maximum={Math.max(1,telemetry.machine.swapTotalMb)} series={[['swapUsedMb','Used','#8b5cf6']]} />
          </div>
        </Panel>
        <Panel title="Services" description="CPU and RAM cover each whole service/container, including children. CPU is averaged between samples; 100% is one virtual CPU. RAM is charged memory minus inactive file cache. Main threads and virtual address space describe only the main process; virtual space is not reserved RAM or disk. Automatic restart counts exclude manual restarts and reset when the service/container counter resets.">
          <Table headings={['Service', 'Status', 'Uptime', 'Main threads', 'RAM (MiB)', 'Main virtual (MiB)', 'CPU (%)', 'Auto restart']}>
            {telemetry.services.filter(s => {
              const match = /^otog-grader(\d*)-1$/.exec(s.name)
              return !match || visibleWorkers.some(w => w.id === Number(match[1] || 1))
            }).map(s => <tr key={s.name} className="border-t">
              <Cell>{s.name === 'otog-compiler-1' ? <><span className="font-medium">Compiler worker</span><div className="text-xs text-muted-foreground">{s.name} · dispatcher and all job processes</div></> : s.name}</Cell><Cell><Pill tone={s.state === 'running' ? 'good' : 'warn'}>{s.state}</Pill></Cell>
              <Cell>{duration(s.uptimeSeconds)}</Cell><Cell>{number(s.threads,0)}</Cell><Cell>{number(s.memoryMb)}</Cell><Cell>{number(s.virtualMb)}</Cell><Cell><span title={s.cpuIntervalSeconds == null ? 'Collecting CPU samples' : `Average over ${number(s.cpuIntervalSeconds, 2)} seconds; sampled ${s.sampledAt ? stamp(s.sampledAt) : 'by the VM'}`}>{number(s.cpuPercent,2)}</span></Cell><Cell>{s.autoRestart}{s.restarts == null ? '' : ` · ${s.restarts} automatic`}</Cell>
            </tr>)}
          </Table>
          {telemetry.warnings.map(w => <p key={w} className="text-xs text-amber-600 mt-2">{w}</p>)}
        </Panel>
      </>}
      </ResourceReadings>
      <p className="text-xs text-muted-foreground">Queue snapshot: {stamp(data.observedAt)}. Grading workers share the host’s hardware; this dashboard does not change problem limits or eliminate VirtualBox stalls.</p>
    </>}
  </main>
}

function Metric({label,value}:{label:string;value:string}) { return <div className="rounded-lg border bg-card px-4 py-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p></div> }
function Panel({title,description,children}:{title:string;description:string;children:ReactNode}) { return <section className="rounded-xl border bg-card p-5"><h2 className="text-lg font-semibold">{title}</h2><p className="text-sm text-muted-foreground mt-1 mb-4">{description}</p>{children}</section> }
function Table({headings,children}:{headings:string[];children:ReactNode}) { return <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr>{headings.map(h=><th key={h} className="px-3 py-3 font-medium text-muted-foreground whitespace-nowrap">{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div> }
function Cell({children}:{children:ReactNode}) { return <td className="px-3 py-3 align-middle">{children}</td> }
function Pill({children,tone}:{children:ReactNode;tone:'good'|'warn'}) { return <span className={`inline-flex rounded-full px-2 py-1 text-xs whitespace-nowrap ${tone==='good'?'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400':'bg-amber-500/15 text-amber-700 dark:text-amber-400'}`}>{children}</span> }

type Series = [keyof Point,string,string]
function HistoryChart({title,points,maximum,series}:{title:string;points:Point[];maximum:number;series:Series[]}) {
  const segments=historySegments(points,series.map(([key])=>key))
  const samples=segments.flat()
  const max=Number.isFinite(maximum)?Math.max(1,maximum):1
  const first=historyTime(samples[0]??{at:''}),last=historyTime(samples.at(-1)??{at:''})
  const x=(p:Point)=>40+(historyTime(p)-first)/Math.max(1,last-first)*510
  const y=(p:Point,key:keyof Point)=>145-Math.max(0,Math.min(max,Number(p[key])))/max*125
  const coordinates=(segment:Point[],key:keyof Point)=>segment.map(p=>`${x(p)},${y(p,key)}`).join(' ')
  return <div><h3 className="font-medium text-sm mb-2">{title}</h3>
    {samples.length<2 ? <p className="text-sm text-muted-foreground py-8">Collecting resource samples…</p> : <>
      <svg viewBox="0 0 570 170" className="w-full" role="img" aria-label={`${title} history from ${stamp(samples[0]!.at)} to ${stamp(samples.at(-1)!.at)}`}>
        {[0,0.5,1].map(f=><g key={f}><line x1="40" x2="550" y1={145-f*125} y2={145-f*125} stroke="currentColor" opacity="0.12"/><text x="34" y={149-f*125} textAnchor="end" fill="currentColor" fontSize="10" opacity="0.6">{number(f*max,0)}</text></g>)}
        {series.flatMap(([key,,color])=>segments.map((segment,index)=>segment.length===1
          ? <circle key={`${key}-${index}`} cx={x(segment[0]!)} cy={y(segment[0]!,key)} r="2" fill={color}/>
          : <polyline key={`${key}-${index}`} points={coordinates(segment,key)} fill="none" stroke={color} strokeWidth="2" />))}
        <text x="40" y="165" fill="currentColor" fontSize="10" opacity="0.6">{stamp(samples[0]!.at)}</text><text x="550" y="165" textAnchor="end" fill="currentColor" fontSize="10" opacity="0.6">{stamp(samples.at(-1)!.at)}</text>
      </svg>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">{series.map(([key,label,color])=><span key={key} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{background:color}}/>{label}</span>)}</div>
    </>}
  </div>
}
