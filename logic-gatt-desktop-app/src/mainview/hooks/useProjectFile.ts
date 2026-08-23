/**
 * File operations for the project document: New, Open, Save, Save As, examples.
 *
 * Every action that would discard unsaved edits routes through `request`, which puts
 * up the Save / Discard / Cancel prompt first and only then runs the action. Saving
 * an untitled project detours through Save As and resumes the queued action after.
 *
 * The one gap: closing the window cannot be intercepted. Electrobun destroys the
 * webview before `beforeQuit` fires, so there is nothing left to prompt from.
 */

import { useCallback, useRef, useState } from 'react'
import { parseProject, serializeProject } from '../lib/schemaIO'
import { emptyProject, type UseProject } from './useProject'
import { rpc } from '../lib/rpc'

/** An action deferred until the unsaved-changes prompt is answered. */
export type PendingAction =
  | { kind: 'new' }
  | { kind: 'open' }
  | { kind: 'example'; preset: string; label: string }

function describe(action: PendingAction): string {
  switch (action.kind) {
    case 'new':
      return 'Starting a new project'
    case 'open':
      return 'Opening another project'
    case 'example':
      return `Loading ${action.label}`
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useProjectFile(project: UseProject, log: (msg: string) => void) {
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // Action to resume once an in-progress Save (via Save As) completes.
  const resumeRef = useRef<PendingAction | null>(null)

  const { loadProject, markSaved, projectRef } = project

  /** Write the current document to `path`, keeping the saved snapshot in step. */
  const writeTo = useCallback(
    async (path: string): Promise<boolean> => {
      const contents = serializeProject(projectRef.current)
      setBusy(true)
      try {
        await rpc.request.writeProjectFile({ path, contents })
        markSaved(path, contents)
        log(`Saved ${path}`)
        return true
      } catch (err) {
        log(`Save failed: ${errText(err)}`)
        return false
      } finally {
        setBusy(false)
      }
    },
    [projectRef, markSaved, log]
  )

  const runOpen = useCallback(async () => {
    setBusy(true)
    try {
      const file = await rpc.request.openProjectFile()
      if (!file) return
      const data = parseProject(file.contents)
      loadProject(data, file.path)
      log(
        `Opened ${file.path}: ${data.services.length} service(s), ${data.functions.length} function(s), ${data.variables.length} variable(s), ${data.tests.length} test(s), ${data.scenarios.length} scenario(s)`
      )
    } catch (err) {
      log(`Open failed: ${errText(err)}`)
    } finally {
      setBusy(false)
    }
  }, [loadProject, log])

  const runExample = useCallback(
    async (preset: string, label: string) => {
      try {
        const json = await rpc.request.getPreset({ name: preset })
        loadProject(parseProject(JSON.stringify(json)))
        log(`Loaded example: ${label}`)
      } catch (err) {
        log(`Failed to load example: ${errText(err)}`)
      }
    },
    [loadProject, log]
  )

  const runAction = useCallback(
    async (action: PendingAction) => {
      switch (action.kind) {
        case 'new':
          loadProject(emptyProject())
          log('New project')
          return
        case 'open':
          await runOpen()
          return
        case 'example':
          await runExample(action.preset, action.label)
      }
    },
    [loadProject, log, runOpen, runExample]
  )

  /** Run `action`, prompting first when the document has unsaved edits. */
  const request = useCallback(
    (action: PendingAction) => {
      if (project.isDirty) setPending(action)
      else void runAction(action)
    },
    [project.isDirty, runAction]
  )

  /** Save to the known path, or fall through to Save As when untitled. */
  const save = useCallback(async (): Promise<boolean> => {
    if (project.currentPath) return writeTo(project.currentPath)
    setSaveAsOpen(true)
    return false
  }, [project.currentPath, writeTo])

  /** Called by the Save As modal once it has a resolved, confirmed path. */
  const completeSaveAs = useCallback(
    async (path: string) => {
      const ok = await writeTo(path)
      if (!ok) return
      setSaveAsOpen(false)
      const queued = resumeRef.current
      resumeRef.current = null
      if (queued) void runAction(queued)
    },
    [writeTo, runAction]
  )

  const cancelSaveAs = useCallback(() => {
    setSaveAsOpen(false)
    resumeRef.current = null
  }, [])

  // --- Answers to the unsaved-changes prompt ---

  const confirmSave = useCallback(async () => {
    const action = pending
    setPending(null)
    if (!action) return
    if (!project.currentPath) {
      // Untitled: Save As has to resolve a path first, then the action resumes.
      resumeRef.current = action
      setSaveAsOpen(true)
      return
    }
    if (await writeTo(project.currentPath)) void runAction(action)
  }, [pending, project.currentPath, writeTo, runAction])

  const confirmDiscard = useCallback(() => {
    const action = pending
    setPending(null)
    if (action) void runAction(action)
  }, [pending, runAction])

  const confirmCancel = useCallback(() => setPending(null), [])

  return {
    busy,
    // Unsaved-changes prompt
    pending,
    pendingLabel: pending ? describe(pending) : '',
    confirmSave,
    confirmDiscard,
    confirmCancel,
    // Save As modal
    saveAsOpen,
    completeSaveAs,
    cancelSaveAs,
    // Actions
    requestNew: () => request({ kind: 'new' }),
    requestOpen: () => request({ kind: 'open' }),
    requestExample: (preset: string, label: string) => request({ kind: 'example', preset, label }),
    save,
    saveAs: () => setSaveAsOpen(true),
  }
}

export type UseProjectFile = ReturnType<typeof useProjectFile>
