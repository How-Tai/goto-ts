import { ClientArgs } from '@ts-rest/core'
import { z } from 'zod'
import FormDataAddon from 'wretch/addons/formData'

import { LoginResponse } from '@otog/contract'

import { api } from '.'
import { authMiddleware, clearAccessToken, getAccessToken, setAccessToken } from './auth'
import { redirectToLogin } from './session-expiry'

let refreshInFlight: Promise<boolean> | null = null
const refreshAccessToken = () => {
  if (!refreshInFlight) {
    refreshInFlight = api
      .auth(`Bearer ${getAccessToken()}`)
      .get('/auth/refresh/token')
      .json<LoginResponse>()
      .then((response) => {
        setAccessToken(response.accessToken)
        return true
      })
      .catch((error) => {
        if (error.status !== 401 && error.status !== 403) throw error
        clearAccessToken()
        return false
      })
      .finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}

export const client = api
  .middlewares([authMiddleware])
  .addon(FormDataAddon)
  .catcher(401, async (error, req) => {
    if (!getAccessToken() && !refreshInFlight) {
      await redirectToLogin()
      throw error
    }
    const refreshed = await refreshAccessToken()
    if (!refreshed) {
      await redirectToLogin()
      throw error
    }
    return req.auth(`Bearer ${getAccessToken()}`).fetch()
      .unauthorized(async (failure) => {
        await redirectToLogin()
        throw failure
      }).res()
  })

export const clientArgs: ClientArgs = {
  baseUrl: '',
  jsonQuery: true,
  validateResponse: true,
  api: async ({
    path,
    method,
    headers,
    body,
    contentType,
    rawBody,
    route,
    validateResponse,
    fetchOptions,
  }) => {
    const fetcher =
      contentType === 'multipart/form-data'
        ? client.formData(rawBody as any)
        : client.body(body)
    return fetcher
      .options(fetchOptions ?? {})
      .headers(headers)
      .fetch(method, path)
      .res()
      .then(async (response) => {
        const json = await response.json()
        if (!validateResponse) {
          return {
            status: response.status,
            body: json,
            headers: response.headers,
          }
        }
        const schema = route.responses[response.status]
        if (!schema || !(schema instanceof z.ZodType)) {
          console.error("The route doesn't have zod parser")
          throw new Error("The route doesn't have zod parser")
        }
        const result = schema.safeParse(json)
        if (!result.success) {
          console.error('Client parsing failed', { cause: result.error })
          throw new Error('Client parsing failed')
        }
        return {
          status: response.status,
          body: result.data,
          headers: response.headers,
        }
      })
      .catch((error) => {
        return {
          status: error.status,
          body: error.json,
          headers: error.headers,
        }
      })
  },
}
