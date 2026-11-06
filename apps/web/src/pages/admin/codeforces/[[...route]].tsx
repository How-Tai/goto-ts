import { useRouter } from 'next/router'

import { withSession } from '../../../api/server'
import { CfAdmin } from '../../../modules/codeforces/admin'

export const getServerSideProps = withSession(({ session }) =>
  !session
    ? { redirect: { destination: '/login', permanent: false } }
    : session.user.role !== 'admin'
      ? { redirect: { destination: '/codeforces', permanent: false } }
      : { props: {} }
)
export default function CfAdminPage() {
  const router = useRouter(),
    route = router.query.route as string[] | undefined
  const id = route?.length ? Number(route[0]) : undefined
  if (route && (route.length > 1 || !Number.isSafeInteger(id) || !id || id < 1))
    return <p>Page not found.</p>
  return <CfAdmin key={id || 'list'} id={id} />
}
CfAdminPage.footer = false
