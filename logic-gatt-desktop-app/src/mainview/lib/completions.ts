import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { snippetCompletion } from '@codemirror/autocomplete'

// Custom API members
const ctxMembers: Completion[] = [
  { label: 'getVar', type: 'function', detail: '(name: string)', info: 'Get variable value', boost: 2 },
  { label: 'setVar', type: 'function', detail: '(name: string, value)', info: 'Set variable value', boost: 2 },
  { label: 'runScenario', type: 'function', detail: '(name: string)', info: 'Queue a scenario to run after this function', boost: 1 },
  { label: 'log', type: 'function', detail: '(msg: string)', info: 'Log to terminal', boost: 1 },
]

// Binary reader methods
const readerMembers: Completion[] = [
  { label: 'uint8', type: 'method', detail: '(): number', info: 'Read unsigned 8-bit', boost: 3 },
  { label: 'int8', type: 'method', detail: '(): number', info: 'Read signed 8-bit', boost: 2 },
  { label: 'uint16LE', type: 'method', detail: '(): number', info: 'Read uint16 little-endian', boost: 3 },
  { label: 'uint16BE', type: 'method', detail: '(): number', info: 'Read uint16 big-endian', boost: 2 },
  { label: 'int16LE', type: 'method', detail: '(): number', info: 'Read int16 little-endian', boost: 2 },
  { label: 'int16BE', type: 'method', detail: '(): number', info: 'Read int16 big-endian', boost: 1 },
  { label: 'uint32LE', type: 'method', detail: '(): number', info: 'Read uint32 little-endian', boost: 3 },
  { label: 'uint32BE', type: 'method', detail: '(): number', info: 'Read uint32 big-endian', boost: 2 },
  { label: 'int32LE', type: 'method', detail: '(): number', info: 'Read int32 little-endian', boost: 2 },
  { label: 'int32BE', type: 'method', detail: '(): number', info: 'Read int32 big-endian', boost: 1 },
  { label: 'uintLE', type: 'method', detail: '(n): number|bigint', info: 'Read n bytes as unsigned LE', boost: 2 },
  { label: 'uintBE', type: 'method', detail: '(n): number|bigint', info: 'Read n bytes as unsigned BE', boost: 1 },
  { label: 'intLE', type: 'method', detail: '(n): number|bigint', info: 'Read n bytes as signed LE', boost: 1 },
  { label: 'intBE', type: 'method', detail: '(n): number|bigint', info: 'Read n bytes as signed BE', boost: 1 },
  { label: 'bytes', type: 'method', detail: '(n: number): Uint8Array', info: 'Read n bytes', boost: 3 },
  { label: 'skip', type: 'method', detail: '(n: number)', info: 'Skip n bytes', boost: 1 },
  { label: 'pos', type: 'property', info: 'Current position', boost: 1 },
  { label: 'remaining', type: 'method', detail: '(): number', info: 'Bytes left to read', boost: 1 },
]

// Binary writer methods
const writerMembers: Completion[] = [
  { label: 'uint8', type: 'method', detail: '(v: number): Writer', info: 'Write unsigned 8-bit', boost: 3 },
  { label: 'int8', type: 'method', detail: '(v: number): Writer', info: 'Write signed 8-bit', boost: 2 },
  { label: 'uint16LE', type: 'method', detail: '(v: number): Writer', info: 'Write uint16 little-endian', boost: 3 },
  { label: 'uint16BE', type: 'method', detail: '(v: number): Writer', info: 'Write uint16 big-endian', boost: 2 },
  { label: 'int16LE', type: 'method', detail: '(v: number): Writer', info: 'Write int16 little-endian', boost: 2 },
  { label: 'int16BE', type: 'method', detail: '(v: number): Writer', info: 'Write int16 big-endian', boost: 1 },
  { label: 'uint32LE', type: 'method', detail: '(v: number): Writer', info: 'Write uint32 little-endian', boost: 3 },
  { label: 'uint32BE', type: 'method', detail: '(v: number): Writer', info: 'Write uint32 big-endian', boost: 2 },
  { label: 'int32LE', type: 'method', detail: '(v: number): Writer', info: 'Write int32 little-endian', boost: 2 },
  { label: 'int32BE', type: 'method', detail: '(v: number): Writer', info: 'Write int32 big-endian', boost: 1 },
  { label: 'uintLE', type: 'method', detail: '(v, n): Writer', info: 'Write n bytes as unsigned LE', boost: 2 },
  { label: 'uintBE', type: 'method', detail: '(v, n): Writer', info: 'Write n bytes as unsigned BE', boost: 1 },
  { label: 'intLE', type: 'method', detail: '(v, n): Writer', info: 'Write n bytes as signed LE', boost: 1 },
  { label: 'intBE', type: 'method', detail: '(v, n): Writer', info: 'Write n bytes as signed BE', boost: 1 },
  { label: 'bytes', type: 'method', detail: '(data): Writer', info: 'Write bytes', boost: 3 },
  { label: 'build', type: 'method', detail: '(): Uint8Array', info: 'Build final array', boost: 3 },
]

