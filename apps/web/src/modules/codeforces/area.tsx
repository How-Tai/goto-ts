import { StatementViewer } from '../../components/statement-viewer'
import { ReactNode, useEffect, useRef, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Head from 'next/head'
import Link from 'next/link'

import { useUserContext } from '../../context/user-context'
import { button, cfApi, field, panel, primary } from './client'

export function CfLayout({
  children,
  title = 'Codeforces contests',
  id,
  tab,
}: {
  children: ReactNode
  title?: string
  id?: number
  tab?: string
}) {
  const { isAdmin, user } = useUserContext()
  const root = id ? `/codeforces/contest/${id}` : '/codeforces'
  return (
    <>
      <Head>
        <title>{title} | CF Contests</title>
      </Head>
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-5">
          <Link href="/codeforces" className="text-2xl font-bold">
            CF Contests
          </Link>
          <nav
            aria-label="Codeforces navigation"
            className="flex items-center gap-5 text-sm"
          >
            <Link href="/codeforces">Contests</Link>
            <Link href="/codeforces/problemset">Problem set</Link>
            {isAdmin && (
              <Link href="/admin/codeforces/problems">Manage problems</Link>
            )}
            {isAdmin && <Link href="/admin/codeforces">Manage contests</Link>}
            {user ? (
              <span>{user.showName}</span>
            ) : (
              <Link href="/login">Log in</Link>
            )}
          </nav>
        </div>
      </header>
      <main
        id="content"
        className="mx-auto w-full max-w-7xl flex-1 space-y-5 px-5 py-6"
      >
        {id && (
          <nav
            aria-label="Contest tabs"
            className="flex flex-wrap gap-2 border-b pb-3"
          >
            {[
              ['', 'Problems'],
              ['submissions', 'Submissions'],
              ['standings', 'Standings'],
              ['hacks', 'Hacks'],
            ].map(([key, label]) => (
              <Link
                key={key}
                href={`${root}${key ? '/' + key : ''}`}
                aria-current={(tab || '') === key ? 'page' : undefined}
                className={`${button} ${(tab || '') === key ? 'border-primary text-primary' : ''}`}
              >
                {label}
              </Link>
            ))}
          </nav>
        )}
        {children}
      </main>
      <footer className="border-t p-5 text-center text-xs text-muted-foreground">
        Codeforces-style contests, hosted and judged by OTOG.
      </footer>
    </>
  )
}
export function useNow() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}
export function ErrorBox({ error }: { error: unknown }) {
  return error ? (
    <p
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
    >
      {error instanceof Error ? error.message : String(error)}
    </p>
  ) : null
}
function date(value: string) {
  return new Date(value).toLocaleString()
}
export function ContestList() {
  const q = useQuery({
    queryKey: ['cf', 'contests'],
    queryFn: ({ signal }) => cfApi<any[]>('', undefined, signal),
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
  })
  const now = useNow()
  return (
    <CfLayout>
      <div>
        <h1 className="text-3xl font-bold">Codeforces-style contests</h1>
        <p className="mt-2 text-muted-foreground">
          Pretests, points-based standings, in-contest hacks and final system
          tests.
        </p>
      </div>
      <ErrorBox error={q.error} />
      {q.isPending ? (
        <p>Loading contests…</p>
      ) : q.data?.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted">
              <tr>
                {['Contest', 'Start', 'Duration', 'Status'].map((h) => (
                  <th key={h} className="p-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="p-4">
                    <Link
                      className="font-medium text-primary"
                      href={`/codeforces/contest/${c.id}`}
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="p-4">{date(c.timeStart)}</td>
                  <td className="p-4">
                    {Math.round(
                      (Date.parse(c.timeEnd) - Date.parse(c.timeStart)) / 60000
                    )}{' '}
                    min
                  </td>
                  <td className="p-4">
                    {c.phase === 'cancelled'
                      ? 'Cancelled'
                      : c.phase === 'final'
                        ? 'Finished'
                        : now < Date.parse(c.timeStart)
                          ? 'Upcoming'
                          : now < Date.parse(c.timeEnd)
                            ? 'Running'
                            : c.phase === 'system_pending'
                              ? 'Waiting for outstanding jobs'
                              : 'System testing'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={panel}>No published CF-style contests yet.</div>
      )}
    </CfLayout>
  )
}
export function verdict(r: any) {
  if (r.status === 'waiting') return 'In queue'
  if (r.status === 'grading')
    return r.kind === 'validator'
      ? `Validating test ${r.outcome?.currentTest || 1}…`
      : r.kind === 'reference'
        ? `Checking reference on test ${r.outcome?.currentTest || 1}…`
        : r.kind === 'hack'
          ? 'Testing hack…'
          : r.phase === 'system'
            ? `Running on test ${r.outcome?.currentTest || 1}…`
            : `Running on pretest ${r.outcome?.currentTest || 1}…`
  if (r.kind === 'hack') {
    const state = r.hackState || r.outcome?.hackState
    return (
      (
        {
          successful: 'Successful',
          unsuccessful: 'Unsuccessful',
          invalid: 'Ignored: invalid input',
          ignored: 'Ignored: target changed',
          judge_error: 'Judge error',
          pending: 'Pending',
        } as Record<string, string>
      )[state] || 'Pending'
    )
  }
  const o = r.outcome
  if (!o) return r.status
  if (o.verdict === 'accepted')
    return r.kind === 'validator'
      ? 'Validation passed'
      : r.kind === 'reference'
        ? 'Reference passed'
        : r.phase === 'pretest'
          ? 'Pretests passed'
          : 'Accepted'
  const names: Record<string, string> = {
    wrong_answer: r.kind === 'validator' ? 'Validation failed' : 'Wrong answer',
    validation_failed: 'Validation failed',
    time_limit: 'Time limit exceeded',
    memory_limit: 'Memory limit exceeded',
    runtime_error: 'Runtime error',
    hacked: 'Hacked',
    compile_error: 'Compilation error',
    judge_error: 'Judge error',
  }
  return `${names[o.verdict] || o.verdict}${o.failedTest ? ` on ${r.phase === 'pretest' ? 'pretest' : 'test'} ${o.failedTest}` : ''}`
}
export function Contest({
  id,
  tab = '',
  letter,
}: {
  id: number
  tab?: string
  letter?: string
}) {
  const { isAuthenticated, user, isAdmin } = useUserContext(),
    client = useQueryClient(),
    clientNow = useNow()
  const detail = useQuery({
    queryKey: ['cf', id, 'detail', user?.id],
    queryFn: ({ signal }) => cfApi(`/${id}`, undefined, signal),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  const c = detail.data,
    root = `/codeforces/contest/${id}`
  const now = c
    ? Date.parse(c.now) + Math.max(0, clientNow - detail.dataUpdatedAt)
    : clientNow
  const running =
    c?.phase === 'scheduled' &&
    now >= Date.parse(c.timeStart) &&
    now < Date.parse(c.timeEnd)
  const [source, setSource] = useState(''),
    [language, setLanguage] = useState('cpp'),
    [selected, setSelected] = useState<number>(),
    [input, setInput] = useState(''),
    [target, setTarget] = useState(''),
    [viewSource, setViewSource] = useState(''),
    [message, setMessage] = useState('')
  const requests = useRef<Record<string, { fingerprint: string; id: string }>>(
    {}
  )
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body: any }) =>
      cfApi(`/${id}/${path}`, body),
    onSuccess: (r, v) => {
      delete requests.current[v.path]
      setMessage(r.id ? `Queued as #${r.id}` : 'Saved.')
      void client.invalidateQueries({ queryKey: ['cf', id] })
    },
  })
  const sourceAction = useMutation({
    mutationFn: (submissionId: number) =>
      cfApi(`/${id}/source/${submissionId}`),
    onSuccess: (r) =>
      setViewSource(
        r.sourceCode +
          (r.compilerLog ? '\n\nCompiler diagnostics:\n' + r.compilerLog : '')
      ),
  })
  const submissions = useQuery({
    queryKey: ['cf', id, 'submissions', user?.id],
    queryFn: ({ signal }) =>
      cfApi<any[]>(`/${id}/submissions`, undefined, signal),
    enabled: isAuthenticated && ['submissions', 'hacks'].includes(tab),
    refetchInterval: () => (c?.phase === 'final' ? false : 3500),
    refetchIntervalInBackground: false,
  })
  const standings = useQuery({
    queryKey: ['cf', id, 'standings', user?.id],
    queryFn: ({ signal }) => cfApi(`/${id}/standings`, undefined, signal),
    enabled: tab === 'standings',
    refetchInterval: () => (c?.phase === 'final' ? false : 5000),
    refetchIntervalInBackground: false,
  })
  const problem = c?.problems?.find(
    (p: any) => p.letter === letter || (!letter && p.problemId === selected)
  )
  const invoke = (path: string, body: any = {}) => {
    if (path === 'submit' || path === 'hack') {
      const { requestId, ...content } = body,
        fingerprint = JSON.stringify(content)
      if (requests.current[path]?.fingerprint !== fingerprint)
        requests.current[path] = { fingerprint, id: crypto.randomUUID() }
      body = { ...content, requestId: requests.current[path]!.id }
    }
    setMessage('')
    action.mutate({ path, body })
  }
  const remaining = c
    ? Math.max(
        0,
        Math.floor(
          (Date.parse(now < Date.parse(c.timeStart) ? c.timeStart : c.timeEnd) -
            now) /
            1000
        )
      )
    : 0
  return (
    <CfLayout
      title={c?.name || 'Contest'}
      id={id}
      tab={tab === 'problem' ? '' : tab}
    >
      <ErrorBox error={detail.error} />
      {!c ? (
        <p>Loading contest…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">{c.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {date(c.timeStart)} – {date(c.timeEnd)}
              </p>
            </div>
            <div className="text-right">
              <strong className="block text-lg">
                {c.phase === 'cancelled'
                  ? 'Contest cancelled'
                  : running
                    ? 'Contest running'
                    : now < Date.parse(c.timeStart)
                      ? 'Starts in'
                      : c.phase === 'final'
                        ? 'Final results'
                        : c.phase === 'system_pending'
                          ? 'Finishing outstanding jobs'
                          : 'System testing'}
              </strong>
              {c.phase !== 'cancelled' && now < Date.parse(c.timeEnd) && (
                <span className="font-mono tabular-nums">
                  {Math.floor(remaining / 3600)}:
                  {String(Math.floor(remaining / 60) % 60).padStart(2, '0')}:
                  {String(remaining % 60).padStart(2, '0')}
                </span>
              )}
            </div>
          </div>
          {!isAuthenticated ? (
            <p>
              <Link href="/login" className="text-primary">
                Log in
              </Link>{' '}
              to register and submit.
            </p>
          ) : (
            !c.registered &&
            c.phase === 'scheduled' &&
            now < Date.parse(c.timeEnd) && (
              <button
                className={primary}
                disabled={action.isPending}
                onClick={() => invoke('register')}
              >
                Register for contest
              </button>
            )
          )}
          <ErrorBox error={action.error || sourceAction.error} />
          {message && (
            <p role="status" className="rounded-md bg-muted p-3">
              {message}
            </p>
          )}
          {(!tab || tab === 'problem') && (
            <>
              <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
                <section className="space-y-5">
                  {!letter ? (
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-muted">
                          <tr>
                            <th className="p-4">Problem</th>
                            <th className="p-4">Initial points</th>
                            <th className="p-4">Limits</th>
                          </tr>
                        </thead>
                        <tbody>
                          {c.problems.map((p: any) => (
                            <tr key={p.letter} className="border-t">
                              <td className="p-4">
                                <Link
                                  className="font-semibold text-primary"
                                  href={`${root}/problem/${p.letter}`}
                                >
                                  {p.letter}. {p.name}
                                </Link>
                                {p.locked && (
                                  <span className="ml-3 text-xs">Locked</span>
                                )}
                              </td>
                              <td className="p-4">
                                {p.points}
                                {running && (
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    now{' '}
                                    {Math.floor(
                                      Math.max(
                                        p.points * c.settings.minimumFraction,
                                        p.points *
                                          (1 -
                                            Math.max(
                                              0,
                                              (now - Date.parse(c.timeStart)) /
                                                60000
                                            ) /
                                              c.settings.decayMinutes)
                                      )
                                    )}
                                  </span>
                                )}
                              </td>
                              <td className="p-4">
                                {p.timeLimit} ms / {p.memoryLimit} MiB
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!c.problems.length && (
                        <p className="p-5">
                          Problems become available when the contest starts.
                        </p>
                      )}
                    </div>
                  ) : problem ? (
                    <div className={panel}>
                      <h2 className="text-xl font-bold">
                        {problem.letter}. {problem.name}
                      </h2>
                      <StatementViewer key={`/backend/codeforces/statement/${problem.problemId}?contestId=${id}`} url={`/backend/codeforces/statement/${problem.problemId}?contestId=${id}`} title={`${problem.name} statement`}>
{(problem.hasAttachment ||
                        problem.attachmentMetadata) && (
                        <a
                          className={`${button} ml-2`}
                          href={`/backend/codeforces/attachment/${problem.problemId}?contestId=${id}`}
                        >
                          Download starter files
                        </a>
                      )}
</StatementViewer>
                    </div>
                  ) : (
                    <p>Problem unavailable.</p>
                  )}
                  {running && isAuthenticated && c.registered && (
                    <form
                      className={`${panel} space-y-4`}
                      onSubmit={(e) => {
                        e.preventDefault()
                        const p = problem?.problemId || selected
                        if (p)
                          invoke('submit', {
                            problemId: p,
                            sourceCode: source,
                            language:
                              (problem?.taskType ||
                                problem?.config?.taskType) === 'library'
                                ? 'cpp'
                                : language,
                            requestId: crypto.randomUUID(),
                          })
                      }}
                    >
                      <h2 className="text-lg font-semibold">
                        Submit a solution
                      </h2>
                      {!letter && (
                        <label className="block">
                          Problem
                          <select
                            required
                            className={field}
                            value={selected || ''}
                            onChange={(e) =>
                              setSelected(Number(e.target.value))
                            }
                          >
                            <option value="">Choose a problem</option>
                            {c.problems.map((p: any) => (
                              <option
                                disabled={p.locked}
                                key={p.problemId}
                                value={p.problemId}
                              >
                                {p.letter}. {p.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label className="block">
                        Language
                        <select
                          className={field}
                          value={
                            (problem?.taskType || problem?.config?.taskType) ===
                            'library'
                              ? 'cpp'
                              : language
                          }
                          onChange={(e) => setLanguage(e.target.value)}
                        >
                          <option value="cpp">GNU C++17</option>
                          {(problem?.taskType || problem?.config?.taskType) !==
                            'library' && (
                            <>
                              <option value="c">GNU C17</option>
                              <option value="python">Python 3</option>
                            </>
                          )}
                        </select>
                      </label>
                      <label className="block">
                        Source code
                        <textarea
                          required
                          spellCheck={false}
                          maxLength={64000}
                          rows={13}
                          className={`${field} font-mono`}
                          value={source}
                          onChange={(e) => setSource(e.target.value)}
                        />
                      </label>
                      <label className="block text-sm">
                        Or choose a source file
                        <input
                          type="file"
                          accept=".cpp,.c,.py,.txt"
                          onChange={async (e) => {
                            const f = e.target.files?.[0]
                            if (f && f.size <= 64000) setSource(await f.text())
                            else
                              setMessage('Source files must be at most 64 KB.')
                          }}
                        />
                      </label>
                      <button
                        className={primary}
                        disabled={action.isPending || problem?.locked}
                      >
                        Submit
                      </button>
                      {problem?.locked && (
                        <p>
                          This problem is locked; further submissions are
                          disabled.
                        </p>
                      )}
                    </form>
                  )}
                </section>
                <aside className={`${panel} h-fit space-y-3 text-sm`}>
                  <h2 className="font-semibold">Contest rules</h2>
                  <p>
                    Points decrease with submission time and penalized attempts.
                    Minimum: {Math.round(c.settings.minimumFraction * 100)}% of
                    starting points.
                  </p>
                  <p>
                    Pretests passed is provisional. Full system tests run after
                    the contest.
                  </p>
                  <p>
                    To hack, pass pretests and lock the problem. Locking
                    permanently prevents resubmission on that problem.
                  </p>
                  <p>
                    Hacks: +{c.settings.successfulHackPoints} successful / −
                    {c.settings.unsuccessfulHackPenalty} unsuccessful. Invalid
                    hacks are ignored. Hacks are accepted only during the
                    contest. All participants share one hacking room.
                  </p>
                </aside>
              </div>
            </>
          )}
          {tab === 'submissions' && (
            <>
              <ErrorBox error={submissions.error} />
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted">
                    <tr>
                      {[
                        '#',
                        'Participant',
                        'Problem',
                        'Language',
                        'Result',
                        'Time / memory',
                        'Submitted',
                      ].map((h) => (
                        <th className="p-3" key={h}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {submissions.data
                      ?.filter((r) => r.kind === 'contest')
                      .map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="p-3">
                            <button
                              className="text-primary"
                              disabled={sourceAction.isPending}
                              onClick={() => sourceAction.mutate(r.id)}
                            >
                              {r.id}
                            </button>
                          </td>
                          <td className="p-3">
                            {r.showName}
                            {r.userId === user?.id ? ' (you)' : ''}
                          </td>
                          <td className="p-3">{r.letter}</td>
                          <td className="p-3">{r.language}</td>
                          <td
                            className={`p-3 ${r.outcome?.verdict === 'accepted' ? 'text-green-600' : 'text-muted-foreground'}`}
                          >
                            {verdict(r)}
                          </td>
                          <td className="p-3">
                            {r.outcome
                              ? `${r.outcome.timeMs || 0} ms / ${r.outcome.memoryKiB || 0} KiB`
                              : '—'}
                          </td>
                          <td className="p-3">{date(r.creationDate)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {tab === 'standings' && (
            <>
              <ErrorBox error={standings.error} />
              <p className="text-sm text-muted-foreground">
                {c.phase === 'cancelled'
                  ? 'Contest cancelled — these standings are unofficial.'
                  : c.phase === 'final'
                    ? 'Final standings'
                    : 'Provisional standings — system tests can change results.'}
              </p>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="p-3">Rank</th>
                      <th className="p-3">Participant</th>
                      <th className="p-3">Total</th>
                      {c.problems.map((p: any) => (
                        <th key={p.letter} className="p-3">
                          {p.letter}
                        </th>
                      ))}
                      <th className="p-3">Hacks + / −</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.data?.rows.map((r: any) => (
                      <tr
                        key={r.userId}
                        className={`border-t ${r.userId === user?.id ? 'bg-primary/5' : ''}`}
                      >
                        <td className="p-3">{r.rank}</td>
                        <td className="p-3">{r.showName}</td>
                        <td className="p-3 font-bold">{r.total}</td>
                        {r.problems.map((p: any) => (
                          <td key={p.letter} className="p-3">
                            <strong>
                              {p.points || (p.hacked ? 'Hacked' : '—')}
                            </strong>
                            {p.points > 0 && (
                              <div className="text-xs text-muted-foreground">
                                {Math.floor(p.minutes)} min · {p.attempts}{' '}
                                attempts
                              </div>
                            )}
                            {p.pending && (
                              <div className="text-xs">Pending</div>
                            )}
                          </td>
                        ))}
                        <td className="p-3">
                          {r.successfulHacks} / {r.unsuccessfulHacks}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {tab === 'hacks' && (
            <>
              <div className={panel}>
                <h2 className="text-lg font-semibold">In-contest hacks</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  A hack is a counterexample input. It must pass the input
                  validator. OTOG generates the expected answer with the trusted
                  reference solution, then tests the target. Successful inputs
                  become system tests.
                </p>
                {running && isAuthenticated && c.registered && (
                  <>
                    <div className="my-4 flex flex-wrap gap-2">
                      {c.problems.map((p: any) => (
                        <button
                          className={button}
                          key={p.problemId}
                          disabled={action.isPending || p.locked}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Lock ${p.letter}? You will no longer be able to submit solutions to this problem.`
                              )
                            )
                              invoke('lock', { problemId: p.problemId })
                          }}
                        >
                          {p.locked
                            ? `${p.letter} locked`
                            : `Lock ${p.letter} to hack`}
                        </button>
                      ))}
                    </div>
                    <form
                      className="space-y-3"
                      onSubmit={(e) => {
                        e.preventDefault()
                        invoke('hack', {
                          targetId: Number(target),
                          input,
                          requestId: crypto.randomUUID(),
                        })
                      }}
                    >
                      <label className="block">
                        Target submission
                        <select
                          required
                          className={field}
                          value={target}
                          onChange={(e) => setTarget(e.target.value)}
                        >
                          <option value="">
                            Choose a pretest-passing solution
                          </option>
                          {submissions.data
                            ?.filter(
                              (r) =>
                                r.kind === 'contest' &&
                                r.userId !== user?.id &&
                                r.preOutcome?.verdict === 'accepted' &&
                                r.outcome?.verdict !== 'hacked'
                            )
                            .map((r) => (
                              <option key={r.id} value={r.id}>
                                #{r.id} · {r.letter} · {r.showName}
                              </option>
                            ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className={button}
                        disabled={!target || sourceAction.isPending}
                        onClick={() => sourceAction.mutate(Number(target))}
                      >
                        View target source
                      </button>
                      <label className="block">
                        Counterexample input
                        <textarea
                          required
                          spellCheck={false}
                          maxLength={64000}
                          rows={8}
                          className={`${field} font-mono`}
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                        />
                      </label>
                      <button className={primary} disabled={action.isPending}>
                        Submit hack
                      </button>
                    </form>
                  </>
                )}
                {!running && (
                  <p className="mt-4 font-medium">
                    Hack submissions are closed.
                  </p>
                )}
              </div>
              <ErrorBox error={submissions.error} />
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted">
                    <tr>
                      {[
                        'Hack #',
                        'Participant',
                        'Problem',
                        'Target',
                        'Result',
                      ].map((h) => (
                        <th key={h} className="p-3">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {submissions.data
                      ?.filter((r) => r.kind === 'hack')
                      .map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="p-3">{r.id}</td>
                          <td className="p-3">{r.showName}</td>
                          <td className="p-3">{r.letter}</td>
                          <td className="p-3">{r.targetId}</td>
                          <td className="p-3">{verdict(r)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {viewSource && (
            <section className={panel}>
              <div className="flex justify-between">
                <h2 className="font-semibold">Submission source</h2>
                <button className={button} onClick={() => setViewSource('')}>
                  Close source
                </button>
              </div>
              <pre className="mt-4 max-h-[65vh] overflow-auto rounded bg-muted p-4 text-xs">
                {viewSource}
              </pre>
            </section>
          )}
        </>
      )}
    </CfLayout>
  )
}
