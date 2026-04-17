import { buildApiUrl } from '../api/base'

export function buildPublicApiUrl(path = '') {
  return buildApiUrl(path)
}