// DataView methods (not provided by scopeCompletionSource for instances)
const dataViewMembers: Completion[] = [
  { label: 'getInt8', type: 'method', detail: '(offset)', info: 'Read signed 8-bit', boost: 2 },
  { label: 'getUint8', type: 'method', detail: '(offset)', info: 'Read unsigned 8-bit', boost: 2 },
  { label: 'getInt16', type: 'method', detail: '(offset, littleEndian?)', info: 'Read signed 16-bit', boost: 2 },
  { label: 'getUint16', type: 'method', detail: '(offset, littleEndian?)', info: 'Read unsigned 16-bit', boost: 2 },
  { label: 'getInt32', type: 'method', detail: '(offset, littleEndian?)', info: 'Read signed 32-bit', boost: 1 },
  { label: 'getUint32', type: 'method', detail: '(offset, littleEndian?)', info: 'Read unsigned 32-bit', boost: 1 },
  { label: 'getFloat32', type: 'method', detail: '(offset, littleEndian?)', info: 'Read 32-bit float' },
  { label: 'getFloat64', type: 'method', detail: '(offset, littleEndian?)', info: 'Read 64-bit float' },
  { label: 'setInt8', type: 'method', detail: '(offset, value)', info: 'Write signed 8-bit', boost: 2 },
  { label: 'setUint8', type: 'method', detail: '(offset, value)', info: 'Write unsigned 8-bit', boost: 2 },
  {
    label: 'setInt16',
    type: 'method',
    detail: '(offset, value, littleEndian?)',
    info: 'Write signed 16-bit',
    boost: 2,
  },
  {
    label: 'setUint16',
    type: 'method',
    detail: '(offset, value, littleEndian?)',
    info: 'Write unsigned 16-bit',
    boost: 2,
  },
  {
    label: 'setInt32',
    type: 'method',
    detail: '(offset, value, littleEndian?)',
    info: 'Write signed 32-bit',
    boost: 1,
  },
  {
    label: 'setUint32',
    type: 'method',
    detail: '(offset, value, littleEndian?)',
    info: 'Write unsigned 32-bit',
    boost: 1,
  },
  { label: 'setFloat32', type: 'method', detail: '(offset, value, littleEndian?)', info: 'Write 32-bit float' },
  { label: 'setFloat64', type: 'method', detail: '(offset, value, littleEndian?)', info: 'Write 64-bit float' },
  { label: 'buffer', type: 'property', info: 'Underlying ArrayBuffer' },
  { label: 'byteLength', type: 'property', info: 'Length in bytes' },
  { label: 'byteOffset', type: 'property', info: 'Offset in buffer' },
]

// TypedArray methods (Uint8Array, etc.)
const typedArrayMembers: Completion[] = [
  { label: 'length', type: 'property', info: 'Number of elements', boost: 3 },
  { label: 'byteLength', type: 'property', info: 'Size in bytes', boost: 2 },
  { label: 'buffer', type: 'property', info: 'Underlying ArrayBuffer', boost: 2 },
  { label: 'slice', type: 'method', detail: '(start?, end?)', info: 'Copy to new array', boost: 2 },
  { label: 'subarray', type: 'method', detail: '(start?, end?)', info: 'View (no copy)', boost: 2 },
  { label: 'set', type: 'method', detail: '(array, offset?)', info: 'Copy values in', boost: 1 },
  { label: 'fill', type: 'method', detail: '(value, start?, end?)', info: 'Fill with value' },
  { label: 'indexOf', type: 'method', detail: '(value, from?)', info: 'First index of' },
  { label: 'includes', type: 'method', detail: '(value, from?)', info: 'Contains value?' },
  { label: 'join', type: 'method', detail: '(separator?)', info: 'Join as string' },
  { label: 'reverse', type: 'method', detail: '()', info: 'Reverse in place' },
  { label: 'map', type: 'method', detail: '(fn)', info: 'Map to new array' },
  { label: 'filter', type: 'method', detail: '(fn)', info: 'Filter elements' },
  { label: 'reduce', type: 'method', detail: '(fn, init?)', info: 'Reduce to value' },
  { label: 'forEach', type: 'method', detail: '(fn)', info: 'Iterate each' },
  { label: 'find', type: 'method', detail: '(fn)', info: 'Find first match' },
  { label: 'findIndex', type: 'method', detail: '(fn)', info: 'Find index of match' },
  { label: 'at', type: 'method', detail: '(index)', info: 'Get at index (-1 = last)' },
  { label: 'every', type: 'method', detail: '(fn)', info: 'All pass test?' },
  { label: 'some', type: 'method', detail: '(fn)', info: 'Any pass test?' },
]

