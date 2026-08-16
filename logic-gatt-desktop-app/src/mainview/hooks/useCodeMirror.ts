import { useRef, useEffect } from 'react'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { javascript, javascriptLanguage, scopeCompletionSource } from '@codemirror/lang-javascript'
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { basicSetup } from 'codemirror'

export function useCodeMirror(
  ref: React.RefObject<HTMLDivElement | null>,
  code: string,
  onUpdate: (code: string) => void,
  completionSource: (ctx: CompletionContext) => CompletionResult | null,
  theme: Extension
) {
  const viewRef = useRef<EditorView | null>(null)
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate
  const completionSourceRef = useRef(completionSource)
  completionSourceRef.current = completionSource
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
          keymap.of([indentWithTab, ...defaultKeymap]),
          // Built-in JS completions (Math, console, Array, etc.)
          javascriptLanguage.data.of({
            autocomplete: scopeCompletionSource(globalThis),
          }),
          // Custom completions (ctx, input, user functions, snippets)
          javascriptLanguage.data.of({
            autocomplete: (ctx: CompletionContext) => completionSourceRef.current(ctx),
          }),
          autocompletion({
            activateOnTyping: true,
            icons: true,
          }),
          EditorView.updateListener.of(update => {
            if (update.docChanged) {
              onUpdateRef.current(update.state.doc.toString())
            }
          }),
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

  return viewRef
}
