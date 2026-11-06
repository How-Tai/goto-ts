import { withSession } from '../../../api/server'
import { CfProblemSet } from '../../../modules/codeforces/catalog'

export const getServerSideProps = withSession(({ session }) =>
  !session
    ? { redirect: { destination: '/login', permanent: false } }
    : session.user.role !== 'admin'
      ? { redirect: { destination: '/codeforces', permanent: false } }
      : { props: {} }
)
export default function CfProblemAdmin() {
  return <CfProblemSet admin />
}
CfProblemAdmin.footer = false