// Top-level custom completions
const customGlobals: Completion[] = [
  { label: 'ctx', type: 'variable', info: 'Execution context', boost: 10 },
  { label: 'input', type: 'variable', info: 'Input data (Uint8Array)', boost: 10 },
  { label: 'reader', type: 'function', detail: '(data: Uint8Array)', info: 'Create binary reader', boost: 10 },
  { label: 'writer', type: 'function', detail: '()', info: 'Create binary writer', boost: 10 },
]

// Snippets for common patterns
const snippets: Completion[] = [
  // Quick buffer reads (one-liners)
  snippetCompletion('input[${0}]', {
    label: 'u8',
    type: 'keyword',
    detail: 'read byte',
    info: 'Read uint8 at offset',
    boost: 5,
  }),
  snippetCompletion('new DataView(input.buffer).getUint16(${0}, true)', {
    label: 'u16',
    type: 'keyword',
    detail: 'read uint16 LE',
    info: 'Read uint16 little-endian at offset',
    boost: 5,
  }),
  snippetCompletion('new DataView(input.buffer).getUint32(${0}, true)', {
    label: 'u32',
    type: 'keyword',
    detail: 'read uint32 LE',
    info: 'Read uint32 little-endian at offset',
    boost: 5,
  }),
  snippetCompletion('new DataView(input.buffer).getInt16(${0}, true)', {
    label: 'i16',
    type: 'keyword',
    detail: 'read int16 LE',
    info: 'Read int16 little-endian at offset',
    boost: 4,
  }),
  snippetCompletion('new DataView(input.buffer).getInt32(${0}, true)', {
    label: 'i32',
    type: 'keyword',
    detail: 'read int32 LE',
    info: 'Read int32 little-endian at offset',
    boost: 4,
  }),
  snippetCompletion('new DataView(input.buffer).getFloat32(${0}, true)', {
    label: 'f32',
    type: 'keyword',
    detail: 'read float32 LE',
    info: 'Read float32 little-endian at offset',
    boost: 3,
  }),

  // Quick buffer writes (return byte array with value)
  snippetCompletion('new Uint8Array([${value}])', {
    label: 'ret1',
    type: 'keyword',
    detail: 'return 1 byte',
    info: 'Return single byte',
    boost: 4,
  }),
  snippetCompletion(
    '(() => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, ${value}, true); return b; })()',
    {
      label: 'ret2',
      type: 'keyword',
      detail: 'return uint16 LE',
      info: 'Return 2 bytes (uint16 little-endian)',
      boost: 4,
    }
  ),
  snippetCompletion(
    '(() => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, ${value}, true); return b; })()',
    {
      label: 'ret4',
      type: 'keyword',
      detail: 'return uint32 LE',
      info: 'Return 4 bytes (uint32 little-endian)',
      boost: 4,
    }
  ),

  // Binary data patterns
  snippetCompletion('new Uint8Array(${length})', {
    label: 'u8arr',
    type: 'keyword',
    detail: 'new Uint8Array',
    info: 'Create byte array',
    boost: 3,
  }),
  snippetCompletion('new DataView(${buffer}.buffer)', {
    label: 'dv',
    type: 'keyword',
    detail: 'new DataView',
    info: 'Create DataView from typed array',
    boost: 3,
  }),
  snippetCompletion('new TextEncoder().encode(${string})', {
    label: 'tenc',
    type: 'keyword',
    detail: 'string → bytes',
    info: 'Encode string to UTF-8',
  }),
  snippetCompletion('new TextDecoder().decode(${bytes})', {
    label: 'tdec',
    type: 'keyword',
    detail: 'bytes → string',
    info: 'Decode UTF-8 to string',
  }),

  // ctx API shortcuts
  snippetCompletion("ctx.getVar('${name}')", {
    label: 'getvar',
    type: 'keyword',
    detail: 'ctx.getVar',
    info: 'Get stored variable',
    boost: 3,
  }),
  snippetCompletion("ctx.setVar('${name}', ${value});", {
    label: 'setvar',
    type: 'keyword',
    detail: 'ctx.setVar',
    info: 'Store variable',
    boost: 3,
  }),
  snippetCompletion('ctx.log(${message});', {
    label: 'ctxlog',
    type: 'keyword',
    detail: 'ctx.log',
    info: 'Log to terminal',
    boost: 2,
  }),

  // Return byte array
  snippetCompletion('return new Uint8Array([${bytes}]);', {
    label: 'retu8',
    type: 'keyword',
    detail: 'return bytes',
    info: 'Return byte array',
    boost: 2,
  }),

  // Control flow
  snippetCompletion('for (let ${i} = 0; ${i} < ${length}; ${i}++) {\n\t${}\n}', {
    label: 'fori',
    type: 'keyword',
    detail: 'for loop',
    info: 'Classic for loop',
  }),
  snippetCompletion('for (const ${item} of ${iterable}) {\n\t${}\n}', {
    label: 'forof',
    type: 'keyword',
    detail: 'for...of',
    info: 'Iterate over values',
  }),
]

