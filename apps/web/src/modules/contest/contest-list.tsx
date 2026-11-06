import { useMemo, useState } from 'react'

import { useQuery } from '@tanstack/react-query'
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import NextLink from 'next/link'

import { Contest } from '@otog/database'
import { Link } from '@otog/ui/link'

import { contestKey } from '../../api/query'
import {
  TableComponent,
  TablePaginationInfo,
} from '../../components/table-component'
import { toThaiDuration } from '../../utils/time'

export const ContestList = () => {
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 10,
  })
  const listContest = useQuery(
    contestKey.listContest({
      query: {
        limit: pagination.pageSize,
        skip: pagination.pageIndex * pagination.pageSize,
      },
    })
  )
  const { data, total } = useMemo(
    () =>
      listContest.data?.status === 200
        ? listContest.data.body
        : { data: [], total: 0 },
    [listContest.data]
  )

  const table = useReactTable({
    data,
    columns,
    state: { pagination },
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id.toString(),
    onPaginationChange: setPagination,
    manualPagination: true,
    rowCount: total,
  })
  return (
    <>
      <TableComponent
        table={table}
        isLoading={listContest.isLoading}
        isError={listContest.isError}
      />
      <div className="flex justify-end">
        <TablePaginationInfo table={table} isLoading={listContest.isLoading} />
      </div>
    </>
  )
}

const columnHelper = createColumnHelper<Contest>()
const columns = [
  columnHelper.accessor('id', {
    header: '#',
    enableSorting: false,
  }),
  columnHelper.accessor('name', {
    header: 'การแข่งขัน',
    cell: ({ getValue, row }) => (
      <Link asChild className="block">
        <NextLink href={`/contest/${row.original.id}`}>{getValue()}</NextLink>
      </Link>
    ),
    enableSorting: false,
  }),
  columnHelper.accessor('mode', {
    header: 'โหมด',
    enableSorting: false,
    meta: {
      cellClassName: 'capitalize',
    },
  }),
  columnHelper.display({
    header: 'ระยะเวลา',
    cell: ({ row }) => {
      return (
        toThaiDuration(
          new Date(row.original.timeEnd).getTime() -
            new Date(row.original.timeStart).getTime()
        ) || '-'
      )
    },
    enableSorting: false,
  }),
]
