export function isSafeLink(value: string) {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(value, 'https://otog.invalid').protocol)
  } catch {
    return false
  }
}
