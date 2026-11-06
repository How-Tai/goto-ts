// import GoogleProvider from 'next-auth/providers/google'
import * as cookie from 'cookie'
import { JwtPayload, jwtDecode } from 'jwt-decode'
import { NextApiRequest, NextApiResponse } from 'next'
import NextAuth from 'next-auth'
import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { WretchResponse } from 'wretch'

import { LoginResponse, UserSchema } from '@otog/contract'

import { api, secure } from '../../../api'
import { environment } from '../../../env'
import { loginProviderError } from '../../../api/login-feedback'
import { authProxyHeaders } from '../../../api/auth-proxy'

interface ServerContext {
  req: {
    headers?: Record<string, string | string[] | undefined>
    socket?: { remoteAddress?: string }
    cookies: Partial<{
      [key: string]: string
    }>
  }
  res: {
    setHeader(
      name: string,
      value: number | string | ReadonlyArray<string>
    ): void
  }
}

class MissingRefreshSession extends Error {}

export function getAuthOptions(serverContext: ServerContext) {
  async function forwardSetCookie(response: WretchResponse) {
    const setCookie = response.headers.get('set-cookie')
    if (!setCookie) {
      throw new TypeError('No set-cookie')
    }
    const json: LoginResponse = await response.json()
    // console.info('setAccessToken on server', {
    //   accessToken: json.accessToken,
    //   setCookie,
    // })
    serverContext.res.setHeader('set-cookie', [
      setCookie,
      cookie.serialize('accessToken', json.accessToken, {
        secure: secure,
        path: '/',
        sameSite: 'lax',
      }),
    ])
    return json
  }

  async function refreshAccessToken(accessToken: string) {
    const RID = serverContext.req.cookies['RID']
    if (!RID) {
      throw new MissingRefreshSession('No RID')
    }
    // console.info('accessToken expired', { accessToken, RID })
    return await api
      .auth(`Bearer ${accessToken}`)
      .headers({
        cookie: cookie.serialize('RID', RID, {
          httpOnly: true,
          secure: secure,
        }),
      })
      .get('/auth/refresh/token')
      .res(forwardSetCookie)
  }

  const authOptions: NextAuthOptions = {
    secret: environment.NEXTAUTH_SECRET,
    pages: {
      signIn: '/login',
    },
    providers: [
      // GoogleProvider({
      //   clientId: process.env.GOOGLE_CLIENT_ID as string,
      //   clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      // }),
      CredentialsProvider({
        id: 'otog',
        name: 'OTOG',
        credentials: {
          // accessToken: { label: 'accessToken', type: 'text' },
          username: { label: 'Username', type: 'text' },
          password: { label: 'Password', type: 'password' },
        },
        async authorize(credentials) {
          try {
            return await api
              .options({ signal: AbortSignal.timeout(35000) })
              .url('/auth/login')
              .headers(authProxyHeaders(serverContext.req))
              .post(credentials)
              .res(forwardSetCookie)
          } catch (error) {
            const code = loginProviderError(error)
            if (code === 'CredentialsSignin') return null
            throw new Error(code)
          }
        },
      }),
    ],
    callbacks: {
      async session({ session, token }) {
        // console.log('session', session, token)
        return { ...session, ...token }
      },
      async jwt({ token, user, account, trigger, session }) {
        if (account?.provider === 'otog') {
          return { ...token, ...user, error: undefined }
        }
        // useSyncAccessToken: when accessToken is refresh on client side
        if (trigger === 'update' && session?.accessToken) {
          // console.log('update', session.accessToken.at(-1))
          token = { ...token, accessToken: session.accessToken, error: undefined }
        }
        if (token.error === 'RefreshAccessTokenError') return token
        if (token.accessToken) {
          const accessToken = token.accessToken as string
          let exp: number | undefined
          try {
            exp = jwtDecode<JwtPayload>(accessToken).exp
            if (typeof exp !== 'number' || !Number.isFinite(exp)) throw new TypeError('No expiry')
          } catch {
            return { ...token, error: 'RefreshAccessTokenError' }
          }
          if (exp * 1000 <= Date.now()) {
            try {
              const result = await refreshAccessToken(accessToken)
              return { ...token, ...result, error: undefined }
            } catch (error) {
              const status = (error as { status?: number })?.status
              return {
                ...token,
                error: error instanceof MissingRefreshSession || status === 401 || status === 403
                  ? 'RefreshAccessTokenError' : 'RefreshAccessTokenUnavailable',
              }
            }
          }
        }
        return token
      },
    },
  }
  return authOptions
}

export default async function auth(req: NextApiRequest, res: NextApiResponse) {
  const authOptions = getAuthOptions({ req, res })
  return await NextAuth(req, res, authOptions)
}

export type AccessTokenPayload = UserSchema
export function getUserData(accessToken: string): AccessTokenPayload {
  const { id, username, showName, role, rating, showInLeaderboard } = jwtDecode<
    AccessTokenPayload & JwtPayload
  >(accessToken)
  return { id, username, showName, role, rating, showInLeaderboard: showInLeaderboard ?? true }
}
