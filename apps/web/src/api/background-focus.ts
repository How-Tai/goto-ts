import { scheduleBackground } from './background-schedule'

// Coalesce repeated visibility events and avoid every returning browser
// refetching its stale queries in the same instant.
export function backgroundFocusListener(onFocus: (focused: boolean) => void) {
  let cancel = () => {}
  const visibility = () => {
    cancel()
    if (document.visibilityState === 'hidden') onFocus(false)
    else cancel = scheduleBackground(() => onFocus(true))
  }
  document.addEventListener('visibilitychange', visibility)
  return () => { cancel(); document.removeEventListener('visibilitychange', visibility) }
}
