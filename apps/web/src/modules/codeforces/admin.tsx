import { FormEvent, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'

import { useUserContext } from '../../context/user-context'
import { CfLayout, ErrorBox, verdict } from './area'
import { button, cfApi, field, panel, primary } from './client'

const empty = {
  problemId: '',
  letter: 'A',
  points: '500',
  pretests: '1',
  fullTests: '1',
  validatorSource: '',
  referenceSource: '',
  checkerSource: '',
  taskType: 'batch',
  graderFiles: '',
}
const numbers = (v: string) =>
  v
    .split(/[\s,]+/)
    .filter(Boolean)
    .flatMap((token) => {
      const match = /^(\d+)-(\d+)$/.exec(token)
      if (!match) return [Number(token)]
      const start = Number(match[1]),
        end = Number(match[2])
      if (end < start || end - start >= 1000) return [NaN]
      return Array.from({ length: end - start + 1 }, (_, i) => start + i)
    })
const local = (d: string) => {
  const value = new Date(d)
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
}
export function CfAdmin({ id }: { id?: number }) {
  const { isAdmin, user } = useUserContext(),
    client = useQueryClient()
  const [jobLog, setJobLog] = useState('')
  const [name, setName] = useState(''),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [message, setMessage] = useState(''),
    [problem, setProblem] = useState(empty)
  const [settings, setSettings] = useState({
    wrongPenalty: 50,
    minimumFraction: 0.3,
    decayMinutes: 250,
    successfulHackPoints: 100,
    unsuccessfulHackPenalty: 50,
  })
  const list = useQuery({
    queryKey: ['cf', 'admin', 'list', user?.id],
    queryFn: ({ signal }) => cfApi<any[]>('/admin', undefined, signal),
    enabled: isAdmin && !id,
  })
  const detail = useQuery({
    queryKey: ['cf', id, 'admin', user?.id],
    queryFn: ({ signal }) => cfApi(`/admin/${id}`, undefined, signal),
    enabled: isAdmin && !!id,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  const jobs = useQuery({
    queryKey: ['cf', id, 'admin-jobs', user?.id],
    queryFn: ({ signal }) =>
      cfApi<any[]>(`/${id}/submissions`, undefined, signal),
    enabled: isAdmin && !!id,
    refetchInterval: 3500,
    refetchIntervalInBackground: false,
  })
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body: any }) =>
      cfApi(path, body),
    onSuccess: (r) => {
      setMessage(
        r.validator
          ? `Validation jobs queued: #${r.validator.id} and #${r.reference.id}.`
          : r.published
            ? 'Contest published.'
            : r.id
              ? `Contest #${r.id} created.`
              : 'Saved.'
      )
      void client.invalidateQueries({ queryKey: ['cf'] })
    },
  })
  const logAction = useMutation({
    mutationFn: (sid: number) => cfApi(`/admin/${id}/job/${sid}`),
    onSuccess: (r) =>
      setJobLog(
        [r.outcome?.reason, r.errmsg, JSON.stringify(r.outcome, null, 2)]
          .filter(Boolean)
          .join('\n\n')
      ),
  })
  const invoke = (path: string, body: any = {}) => {
    setMessage('')
    action.mutate({ path, body })
  }
  function saveContest(e: FormEvent) {
    e.preventDefault()
    invoke(id ? `/admin/${id}/settings` : '/admin', {
      ...settings,
      name,
      timeStart: new Date(start).toISOString(),
      timeEnd: new Date(end).toISOString(),
    })
  }
  function edit(p: any) {
    setProblem({
      ...p.config,
      taskType: p.config.taskType || 'batch',
      graderFiles: (p.config.graderFiles || []).join(', '),
      problemId: String(p.problemId),
      points: String(p.points),
      letter: p.letter,
      pretests: p.config.pretests.join(', '),
      fullTests: p.config.fullTests.join(', '),
    })
  }
  const c = detail.data
  return (
    <CfLayout title="Manage CF contests">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          {c ? c.name : 'Manage Codeforces-style contests'}
        </h1>
        <Link href="/admin/codeforces" className={button}>
          All CF contests
        </Link>
        {id && (
          <Link href={`/codeforces/contest/${id}`} className={button}>
            Open contest
          </Link>
        )}
      </div>
      {!isAdmin ? (
        <p>Administrator access required.</p>
      ) : (
        <>
          <ErrorBox
            error={
              list.error ||
              detail.error ||
              jobs.error ||
              action.error ||
              logAction.error
            }
          />
          {message && (
            <p role="status" className="rounded bg-muted p-3">
              {message}
            </p>
          )}
          {!id && (
            <>
              <section className={panel}>
                <h2 className="mb-4 text-lg font-semibold">Contests</h2>
                {list.data?.length ? (
                  list.data.map((c) => (
                    <div
                      className="flex justify-between border-t py-3"
                      key={c.id}
                    >
                      <Link
                        className="text-primary"
                        href={`/admin/codeforces/${c.id}`}
                      >
                        {c.name}
                      </Link>
                      <span>{c.phase}</span>
                    </div>
                  ))
                ) : (
                  <p>No CF contests yet.</p>
                )}
              </section>
              <ContestForm
                onSubmit={saveContest}
                name={name}
                setName={setName}
                start={start}
                setStart={setStart}
                end={end}
                setEnd={setEnd}
                settings={settings}
                setSettings={setSettings}
                pending={action.isPending}
              />
            </>
          )}
          {c && (
            <>
              <section className={`${panel} space-y-3`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-semibold">Phase: {c.phase}</h2>
                  <div className="flex gap-2">
                    {c.phase === 'draft' && (
                      <button
                        className={primary}
                        disabled={
                          action.isPending ||
                          !c.problems.length ||
                          c.problems.some((p: any) => p.validation !== 'valid')
                        }
                        onClick={() => {
                          if (
                            window.confirm(
                              'Publish this contest? Problem bundles and scoring settings will be frozen.'
                            )
                          )
                            invoke(`/admin/${id}/publish`)
                        }}
                      >
                        Publish contest
                      </button>
                    )}
                    {!['draft', 'final', 'cancelled'].includes(c.phase) && (
                      <button
                        className={button + ' text-destructive'}
                        disabled={action.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              'Cancel this contest? Further submissions and hacks will be closed. Existing records will be retained.'
                            )
                          )
                            invoke(`/admin/${id}/cancel`)
                        }}
                      >
                        Cancel contest
                      </button>
                    )}
                    {c.phase !== 'draft' &&
                      c.phase !== 'final' &&
                      c.phase !== 'cancelled' && (
                        <button
                          className={button}
                          disabled={action.isPending}
                          onClick={() => invoke(`/admin/${id}/system-tests`)}
                        >
                          Check system-testing progress
                        </button>
                      )}
                  </div>
                </div>
                <p className="text-sm">
                  {new Date(c.timeStart).toLocaleString()} –{' '}
                  {new Date(c.timeEnd).toLocaleString()}
                </p>
                <p className="text-sm text-muted-foreground">
                  All input validators and reference solutions must pass before
                  publishing. System testing starts automatically after the
                  contest and outstanding jobs finish. Infrastructure failures
                  require an admin retry.
                </p>
              </section>
              <section className={`${panel} space-y-3`}>
                <h2 className="text-lg font-semibold">Problem bundles</h2>
                {c.problems.map((p: any) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-t py-3"
                  >
                    <div>
                      <strong>
                        {p.letter}. {p.name}
                      </strong>
                      <p className="text-sm text-muted-foreground">
                        {p.points} points · {p.config.pretests.length} pretests
                        / {p.config.fullTests.length} full tests · Validation:{' '}
                        {p.validation}
                      </p>
                    </div>
                    {c.phase === 'draft' && (
                      <button className={button} onClick={() => edit(p)}>
                        Edit / validate again
                      </button>
                    )}
                  </div>
                ))}
                {!c.problems.length && <p>Add the first problem below.</p>}
              </section>
              {c.phase === 'draft' && (
                <>
                  <form
                    className={`${panel} space-y-4`}
                    onSubmit={(e) => {
                      e.preventDefault()
                      invoke(`/admin/${id}/problem`, {
                        ...problem,
                        problemId: Number(problem.problemId),
                        points: Number(problem.points),
                        pretests: numbers(problem.pretests),
                        fullTests: numbers(problem.fullTests),
                        graderFiles: problem.graderFiles
                          .split(/[\s,]+/)
                          .filter(Boolean),
                      })
                    }}
                  >
                    <div className="flex justify-between gap-3">
                      <h2 className="text-xl font-semibold">
                        Add or update a problem
                      </h2>
                      <button
                        type="button"
                        className={button}
                        onClick={() => setProblem(empty)}
                      >
                        Clear form
                      </button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Prepare the problem statement, numbered .in/.sol files and
                      helper headers in the{' '}
                      <Link
                        href="/admin/codeforces/problems"
                        className="text-primary"
                      >
                        CF problem editor
                      </Link>{' '}
                      first. Saving here freezes a separate testcase version and
                      queues validator/reference checks. C++17 validators read
                      stdin and exit 0 for valid input. Testlib validators and
                      checkers are supported.
                    </p>
                    <div className="grid gap-4 sm:grid-cols-3">
                      {[
                        ['problemId', 'CF problem ID'],
                        ['letter', 'Letter (A, B, …)'],
                        ['points', 'Initial points'],
                      ].map(([key, label]) => (
                        <label key={key} className="block text-sm">
                          {label}
                          <input
                            required
                            className={field}
                            value={(problem as any)[key!]}
                            onChange={(e) =>
                              setProblem({ ...problem, [key!]: e.target.value })
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block text-sm">
                        Pretest numbers / ranges, in order
                        <input
                          required
                          className={field}
                          value={problem.pretests}
                          onChange={(e) =>
                            setProblem({ ...problem, pretests: e.target.value })
                          }
                        />
                      </label>
                      <label className="block text-sm">
                        Full test numbers / ranges, in order
                        <input
                          required
                          className={field}
                          value={problem.fullTests}
                          onChange={(e) =>
                            setProblem({
                              ...problem,
                              fullTests: e.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block text-sm">
                        Task type
                        <select
                          className={field}
                          value={problem.taskType}
                          onChange={(e) =>
                            setProblem({ ...problem, taskType: e.target.value })
                          }
                        >
                          <option value="batch">Batch program</option>
                          <option value="library">C++ library task</option>
                        </select>
                      </label>
                      {problem.taskType === 'library' && (
                        <label className="block text-sm">
                          Grader source filenames
                          <input
                            required
                            className={field}
                            placeholder="grader.cpp"
                            value={problem.graderFiles}
                            onChange={(e) =>
                              setProblem({
                                ...problem,
                                graderFiles: e.target.value,
                              })
                            }
                          />
                          <span>
                            Files from the testcase ZIP linked with both the
                            submitted implementation and reference
                            implementation. Headers go in the same ZIP.
                          </span>
                        </label>
                      )}
                    </div>
                    {(
                      [
                        [
                          'validatorSource',
                          'Input validator (C++17, required)',
                        ],
                        [
                          'referenceSource',
                          'Trusted reference solution (C++17, required)',
                        ],
                        ['checkerSource', 'Custom checker (C++17, optional)'],
                      ] as const
                    ).map(([key, label]) => (
                      <label className="block text-sm" key={key}>
                        {label}
                        <textarea
                          required={key !== 'checkerSource'}
                          maxLength={24000}
                          rows={9}
                          spellCheck={false}
                          className={`${field} font-mono`}
                          value={problem[key]}
                          onChange={(e) =>
                            setProblem({ ...problem, [key]: e.target.value })
                          }
                        />
                        <input
                          type="file"
                          accept=".cpp,.txt"
                          aria-label={`Load ${label}`}
                          onChange={async (e) => {
                            const f = e.target.files?.[0]
                            if (f && f.size <= 24000) {
                              const value = await f.text()
                              setProblem((p) => ({ ...p, [key]: value }))
                            } else
                              setMessage(
                                'Author source files must be at most 24 KB.'
                              )
                          }}
                        />
                      </label>
                    ))}
                    <p className="text-sm text-muted-foreground">
                      Custom checkers receive input, contestant output and
                      reference answer as argv[1..3]. Exit 0 accepts, 1/2
                      rejects, and other errors block judging. Leave blank for
                      the standard OTOG text checker. Validators/checkers have
                      bounded execution and no network access; they compile
                      independently for each job.
                    </p>
                    <button className={primary} disabled={action.isPending}>
                      Freeze bundle and validate
                    </button>
                  </form>
                  <button
                    className={button}
                    onClick={() => {
                      setName(c.name)
                      setStart(local(c.timeStart))
                      setEnd(local(c.timeEnd))
                      setSettings(c.settings)
                    }}
                  >
                    Load draft schedule and scoring settings
                  </button>
                  {name && (
                    <ContestForm
                      onSubmit={saveContest}
                      name={name}
                      setName={setName}
                      start={start}
                      setStart={setStart}
                      end={end}
                      setEnd={setEnd}
                      settings={settings}
                      setSettings={setSettings}
                      pending={action.isPending}
                    />
                  )}
                </>
              )}
              <section className={`${panel} overflow-x-auto`}>
                <h2 className="mb-4 text-lg font-semibold">
                  Validation and judging jobs
                </h2>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      {['#', 'Problem', 'Job', 'Phase', 'Result', 'Action'].map(
                        (h) => (
                          <th className="p-2" key={h}>
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.data?.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="p-2">{r.id}</td>
                        <td className="p-2">{r.letter}</td>
                        <td className="p-2">{r.kind}</td>
                        <td className="p-2">{r.phase}</td>
                        <td className="p-2">{verdict(r)}</td>
                        <td className="p-2">
                          <button
                            className={button}
                            disabled={logAction.isPending}
                            onClick={() => logAction.mutate(r.id)}
                          >
                            Details
                          </button>{' '}
                          {r.status === 'judgeError' && (
                            <button
                              className={button}
                              disabled={action.isPending}
                              onClick={() =>
                                invoke(`/admin/${id}/retry/${r.id}`)
                              }
                            >
                              Retry infrastructure failure
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              {jobLog && (
                <section className={panel}>
                  <div className="flex justify-between">
                    <h2 className="font-semibold">Job details</h2>
                    <button className={button} onClick={() => setJobLog('')}>
                      Close
                    </button>
                  </div>
                  <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-muted p-4 text-xs">
                    {jobLog}
                  </pre>
                </section>
              )}
            </>
          )}
        </>
      )}
    </CfLayout>
  )
}
function ContestForm({
  onSubmit,
  name,
  setName,
  start,
  setStart,
  end,
  setEnd,
  settings,
  setSettings,
  pending,
}: any) {
  return (
    <form onSubmit={onSubmit} className={`${panel} space-y-4`}>
      <h2 className="text-lg font-semibold">Contest schedule and scoring</h2>
      <label className="block text-sm">
        Contest name
        <input
          required
          maxLength={200}
          className={field}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          Starts (your local time)
          <input
            required
            type="datetime-local"
            className={field}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Ends (your local time)
          <input
            required
            type="datetime-local"
            className={field}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {Object.entries({
          wrongPenalty: 'Wrong-attempt penalty',
          minimumFraction: 'Minimum point fraction (0–1)',
          decayMinutes: 'Decay denominator (minutes)',
          successfulHackPoints: 'Successful hack points',
          unsuccessfulHackPenalty: 'Unsuccessful hack penalty',
        }).map(([key, label]) => (
          <label key={key} className="block text-sm">
            {label}
            <input
              required
              type="number"
              min={0}
              max={key === 'minimumFraction' ? 1 : 100000}
              step={key === 'minimumFraction' ? 0.01 : 1}
              className={field}
              value={settings[key]}
              onChange={(e) =>
                setSettings({ ...settings, [key]: Number(e.target.value) })
              }
            />
          </label>
        ))}
      </div>
      <button className={primary} disabled={pending}>
        Save draft contest
      </button>
    </form>
  )
}
