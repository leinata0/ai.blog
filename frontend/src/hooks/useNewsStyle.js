import { useEffect, useSyncExternalStore } from 'react'
import { applyDocumentNewsStyle } from '../utils/surface'

export const NEWS_STYLE_STORAGE_KEY = 'news-style'
const NEWS_STYLE_EVENT = 'blog:news-style-change'
let fallbackStyle = null

function normalizeStyle(value) {
  return value === 'paper' ? 'paper' : 'tech'
}

export function readNewsStyle() {
  if (fallbackStyle) return fallbackStyle
  if (typeof window === 'undefined') return 'tech'
  try {
    return normalizeStyle(window.localStorage.getItem(NEWS_STYLE_STORAGE_KEY))
  } catch {
    return normalizeStyle(document.documentElement.dataset.newsStyle)
  }
}

export function initializeNewsStyle() {
  const style = readNewsStyle()
  applyDocumentNewsStyle(style)
  return style
}

export function setNewsStyle(value) {
  const style = normalizeStyle(value)
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(NEWS_STYLE_STORAGE_KEY, style)
    fallbackStyle = null
  } catch {
    // A blocked storage area must not disable the visible comparison switch.
    fallbackStyle = style
  }
  applyDocumentNewsStyle(style)
  window.dispatchEvent(new Event(NEWS_STYLE_EVENT))
}

function subscribe(listener) {
  function onStorage(event) {
    if (event.key === NEWS_STYLE_STORAGE_KEY || event.key === null) {
      fallbackStyle = null
      listener()
    }
  }
  window.addEventListener(NEWS_STYLE_EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(NEWS_STYLE_EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useNewsStyle() {
  const newsStyle = useSyncExternalStore(subscribe, readNewsStyle, () => 'tech')
  useEffect(() => {
    applyDocumentNewsStyle(newsStyle)
  }, [newsStyle])
  return { newsStyle, setNewsStyle }
}
