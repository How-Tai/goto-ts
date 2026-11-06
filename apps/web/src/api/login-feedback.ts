export const loginMessages = {
  pending: 'กำลังลงชื่อเข้าใช้...',
  slow: 'กำลังรอการตอบกลับจากเซิร์ฟเวอร์ อาจมีผู้ใช้งานจำนวนมาก กรุณารอสักครู่...',
  busy: 'กรุณารอสักครู่แล้วลองใหม่',
  limited: 'มีการพยายามเข้าสู่ระบบมากเกินไป กรุณารอ 1 นาทีแล้วลองใหม่',
  invalid: 'ชื่อผู้ใช้ หรือ รหัสผ่าน ไม่ถูกต้อง',
  unavailable: 'ไม่สามารถเข้าสู่ระบบได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง',
} as const

export function loginProviderError(error: unknown) {
  const failure = error as { status?: number; name?: string } | null
  if ([401, 403, 404].includes(failure?.status ?? 0)) return 'CredentialsSignin'
  if (failure?.status === 429) return 'TooManyRequests'
  if ([408, 503, 504].includes(failure?.status ?? 0) ||
    failure?.name === 'TimeoutError' || failure?.name === 'AbortError') return 'ServerBusy'
  return 'LoginUnavailable'
}

export function loginOutcome(response?: { error?: string | null; status?: number; ok?: boolean }) {
  // NextAuth wraps credential-provider errors in HTTP 401. Read the stable
  // error code first so overload never becomes a wrong-password message.
  if (response?.error) {
    if (response.error === 'ServerBusy') return 'busy'
    if (response.error === 'TooManyRequests') return 'limited'
    if (response.error === 'CredentialsSignin') return 'invalid'
    return 'unavailable'
  }
  if (response?.status === 401) return 'invalid'
  if (response?.status === 429) return 'limited'
  if ([408, 503, 504].includes(response?.status ?? 0)) return 'busy'
  return response?.ok ? 'success' : 'unavailable'
}
