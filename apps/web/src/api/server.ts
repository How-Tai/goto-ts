import { ClientArgs } from '@ts-rest/core'
import { serialize } from 'cookie'
import { TsRestReactQueryClient } from '@ts-rest/react-query'
import {
  GetServerSideProps,
  GetServerSidePropsContext,
  GetServerSidePropsResult,
} from 'next'
import { Session, getServerSession } from 'next-auth'
import { ParsedUrlQuery } from 'querystring'

import { router } from '@otog/contract'

import { api, secure } from '.'
import { getAuthOptions } from '../pages/api/auth/[...nextauth]'
import { lazyServerQuery } from './lazy-server-query'

type Context = GetServerSidePropsContext<ParsedUrlQuery>
const sessionCookie = /^(?:__Secure-)?next-auth\.session-token(?:\.\d+)?$/
const loginRedirect = { redirect: { destination: '/login', permanent: false as const } }

function clearServerSession(context: Context) {
  const names = new Set(['accessToken', 'RID', ...Object.keys(context.req.cookies).filter(name => sessionCookie.test(name))])
  const existing = context.res.getHeader('set-cookie')
  context.res.setHeader('set-cookie', [
    ...(typeof existing === 'string' ? [existing] : Array.isArray(existing) ? existing : []),
    ...[...names].map(name => serialize(name, '', {
      path: '/', maxAge: 0, expires: new Date(0), sameSite: 'lax',
      httpOnly: name !== 'accessToken', secure: name.startsWith('__Secure-') || secure,
    })),
  ])
  context.res.setHeader('Cache-Control', 'private, no-store')
}

async function resolveSession(context: Context) {
  const authOptions = getAuthOptions(context)
  let session = await getServerSession(context.req, context.res, authOptions)
  let invalid = (session as any)?.error === 'RefreshAccessTokenError'
    || !!session && !session.accessToken
    || !session && Object.keys(context.req.cookies).some(name => sessionCookie.test(name))
  const loginPage = context.resolvedUrl.split('?')[0] === '/login'
  // Recheck a stored, unexpired session before redirecting away from login.
  // This prevents revoked sessions from bouncing between login and the app.
  if (session && !invalid && loginPage && (session as any).error !== 'RefreshAccessTokenUnavailable') {
    try {
      await api.options({ signal: AbortSignal.timeout(5000) }).auth(`Bearer ${session.accessToken}`).get('/contest/now').res()
    } catch (error) {
      if ((error as { status?: number })?.status === 401) invalid = true
      else throw error
    }
  }
  if (invalid) {
    clearServerSession(context)
    session = null
  }
  return { session, invalid, loginPage }
}

export async function getServerSideProps(context: Context) {
  const { session, invalid, loginPage } = await resolveSession(context)
  if (invalid && !loginPage) return loginRedirect
  return { props: { session } }
}

export function withSession<
  P extends { [key: string]: any },
  T extends GetServerSidePropsResult<P> = GetServerSidePropsResult<P>,
>(
  callback: (args: {
    session: Session | null
    context: Context
  }) => Promise<T> | T
): GetServerSideProps<P> {
  return async (context) => {
    const { session, invalid, loginPage } = await resolveSession(context)
    if (invalid && !loginPage) return loginRedirect
    const result = await callback({ session, context })
    if ('props' in result) {
      return { props: { ...result.props, session } }
    }
    return result
  }
}

export function withQuery<
  P extends { [key: string]: any },
  T extends GetServerSidePropsResult<P> = GetServerSidePropsResult<P>,
>(
  callback: (args: {
    session: Session | null
    context: Context
    query: TsRestReactQueryClient<typeof router, any>
  }) => Promise<T> | T
): GetServerSideProps<P> {
  return async (context) => {
    const { session, invalid, loginPage } = await resolveSession(context)
    if (invalid && !loginPage) return loginRedirect
    let rejectedSession = false
    const clientArgs: ClientArgs = {
      baseUrl: '',
      jsonQuery: true,
      api: async ({ path, method, headers, body }) => {
        return api
          .auth(session ? `Bearer ${session.accessToken}` : '')
          .body(body)
          .headers(headers)
          .fetch(method, path)
          .res()
          .then(async (response) => {
            if (response.status === 401 && session && (session as any).error !== 'RefreshAccessTokenUnavailable') rejectedSession = true
            return {
              status: response.status,
              body: await response.json(),
              headers: response.headers,
            }
          })
          .catch((error) => {
            if (error.status === 401 && session && (session as any).error !== 'RefreshAccessTokenUnavailable') rejectedSession = true
            return {
              status: error.status,
              body: error.json,
              headers: error.headers,
            }
          })
      },
    }
    const query = lazyServerQuery(router, clientArgs)
    let result: T
    try {
      result = await callback({ session, context, query })
    } catch (error) {
      if (!rejectedSession) throw error
      clearServerSession(context)
      return loginRedirect
    }
    if (rejectedSession) {
      clearServerSession(context)
      return loginRedirect
    }
    if ('props' in result) {
      return { props: { ...result.props, session } }
    }
    return result
  }
}
