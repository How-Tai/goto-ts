import { useEffect, useMemo } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { createColumnHelper, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import dayjs from 'dayjs'
import type { SubmissionSchema } from '@otog/contract'
import { contestKey, submissionKey, submissionQuery } from '../../api/query'
import { InfiniteTable } from '../../components/infinite-table'
import { InlineComponent } from '../../components/inline-component'
import { SubmissionDialogButton } from '../../components/submission-dialog'
import { SubmissionScoreBadge, useSubmissionPolling } from '../../components/submission-table'
import { useUserContext } from '../../context/user-context'

interface ContestSubmissionTableProps {
  contestId: number
  problemId: number
}
export default function ContestSubmissionTable(props: ContestSubmissionTableProps) {
  const { user } = useUserContext()
  const pageSize = 89
  const getContestSubmissions = useInfiniteQuery({
    queryKey: submissionKey.getContestSubmissions({
      params: { contestId: props.contestId.toString() },
      query: {
        problemId: props.problemId,
        userId: user?.id!,
      },
    }).queryKey,
    // TODO: https://github.com/lukemorales/query-key-factory/issues/89
    queryFn: ({ pageParam }) =>
      submissionQuery.getContestSubmissions.query({
        params: { contestId: props.contestId.toString() },
        query: {
          problemId: props.problemId,
          userId: user?.id!,
          offset: pageParam,
          limit: pageSize,
        },
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.status === 200 ? lastPage.body.at(-1)?.id : undefined,
    enabled: !!user,
  })
  const data = useMemo(
    () =>
      getContestSubmissions.data?.pages.flatMap((page) =>
        page.status === 200 ? page.body : []
      ) ?? [],
    [getContestSubmissions.data]
  )
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })
  return (
    <InfiniteTable
      table={table}
      classNames={{ container: 'border-transparent' }}
      isLoading={getContestSubmissions.isLoading}
      isError={getContestSubmissions.isError}
      hasNextPage={getContestSubmissions.hasNextPage}
      fetchNextPage={getContestSubmissions.fetchNextPage}
    />
  )
}

const columnHelper = createColumnHelper<SubmissionSchema>()
const columns = [
  columnHelper.accessor('creationDate', {
    header: 'ส่งเมื่อ',
    cell: ({ getValue }) => dayjs(getValue()).format('DD/MM/BB HH:mm'),
    meta: { cellClassName: 'text-muted-foreground tabular-nums' },
    enableSorting: false,
  }),
  columnHelper.display({
    id: 'score',
    header: 'คะแนน',
    cell: ({ row: { original } }) => (
      <InlineComponent
        render={() => {
          const submission = useSubmissionPolling(original)
          return <SubmissionScoreBadge submission={submission} />
        }}
      />
    ),
    enableSorting: false,
    meta: {
      cellClassName:
        'max-w-[200px] min-w-[100px] whitespace-pre-wrap text-end tabular-nums',
      headClassName: 'text-end',
    },
  }),

  columnHelper.display({
    id: 'timeUsed',
    header: 'เวลาที่ใช้ (วินาที)',
    cell: ({ row: { original } }) => (
      <InlineComponent
        render={() => {
          const submission = useSubmissionPolling(original)
          return ((submission.submissionResult?.timeUsed ?? 0) / 1000).toFixed(
            3
          )
        }}
      />
    ),
    enableSorting: false,
    meta: {
      headClassName: 'text-end',
      cellClassName: 'text-end tabular-nums',
    },
  }),
  columnHelper.display({
    id: 'memUsed',
    header: 'ความจำที่ใช้ (kB)',
    cell: ({ row: { original } }) => (
      <InlineComponent
        render={() => {
          const submission = useSubmissionPolling(original)
          const memUsed = submission.submissionResult?.memUsed ?? 0
          if (memUsed === -1) return '-'
          return memUsed
        }}
      />
    ),
    enableSorting: false,
    meta: {
      headClassName: 'text-end',
      cellClassName: 'text-end tabular-nums',
    },
  }),
  columnHelper.display({
    id: 'action',
    header: '',
    cell: ({ row: { original } }) => (
      <InlineComponent
        render={() => {
          const submission = useSubmissionPolling(original)
          const queryClient = useQueryClient()
          useEffect(() => {
            if (
              original.submissionResult?.score !==
              submission.submissionResult?.score
            ) {
              queryClient.invalidateQueries({
                queryKey: contestKey.getUserContestScores({
                  params: { contestId: submission.contestId?.toString()! },
                }).queryKey,
              })
            }
          }, [submission])
          return <SubmissionDialogButton submission={submission} />
        }}
      />
    ),
    enableSorting: false,
    meta: {
      cellClassName: 'text-end',
    },
  }),
]
