import { StatementViewer } from '../../components/statement-viewer'
import { FormEvent, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'

import { useUserContext } from '../../context/user-context'
import { CfLayout, ErrorBox, verdict } from './area'
import { button, cfApi, field, panel, primary } from './client'

const empty = {
  name: '',
  sname: '',
  timeLimit: '1000',
  memoryLimit: '256',
  score: '100',
  case: '',
}
export function CfProblemSet({
  id,
  admin = false,
}: {
  id?: number
  admin?: boolean
}) {
  const { user, isAdmin } = useUserContext(),
    client = useQueryClient()
  const [search, setSearch] = useState(''),
    [skip, setSkip] = useState(0)
  const [form, setForm] = useState(empty),
    [editId, setEditId] = useState<number>()
  const [importId, setImportId] = useState(''),
    [message, setMessage] = useState('')
  const [source, setSource] = useState(''),
    [language, setLanguage] = useState('cpp')
  const allowed = !admin || isAdmin
  const list = useQuery({
    queryKey: ['cf', 'catalog', admin, search, skip, user?.id],
    queryFn: ({ signal }) =>
      cfApi(
        `${admin ? '/admin/problems' : '/problemset'}?search=${encodeURIComponent(search)}&skip=${skip}`,
        undefined,
        signal
      ),
    enabled: allowed && !id,
  })
  const detail = useQuery({
    queryKey: ['cf', 'catalog-problem', id, user?.id],
    queryFn: ({ signal }) => cfApi(`/problemset/${id}`, undefined, signal),
    enabled: allowed && !!id,
  })
  const jobs = useQuery({
    queryKey: ['cf', 'practice', id, user?.id],
    queryFn: ({ signal }) =>
      cfApi<any[]>(`/problemset/${id}/submissions`, undefined, signal),
    enabled: !!id && !!user,
    refetchInterval: 3500,
    refetchIntervalInBackground: false,
  })
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) =>
      cfApi(path, body),
    onSuccess: (r) => {
      setMessage(
        r.importedFrom
          ? `Created independent ${r.area === 'otog' ? 'OTOG' : 'CF'} problem #${r.id}. It starts private.`
          : r.id
            ? `Saved #${r.id}.`
            : r.migrated
              ? `Separated ${r.migrated.length} existing problem links. Original OTOG problems were preserved.`
              : 'Saved.'
      )
      void client.invalidateQueries({ queryKey: ['cf'] })
    },
  })
  function invoke(path: string, body: unknown) {
    setMessage('')
    action.mutate({ path, body })
  }
  function save(e: FormEvent) {
    e.preventDefault()
    invoke(`/admin/problems${editId ? '/' + editId : ''}`, {
      ...form,
      timeLimit: Number(form.timeLimit),
      memoryLimit: Number(form.memoryLimit),
      score: Number(form.score),
    })
  }
  const p = detail.data
  return (
    <CfLayout
      title={admin ? 'Manage CF problems' : p?.name || 'CF problem set'}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          {admin ? 'Manage CF problems' : p?.name || 'CF problem set'}
        </h1>
        <Link
          className={button}
          href={
            admin || !isAdmin
              ? '/codeforces/problemset'
              : '/admin/codeforces/problems'
          }
        >
          {admin
            ? 'Public problem set'
            : isAdmin
              ? 'Manage problems'
              : 'Problem set'}
        </Link>
      </div>
      {!allowed ? (
        <p>Administrator access required.</p>
      ) : (
        <>
          <ErrorBox
            error={list.error || detail.error || jobs.error || action.error}
          />
          {message && (
            <p role="status" className={panel}>
              {message}
            </p>
          )}
          {!id && (
            <>
              <label className="block">
                Search CF problems
                <input
                  className={field}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    setSkip(0)
                  }}
                />
              </label>
              <section className={panel}>
                {list.isPending ? (
                  <p>Loading…</p>
                ) : list.data?.data.length ? (
                  list.data.data.map((row: any) => (
                    <div
                      key={row.id}
                      className="flex flex-wrap justify-between gap-3 border-b py-3"
                    >
                      <div>
                        <Link
                          href={`/codeforces/problemset/${row.id}`}
                          className="font-medium text-primary"
                        >
                          #{row.id} {row.name}
                        </Link>
                        <p className="text-sm text-muted-foreground">
                          {row.timeLimit} ms · {row.memoryLimit} MiB
                          {admin ? (row.show ? ' · Public' : ' · Private') : ''}
                        </p>
                      </div>
                      {admin && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            className={button}
                            onClick={() => {
                              setEditId(row.id)
                              setForm({
                                name: row.name,
                                sname: row.sname || '',
                                timeLimit: String(row.timeLimit),
                                memoryLimit: String(row.memoryLimit),
                                score: String(row.score || 100),
                                case: row.case || '',
                              })
                            }}
                          >
                            Edit / upload files
                          </button>
                          <button
                            className={button}
                            disabled={action.isPending}
                            onClick={() =>
                              invoke(`/admin/problems/${row.id}/visibility`, {
                                show: !row.show,
                              })
                            }
                          >
                            {row.show
                              ? 'Make private'
                              : 'Release to problem set'}
                          </button>
                          <button
                            className={button}
                            disabled={action.isPending}
                            onClick={() =>
                              invoke('/admin/problems/import', {
                                problemId: row.id,
                                destination: 'otog',
                              })
                            }
                          >
                            Copy to OTOG
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p>No CF problems found.</p>
                )}
                <div className="mt-4 flex gap-3">
                  <button
                    className={button}
                    disabled={skip === 0}
                    onClick={() => setSkip(Math.max(0, skip - 50))}
                  >
                    Previous
                  </button>
                  <button
                    className={button}
                    disabled={skip + 50 >= (list.data?.total || 0)}
                    onClick={() => setSkip(skip + 50)}
                  >
                    Next
                  </button>
                </div>
              </section>
            </>
          )}
          {admin && (
            <>
              <section className={`${panel} space-y-3`}>
                <h2 className="font-semibold">Existing CF contests</h2>
                <p>
                  Copy legacy OTOG links into independent CF problems while
                  preserving contest submissions and results. Wait for CF jobs
                  to finish before running this once.
                </p>
                <button
                  className={button}
                  disabled={action.isPending}
                  onClick={() => invoke('/admin/problems/migrate', {})}
                >
                  Separate existing CF problem links
                </button>
              </section>
              <form
                className={`${panel} space-y-3`}
                onSubmit={(e) => {
                  e.preventDefault()
                  invoke('/admin/problems/import', {
                    problemId: Number(importId),
                    destination: 'codeforces',
                  })
                }}
              >
                <h2 className="text-lg font-semibold">Import from OTOG</h2>
                <p>
                  Copy the statement, tests, helper files, attachments and
                  limits into a new private CF problem. Future edits stay
                  independent.
                </p>
                <label className="block">
                  OTOG problem ID
                  <input
                    required
                    type="number"
                    min="1"
                    className={field}
                    value={importId}
                    onChange={(e) => setImportId(e.target.value)}
                  />
                </label>
                <button className={primary} disabled={action.isPending}>
                  Copy into CF
                </button>
              </form>
              <form className={`${panel} space-y-4`} onSubmit={save}>
                <h2 className="text-lg font-semibold">
                  {editId ? `Edit CF #${editId}` : 'Create CF problem'}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      ['name', 'Name'],
                      ['sname', 'Short name'],
                      ['timeLimit', 'Time limit (ms)'],
                      ['memoryLimit', 'Memory limit (MiB)'],
                      ['score', 'OTOG export score'],
                      ['case', 'Test count / groups'],
                    ] as const
                  ).map(([key, label]) => (
                    <label className="block" key={key}>
                      {label}
                      <input
                        required={!['case', 'sname'].includes(key)}
                        className={field}
                        value={form[key]}
                        onChange={(e) =>
                          setForm({ ...form, [key]: e.target.value })
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="flex gap-3">
                  <button className={primary} disabled={action.isPending}>
                    Save problem
                  </button>
                  <button
                    type="button"
                    className={button}
                    onClick={() => {
                      setEditId(undefined)
                      setForm(empty)
                    }}
                  >
                    New problem
                  </button>
                </div>
              </form>
              {editId && (
                <form
                  className={`${panel} space-y-4`}
                  onSubmit={(e) => {
                    e.preventDefault()
                    const data = new FormData(e.currentTarget)
                    for (const [key, value] of Array.from(data.entries()))
                      if (value instanceof File && !value.size) data.delete(key)
                    invoke(`/admin/problems/${editId}/files`, data)
                  }}
                >
                  <h2 className="text-lg font-semibold">
                    Upload files for CF #{editId}
                  </h2>
                  <label className="block">
                    Thai statement PDF
                    <input
                      type="file"
                      name="pdfTh"
                      accept=".pdf"
                      className={field}
                    />
                  </label>
                  <label className="block">
                    English statement PDF
                    <input
                      type="file"
                      name="pdfEn"
                      accept=".pdf"
                      className={field}
                    />
                  </label>
                  <label className="block">
                    Testcase ZIP
                    <input
                      type="file"
                      name="zip"
                      accept=".zip"
                      className={field}
                    />
                  </label>
                  <label className="block">
                    Starter files for contestants (ZIP, up to 16 MiB)
                    <input
                      type="file"
                      name="attachment"
                      accept=".zip"
                      className={field}
                    />
                  </label>
                  <p className="text-sm">
                    Use numbered .in/.sol pairs. Include grader.cpp and headers
                    for library tasks. Files replace the catalog copy; existing
                    contest bundles stay frozen.
                  </p>
                  <button className={primary} disabled={action.isPending}>
                    Upload
                  </button>
                </form>
              )}
            </>
          )}
          {p && (
            <>
              <div className={panel}>
                <p>
                  {p.timeLimit} ms · {p.memoryLimit} MiB ·{' '}
                  {p.taskType === 'library'
                    ? 'C++ library task'
                    : 'Batch problem'}
                </p>
                <StatementViewer key={`/backend/codeforces/statement/${id}`} url={`/backend/codeforces/statement/${id}`} title={`${p.name} statement`}>
{p.attachmentMetadata && (
                  <a
                    className={`${button} ml-2`}
                    href={`/backend/codeforces/attachment/${id}`}
                  >
                    Download starter files
                  </a>
                )}
</StatementViewer>
              </div>
              {p.canPractice ? (
                user ? (
                  <form
                    className={`${panel} space-y-4`}
                    onSubmit={(e) => {
                      e.preventDefault()
                      invoke(`/problemset/${id}/submit`, {
                        problemId: id,
                        language: p.taskType === 'library' ? 'cpp' : language,
                        sourceCode: source,
                        requestId: crypto.randomUUID(),
                      })
                    }}
                  >
                    <h2 className="text-lg font-semibold">
                      Practice submission
                    </h2>
                    <select
                      aria-label="Language"
                      className={field}
                      value={p.taskType === 'library' ? 'cpp' : language}
                      onChange={(e) => setLanguage(e.target.value)}
                    >
                      <option value="cpp">GNU C++17</option>
                      {p.taskType !== 'library' && (
                        <>
                          <option value="c">GNU C17</option>
                          <option value="python">Python 3</option>
                        </>
                      )}
                    </select>
                    <textarea
                      aria-label="Source code"
                      required
                      spellCheck={false}
                      maxLength={64000}
                      rows={14}
                      className={`${field} font-mono`}
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                    />
                    <button className={primary} disabled={action.isPending}>
                      Submit practice solution
                    </button>
                  </form>
                ) : (
                  <p>Log in to submit practice solutions.</p>
                )
              ) : (
                <p>
                  Practice opens after a validated contest bundle finishes
                  system testing.
                </p>
              )}
              {user && (
                <section className={panel}>
                  <h2 className="font-semibold">Your practice submissions</h2>
                  {jobs.data?.map((r) => (
                    <p className="border-t py-3" key={r.id}>
                      #{r.id} · {verdict(r)}
                    </p>
                  ))}
                </section>
              )}
            </>
          )}
        </>
      )}
    </CfLayout>
  )
}
