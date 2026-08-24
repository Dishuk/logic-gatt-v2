/**
 * Shared modal behaviour: Escape closes, focus moves into the dialog on open and back
 * where it came from on close, and Tab cycles inside rather than wandering into the
 * page behind.
 *
 * Every modal in the app is an overlay div wrapping a panel div, and each had been
 * left to arrange this for itself — so Escape worked in three of them and not the
 * other three. Returns the ref to put on the panel.
 */

import { useEffect, useId, useRef } from 'react'

/** Things a person can Tab to. Mirrors the browser's own notion closely enough. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * Open dialogs, outermost first. Escape belongs to the last one: every dialog listens
 * on `document`, so stopping propagation there would not reach a sibling listener, and
 * the listeners run in the order they mounted — which is the wrong order.
 */
const stack: string[] = []

/**
 * Whether Tab can actually land on this element.
 *
 * Deliberately DOM-only rather than layout-based: `offsetParent`/`getClientRects` need
 * a layout engine, which the test environment has none of, and both would report every
 * control as unreachable there. Inline `display: none` is how this app hides collapsed
 * cards and inactive tabs, so checking for it covers the cases that arise.
 */
function isReachable(el: HTMLElement): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return false
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (node.hidden || node.style?.display === 'none') return false
  }
  return true
}

export function useModalDialog<T extends HTMLElement = HTMLDivElement>(onClose: () => void) {
  const panelRef = useRef<T>(null)
  const id = useId()

  // Read the callback through a ref: modals are usually given an inline arrow, which
  // would otherwise re-run the effects below on every render and yank focus back to
  // the top of the dialog mid-typing.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  // Mount only — take the top of the stack, focus in, and undo both on the way out.
  useEffect(() => {
    stack.push(id)
    const previous = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel)?.focus()

    return () => {
      const at = stack.lastIndexOf(id)
      if (at !== -1) stack.splice(at, 1)
      previous?.focus?.()
    }
  }, [id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Only the frontmost dialog reacts, so Escape in a nested one closes just that.
      if (stack[stack.length - 1] !== id) return

      if (e.key === 'Escape') {
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return

      const panel = panelRef.current
      if (!panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isReachable)
      if (items.length === 0) return

      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement

      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [id])

  return panelRef
}
