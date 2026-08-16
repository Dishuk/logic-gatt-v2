import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import {
  dracula,
  ayuLight,
  cobalt,
  coolGlow,
  espresso,
  noctisLilac,
  rosePineDawn,
  solarizedLight,
  tomorrow,
} from 'thememirror'

const defaultDarkTheme = EditorView.theme(
  {
    '&': {
      background: '#0d1117',
      color: '#e0e0e0',
      fontSize: '0.8rem',
      minHeight: '80px',
    },
    '.cm-content': {
      fontFamily: 'monospace',
      caretColor: '#e0e0e0',
    },
    '.cm-gutters': {
      background: '#0d1117',
      color: '#484f58',
      border: 'none',
    },
    '.cm-activeLine': {
      backgroundColor: '#161b2233',
    },
    '.cm-activeLineGutter': {
      backgroundColor: '#161b2233',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: '#e0e0e0',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: '#264f78',
    },
    '.cm-tooltip.cm-tooltip-autocomplete': {
      background: '#1c2128',
      border: '1px solid #30363d',
      color: '#e0e0e0',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      background: '#264f78',
    },
  },
  { dark: true }
)

const defaultDarkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#ff7b72' },
  { tag: tags.controlKeyword, color: '#ff7b72' },
  { tag: tags.operator, color: '#ff7b72' },
  { tag: tags.punctuation, color: '#e0e0e0' },
  { tag: tags.string, color: '#a5d6ff' },
  { tag: tags.number, color: '#79c0ff' },
  { tag: tags.bool, color: '#79c0ff' },
  { tag: tags.null, color: '#79c0ff' },
  { tag: tags.function(tags.variableName), color: '#d2a8ff' },
  { tag: tags.definition(tags.variableName), color: '#ffa657' },
  { tag: tags.variableName, color: '#e0e0e0' },
  { tag: tags.propertyName, color: '#79c0ff' },
  { tag: tags.comment, color: '#8b949e', fontStyle: 'italic' },
  { tag: tags.typeName, color: '#ffa657' },
  { tag: tags.className, color: '#ffa657' },
  { tag: tags.constant(tags.variableName), color: '#79c0ff' },
])

const defaultDark: Extension = [defaultDarkTheme, syntaxHighlighting(defaultDarkHighlight)]

export const themes: Record<string, Extension> = {
  'Default Dark': defaultDark,
  Dracula: dracula,
  Cobalt: cobalt,
  'Cool Glow': coolGlow,
  Espresso: espresso,
  'Noctis Lilac': noctisLilac,
  'Ayu Light': ayuLight,
  'Rose Pine Dawn': rosePineDawn,
  'Solarized Light': solarizedLight,
  Tomorrow: tomorrow,
}

export const themeNames = Object.keys(themes)
