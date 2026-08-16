import { useRef, useEffect } from 'react'
import { EditorView } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { basicSetup } from 'codemirror'

/**
 * Read-only, syntax-highlighted code viewer — the same CodeMirror setup the
 * editable function editor and the Settings theme preview use, minus editing.
 */
export function CodeBlock({
  code,
  theme,
  className = 'api-code',
}: {
  code: string
  theme: Extension
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeCompartment = useRef(new Compartment())

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const view = new EditorView({
      state: EditorState.create({
        doc: code,
        extensions: [
          basicSetup,
          javascript(),
          themeCompartment.current.of(theme),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
        ],
      }),
      parent: el,
    })

    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: themeCompartment.current.reconfigure(theme) })
  }, [theme])

  return <div ref={ref} className={className} />
}
