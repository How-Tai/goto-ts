import { useRouter } from 'next/router'

import { CfLayout, Contest, ContestList } from '../../modules/codeforces/area'
import { CfProblemSet } from '../../modules/codeforces/catalog'

export { getServerSideProps } from '../../api/server'
export default function CodeforcesPage() {
  const router = useRouter(),
    route = router.query.route as string[] | undefined
  if (!route?.length) return <ContestList />
  if (route[0] === 'problemset' && route.length <= 2 && (route.length === 1 || /^[1-9][0-9]*$/.test(route[1]!)))
    return <CfProblemSet key={route.join('/')} id={route[1] ? Number(route[1]) : undefined} />
  const id = Number(route[1]),
    tab = route[2] || ''
  if (
    route[0] !== 'contest' ||
    !Number.isSafeInteger(id) ||
    id < 1 ||
    !['', 'problem', 'submissions', 'standings', 'hacks'].includes(tab) ||
    route.length > (tab === 'problem' ? 4 : 3)
  )
    return (
      <CfLayout>
        <p>Page not found.</p>
      </CfLayout>
    )
  return (
    <Contest
      key={`${id}:${tab}:${route[3] || ''}`}
      id={id}
      tab={tab}
      letter={route[3]}
    />
  )
}
CodeforcesPage.footer = false
