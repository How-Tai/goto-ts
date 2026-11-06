import { AppRouter, ClientArgs, isAppRoute } from '@ts-rest/core'
import { TsRestReactQueryClient, initQueryClient } from '@ts-rest/react-query'

// SSR uses only a few routes. Keep this cache local to each request so its
// authentication callbacks can never be reused by another request.
export function lazyServerQuery<T extends AppRouter>(routes: T, args: ClientArgs): TsRestReactQueryClient<T, any> {
  const initialized = new Map<string, unknown>()
  return new Proxy(Object.create(null), {
    get(_target, key) {
      if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(routes, key)) return undefined
      if (!initialized.has(key)) {
        const route = routes[key]!
        initialized.set(key, isAppRoute(route)
          ? initQueryClient({ [key]: route }, args)[key]
          : lazyServerQuery(route, args))
      }
      return initialized.get(key)
    },
    ownKeys: () => Reflect.ownKeys(routes),
    getOwnPropertyDescriptor: (_target, key) => Object.prototype.hasOwnProperty.call(routes, key)
      ? { configurable: true, enumerable: true } : undefined,
  }) as unknown as TsRestReactQueryClient<T, any>
}