export function createCompletionSource(userFnNames: string[], userVarNames: string[]) {
  const userCompletions: Completion[] = [
    ...userFnNames
      .filter(n => n)
      .map(n => ({
        label: n,
        type: 'function' as const,
        info: 'User function',
        boost: 5,
      })),
    ...userVarNames
      .filter(n => n)
      .map(n => ({
        label: n,
        type: 'variable' as const,
        info: 'User variable',
        boost: 5,
      })),
  ]

  return (context: CompletionContext): CompletionResult | null => {
    const doc = context.state.doc.toString()
    const beforeCursor = doc.slice(0, context.pos)

    // Check for member access (something.)
    const memberMatch = beforeCursor.match(/(\w+)\.\s*(\w*)$/)
    if (memberMatch) {
      const objName = memberMatch[1]
      const partial = memberMatch[2]
      const from = context.pos - partial.length

      // ctx.
      if (objName === 'ctx') {
        return { from, options: ctxMembers }
      }

      // input is Uint8Array
      if (objName === 'input') {
        return { from, options: typedArrayMembers }
      }

      // Check if variable was declared as reader()
      const readerPattern = new RegExp(`(?:const|let|var)\\s+${objName}\\s*=\\s*reader\\s*\\(`)
      if (readerPattern.test(doc)) {
        return { from, options: readerMembers }
      }

      // Check if variable was declared as writer()
      const writerPattern = new RegExp(`(?:const|let|var)\\s+${objName}\\s*=\\s*writer\\s*\\(`)
      if (writerPattern.test(doc)) {
        return { from, options: writerMembers }
      }

      // Check if variable was declared as DataView or TypedArray
      const dataViewPattern = new RegExp(`(?:const|let|var)\\s+${objName}\\s*=\\s*new\\s+DataView`)
      if (dataViewPattern.test(doc)) {
        return { from, options: dataViewMembers }
      }

      const typedArrayPattern = new RegExp(
        `(?:const|let|var)\\s+${objName}\\s*=\\s*new\\s+(?:Uint8Array|Int8Array|Uint16Array|Int16Array|Uint32Array|Int32Array|Float32Array|Float64Array)`
      )
      if (typedArrayPattern.test(doc)) {
        return { from, options: typedArrayMembers }
      }

      // Fallback: show both for unknown objects (common in dynamic JS)
      return { from, options: [...readerMembers, ...writerMembers, ...dataViewMembers, ...typedArrayMembers] }
    }

    // Regular completion
    const word = context.matchBefore(/\w+/)
    if (!word && !context.explicit) return null

    return {
      from: word?.from ?? context.pos,
      options: [...snippets, ...customGlobals, ...userCompletions],
    }
  }
}
