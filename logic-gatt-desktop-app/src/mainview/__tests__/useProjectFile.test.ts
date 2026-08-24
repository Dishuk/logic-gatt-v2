/**
 * Tests for the document lifecycle: dirty tracking, the unsaved-changes guard, and
 * the Save / Save As flow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useProject } from '../hooks/useProject'
import { useProjectFile } from '../hooks/useProjectFile'
import { serializeProject } from '../lib/schemaIO'
import defaultProjectJson from './fixtures/defaultProject.json'
import { rpc } from '../lib/rpc'

vi.mock('../lib/rpc', () => ({
  rpc: {
    request: {
      getPreset: vi.fn(),
      openProjectFile: vi.fn(),
      writeProjectFile: vi.fn(),
      pickProjectDirectory: vi.fn(),
      resolveProjectPath: vi.fn(),
    },
  },
}))

const mockGetPreset = vi.mocked(rpc.request.getPreset)
const mockOpenFile = vi.mocked(rpc.request.openProjectFile)
const mockWriteFile = vi.mocked(rpc.request.writeProjectFile)

const log = vi.fn()

function renderDocument() {
  return renderHook(() => {
    const project = useProject(log)
    const files = useProjectFile(project, log)
    return { project, files }
  })
}

/** Render and wait for the default preset to finish loading. */
async function renderLoaded() {
  const view = renderDocument()
  await waitFor(() => expect(view.result.current.project.isLoading).toBe(false))
  return view
}

