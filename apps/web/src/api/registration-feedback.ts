export const registrationMessages = {
  pending: 'กำลังลงทะเบียน...',
  slow: 'กำลังรอการตอบกลับจากเซิร์ฟเวอร์ อาจมีผู้ใช้งานจำนวนมาก กรุณารอสักครู่...',
  busy: 'กรุณารอสักครู่แล้วลองใหม่',
  limited: 'มีการลงทะเบียนมากเกินไป กรุณาลองใหม่ภายหลัง',
  conflict: 'ชื่อผู้ใช้หรือชื่อที่ใช้แสดงนี้ถูกใช้แล้ว กรุณาเลือกชื่ออื่น',
  unavailable: 'ลงทะเบียนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
} as const

export function registrationErrorMessage(error: unknown): string {
  const failure = error as { status?: number; name?: string } | null
  if (failure?.status === 429) return registrationMessages.limited
  if ([408, 503, 504].includes(failure?.status ?? 0) ||
      failure?.name === 'TimeoutError' || failure?.name === 'AbortError') {
    return registrationMessages.busy
  }
  if (failure?.status === 409) return registrationMessages.conflict
  return registrationMessages.unavailable
}
