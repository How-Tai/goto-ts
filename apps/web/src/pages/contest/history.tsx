import Head from 'next/head'
import { ContestList } from '../../modules/contest/contest-list'

export { getServerSideProps } from '../../api/server'

export default function ContestHistoryPage() {
  return (
    <main className="container max-w-4xl flex-1 flex flex-col gap-4 py-8" id="content">
      <Head><title>Contest History | OTOG</title></Head>
      <h1 className="font-heading text-2xl font-semibold">ประวัติการแข่งขัน</h1>
      <ContestList />
    </main>
  )
}