/** Any edit that changes the serialized document. */
function edit(result: { current: ReturnType<typeof renderDocument>['result']['current'] }) {
  act(() => {
    result.current.project.setDeviceSettings({
      deviceName: 'edited-device',
      appearance: 0x1234,
      manufacturerData: '',
    })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetPreset.mockResolvedValue(defaultProjectJson)
  mockWriteFile.mockResolvedValue(undefined)
})

describe('dirty tracking', () => {
  it('is clean after the default preset loads', async () => {
    const { result } = await renderLoaded()
    expect(result.current.project.isDirty).toBe(false)
    expect(result.current.project.currentPath).toBeNull()
    expect(result.current.project.projectName).toBe('Untitled')
  })

  it('goes dirty on an edit', async () => {
    const { result } = await renderLoaded()
    edit(result)
    expect(result.current.project.isDirty).toBe(true)
  })

  it('is clean again after a save, and names the document by its file', async () => {
    const { result } = await renderLoaded()
    edit(result)

    await act(async () => {
      result.current.project.markSaved('/tmp/thing.json', serializeProject(result.current.project.projectRef.current))
    })

    expect(result.current.project.isDirty).toBe(false)
    expect(result.current.project.projectName).toBe('thing.json')
  })

  it('stays clean when an opened file parses to the same document', async () => {
    // Parsing normalizes, so the baseline must be a serialization, not the file text.
    // A file with fields in a different order must still open clean.
    const reordered = JSON.stringify({
      scenarios: defaultProjectJson.scenarios,
      services: defaultProjectJson.services,
      functions: defaultProjectJson.functions,
      variables: defaultProjectJson.variables,
      tests: defaultProjectJson.tests,
    })
    mockOpenFile.mockResolvedValue({ path: '/tmp/reordered.json', contents: reordered })

    const { result } = await renderLoaded()
    await act(async () => {
      result.current.files.requestOpen()
    })

    expect(result.current.project.isDirty).toBe(false)
  })
})

describe('unsaved-changes guard', () => {
  it('runs the action straight away when the document is clean', async () => {
    const { result } = await renderLoaded()

    act(() => {
      result.current.files.requestNew()
    })

    expect(result.current.files.pending).toBeNull()
    expect(result.current.project.services).toEqual([])
  })

  it('prompts instead of acting when the document is dirty', async () => {
    const { result } = await renderLoaded()
    const before = result.current.project.services.length
    edit(result)

    act(() => {
      result.current.files.requestNew()
    })

    expect(result.current.files.pending).toEqual({ kind: 'new' })
    expect(result.current.files.pendingLabel).toBe('Starting a new project')
    // Nothing was discarded while the prompt is up.
    expect(result.current.project.services.length).toBe(before)
  })

  it('discards and proceeds on Discard', async () => {
    const { result } = await renderLoaded()
    edit(result)
    act(() => result.current.files.requestNew())

    await act(async () => {
      result.current.files.confirmDiscard()
    })

    expect(result.current.files.pending).toBeNull()
    expect(result.current.project.services).toEqual([])
    expect(result.current.project.isDirty).toBe(false)
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('leaves everything untouched on Cancel', async () => {
    const { result } = await renderLoaded()
    const before = result.current.project.services.length
    edit(result)
    act(() => result.current.files.requestNew())

    act(() => {
      result.current.files.confirmCancel()
    })

    expect(result.current.files.pending).toBeNull()
    expect(result.current.project.services.length).toBe(before)
    expect(result.current.project.isDirty).toBe(true)
  })

  it('saves then proceeds on Save when the document has a path', async () => {
    const { result } = await renderLoaded()
    await act(async () => {
      result.current.project.markSaved(
        '/tmp/existing.json',
        serializeProject(result.current.project.projectRef.current)
      )
    })
    edit(result)
    act(() => result.current.files.requestNew())

    await act(async () => {
      await result.current.files.confirmSave()
    })

    expect(mockWriteFile).toHaveBeenCalledWith(expect.objectContaining({ path: '/tmp/existing.json' }))
    expect(result.current.project.services).toEqual([])
  })

  it('detours through Save As on Save when the document is untitled, then resumes', async () => {
    const { result } = await renderLoaded()
    edit(result)
    act(() => result.current.files.requestNew())

    await act(async () => {
      await result.current.files.confirmSave()
    })

    // The prompt gives way to Save As; the queued New has not run yet.
    expect(result.current.files.pending).toBeNull()
    expect(result.current.files.saveAsOpen).toBe(true)
    expect(result.current.project.services.length).toBeGreaterThan(0)

    await act(async () => {
      await result.current.files.completeSaveAs('/tmp/named.json')
    })

    expect(mockWriteFile).toHaveBeenCalledWith(expect.objectContaining({ path: '/tmp/named.json' }))
    expect(result.current.files.saveAsOpen).toBe(false)
    expect(result.current.project.services).toEqual([])
  })

  it('drops the queued action when Save As is cancelled', async () => {
    const { result } = await renderLoaded()
    const before = result.current.project.services.length
    edit(result)
    act(() => result.current.files.requestNew())
    await act(async () => {
      await result.current.files.confirmSave()
    })

    act(() => result.current.files.cancelSaveAs())

    expect(result.current.files.saveAsOpen).toBe(false)
    expect(result.current.project.services.length).toBe(before)
    expect(result.current.project.isDirty).toBe(true)
  })
})

describe('save', () => {
  it('writes to the known path without a dialog', async () => {
    const { result } = await renderLoaded()
    await act(async () => {
      result.current.project.markSaved('/tmp/known.json', serializeProject(result.current.project.projectRef.current))
    })
    edit(result)

    await act(async () => {
      await result.current.files.save()
    })

    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    expect(result.current.files.saveAsOpen).toBe(false)
    expect(result.current.project.isDirty).toBe(false)
  })

  it('opens Save As when the document is untitled', async () => {
    const { result } = await renderLoaded()
    edit(result)

    await act(async () => {
      await result.current.files.save()
    })

    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(result.current.files.saveAsOpen).toBe(true)
  })

  it('keeps the document dirty when the write fails', async () => {
    mockWriteFile.mockRejectedValue(new Error('EACCES'))
    const { result } = await renderLoaded()
    await act(async () => {
      result.current.project.markSaved('/tmp/ro.json', serializeProject(result.current.project.projectRef.current))
    })
    edit(result)

    await act(async () => {
      await result.current.files.save()
    })

    expect(result.current.project.isDirty).toBe(true)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Save failed'))
  })

  it('records the text it wrote, so an edit during the write stays dirty', async () => {
    let release: () => void = () => {}
    mockWriteFile.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          release = () => resolve()
        })
    )

    const { result } = await renderLoaded()
    await act(async () => {
      result.current.project.markSaved('/tmp/race.json', serializeProject(result.current.project.projectRef.current))
    })
    edit(result)

    let saving: Promise<boolean>
    act(() => {
      saving = result.current.files.save()
    })

    // A further edit lands while the write is still in flight.
    act(() => {
      result.current.project.setDeviceSettings({
        deviceName: 'edited-again',
        appearance: 0,
        manufacturerData: '',
      })
    })

    await act(async () => {
      release()
      await saving
    })

    expect(result.current.project.isDirty).toBe(true)
  })
})

describe('open', () => {
  it('loads the chosen file and adopts its path', async () => {
    mockOpenFile.mockResolvedValue({
      path: '/tmp/opened.json',
      contents: JSON.stringify(defaultProjectJson),
    })
    const { result } = await renderLoaded()

    await act(async () => {
      result.current.files.requestOpen()
    })

    expect(result.current.project.currentPath).toBe('/tmp/opened.json')
    expect(result.current.project.projectName).toBe('opened.json')
    expect(result.current.project.isDirty).toBe(false)
  })

  it('leaves the document alone when the dialog is cancelled', async () => {
    mockOpenFile.mockResolvedValue(null)
    const { result } = await renderLoaded()
    const before = result.current.project.services.length

    await act(async () => {
      result.current.files.requestOpen()
    })

    expect(result.current.project.services.length).toBe(before)
    expect(result.current.project.currentPath).toBeNull()
  })

  it('keeps the current document when the file will not parse', async () => {
    mockOpenFile.mockResolvedValue({ path: '/tmp/bad.json', contents: 'not json' })
    const { result } = await renderLoaded()
    const before = result.current.project.services.length

    await act(async () => {
      result.current.files.requestOpen()
    })

    expect(result.current.project.services.length).toBe(before)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Open failed'))
  })
})
