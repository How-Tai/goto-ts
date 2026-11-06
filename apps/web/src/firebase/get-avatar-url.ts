import { api } from '../api'

export type AvatarSize = 'default' | 'small'
export interface AvatarKey {
  userId: number
  size?: AvatarSize
}
export async function getAvatarUrl({ userId, size = 'default' }: AvatarKey) {
  const response = await api.get(`/user/avatar/${userId}?size=${size}`).json<{ url: string | null }>()
  return response.url
}
