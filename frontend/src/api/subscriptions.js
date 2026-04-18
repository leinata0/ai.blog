import { apiGet, apiPost } from './client'

export function fetchSubscriptionStatus(requestOptions = {}) {
  return apiGet('/api/subscriptions/status', requestOptions)
}

export function subscribeEmail(payload, requestOptions = {}) {
  return apiPost('/api/subscriptions/email', payload, {
    ...requestOptions,
    invalidatePaths: requestOptions.invalidatePaths ?? ['/api/subscriptions/status', '/api/home/modules'],
  })
}

export function unsubscribeEmail(payload, requestOptions = {}) {
  return apiPost('/api/subscriptions/email/unsubscribe', payload, {
    ...requestOptions,
    invalidatePaths: requestOptions.invalidatePaths ?? ['/api/subscriptions/status', '/api/home/modules'],
  })
}

export function fetchWebPushPublicKey(requestOptions = {}) {
  return apiGet('/api/subscriptions/web-push/public-key', requestOptions)
}

export function subscribeWebPush(payload, requestOptions = {}) {
  return apiPost('/api/subscriptions/web-push', payload, {
    ...requestOptions,
    invalidatePaths: requestOptions.invalidatePaths ?? ['/api/subscriptions/status', '/api/home/modules'],
  })
}

export function unsubscribeWebPush(payload, requestOptions = {}) {
  return apiPost('/api/subscriptions/web-push/unsubscribe', payload, {
    ...requestOptions,
    invalidatePaths: requestOptions.invalidatePaths ?? ['/api/subscriptions/status', '/api/home/modules'],
  })
}
