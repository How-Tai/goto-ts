import type { client } from './browser'

export function uploadAvatar(http: typeof client, file: File, targetUserId?: number) {
  return http.url(targetUserId === undefined ? '/user/avatar' : `/user/avatar/${targetUserId}`).formData({ file }).post().json()
}

export function removeAvatar(http: typeof client, targetUserId?: number) {
  return http.url(targetUserId === undefined ? '/user/avatar' : `/user/avatar/${targetUserId}`).delete().json()
}
