import { ShortLivedCache } from './short-lived-cache'

// Database row versions form part of each key. The cache holds metadata only;
// access rules, current time and personal submissions are always read freshly.
const caches = new WeakMap<object, Map<string, ShortLivedCache<unknown>>>()
export function pageMetadata<T>(database: object, key: string, load: () => Promise<T>): Promise<T> {
  let entries = caches.get(database)
  if (!entries) { entries = new Map(); caches.set(database, entries) }
  let cache = entries.get(key)
  if (!cache) {
    if (entries.size >= 128) entries.delete(entries.keys().next().value!)
    cache = new ShortLivedCache<unknown>(10000)
  } else entries.delete(key)
  entries.set(key, cache)
  return cache.get(load) as Promise<T>
}
