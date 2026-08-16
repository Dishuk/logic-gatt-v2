import type { Extension } from '@codemirror/state'
import { CodeBlock } from './CodeBlock'
import { openExternal } from '../lib/rpc'

interface FunctionApiReferenceProps {
  onClose: () => void
  theme: Extension
}

const MDN = 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/'
const MDN_API = 'https://developer.mozilla.org/en-US/docs/Web/API/'

/** A link that opens in the OS browser (the webview can't navigate away). */
function ApiLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      className="api-link"
      onClick={e => {
        e.preventDefault()
        openExternal(href)
      }}
    >
      {children}
    </a>
  )
}

const SIGNATURE_EXAMPLE = `// in scope: input, ctx, console, reader, writer
const value = reader(input).uint16LE()
ctx.log('received ' + value)
return writer().uint16LE(value + 1).build()`

const READER_EXAMPLE = `const r = reader(input)
const id = r.uint8()
const temp = r.int16LE()
const rest = r.bytes(r.remaining())`

const WRITER_EXAMPLE = `return writer()
  .uint8(0x01)
  .uint16LE(1234)
  .bytes([0xAA, 0xBB])
  .build()`

/**
 * Reference for the sandbox a user function body runs in. Kept in sync with
 * `lib/sandbox.worker.ts` (the ground truth for what's injected/blocked).
 */
export function FunctionApiReference({ onClose, theme }: FunctionApiReferenceProps) {
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="api-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Function API</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="api-content">
          <section className="api-section">
            <p className="api-lead">
              A function transforms bytes. Its body runs in a sandbox with <code>input</code> and a few helpers in scope.
              Return a <code>Uint8Array</code> to emit bytes, or <code>null</code> for no output. Functions run from a
              scenario&apos;s <em>Call Function</em> step (with the current buffer) or from the <em>Test</em> tab.
            </p>
            <CodeBlock code={SIGNATURE_EXAMPLE} theme={theme} />
            <dl className="api-defs">
              <dt>
                <code>input</code>
              </dt>
              <dd>
                The incoming data buffer — always a <code>Uint8Array</code>, never <code>null</code>. It can be empty
                (e.g. on a char-read trigger), so guard with <code>input.length</code>, not a null check.
              </dd>
              <dt>
                return <code>Uint8Array | null</code>
              </dt>
              <dd>
                A <code>Uint8Array</code> emits bytes; <code>null</code> (or nothing) means no output and{' '}
                <strong>halts the rest of a Call Function pipeline</strong>. An empty <code>Uint8Array</code> is not{' '}
                <code>null</code> — it sends zero bytes and continues. Other return types are dropped with a warning.
              </dd>
            </dl>
          </section>

          <section className="api-section">
            <h3>ctx</h3>
            <dl className="api-defs">
              <dt>
                <code>ctx.getVar(name)</code>
              </dt>
              <dd>
                Read a declared variable → its typed value (<code>Uint8Array</code>, number, or string).{' '}
                <code>undefined</code> + warning if the name isn&apos;t declared.
              </dd>
              <dt>
                <code>ctx.setVar(name, value)</code>
              </dt>
              <dd>
                Update a declared variable; <code>value</code> must match its type. Variables must exist in the{' '}
                <em>Variables</em> tab first — they are <strong>not</strong> auto-created.
              </dd>
              <dt>
                <code>ctx.runScenario(name)</code>
              </dt>
              <dd>Queue another scenario to run after this function finishes.</dd>
              <dt>
                <code>ctx.log(msg)</code>
              </dt>
              <dd>
                Print a line to the <em>Functions</em> terminal.
              </dd>
            </dl>
          </section>

          <section className="api-section">
            <h3>console</h3>
            <p>
              <code>console.log / warn / error / info(...)</code> also print to the terminal. Object arguments are
              JSON-stringified.
            </p>
          </section>

          <section className="api-section">
            <h3>reader(bytes)</h3>
            <p className="api-lead">A cursor for parsing a byte buffer.</p>
            <dl className="api-defs">
              <dt>Fixed width</dt>
              <dd>
                <code>uint8</code> <code>int8</code> <code>uint16LE/BE</code> <code>int16LE/BE</code>{' '}
                <code>uint32LE/BE</code> <code>int32LE/BE</code>
              </dd>
              <dt>Variable width</dt>
              <dd>
                <code>uintLE(n)</code> <code>uintBE(n)</code> <code>intLE(n)</code> <code>intBE(n)</code> — n bytes;
                returns a <code>BigInt</code> when n {'>'} 4
              </dd>
              <dt>Bytes &amp; position</dt>
              <dd>
                <code>bytes(n)</code> <code>skip(n)</code> <code>remaining()</code> <code>pos</code>
              </dd>
            </dl>
            <CodeBlock code={READER_EXAMPLE} theme={theme} />
          </section>

          <section className="api-section">
            <h3>writer()</h3>
            <p className="api-lead">
              A chainable builder — same numeric methods as the reader (taking a value), plus{' '}
              <code>uintLE/uintBE/intLE/intBE(v, n)</code>, <code>bytes(data)</code>, and <code>build()</code> →{' '}
              <code>Uint8Array</code>.
            </p>
            <CodeBlock code={WRITER_EXAMPLE} theme={theme} />
          </section>

          <section className="api-section">
            <h3>Available globals</h3>
            <p className="api-lead">Standard JavaScript built-ins work — the ones most useful for byte work:</p>
            <table className="api-table">
              <thead>
                <tr>
                  <th>Global</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <ApiLink href={`${MDN}Math`}>Math</ApiLink>
                  </td>
                  <td>Rounding, min/max, random, and other numeric helpers.</td>
                </tr>
                <tr>
                  <td>
                    <ApiLink href={`${MDN}JSON`}>JSON</ApiLink>
                  </td>
                  <td>Encode and decode JSON strings (stringify / parse).</td>
                </tr>
                <tr>
                  <td>
                    <ApiLink href={`${MDN}Array`}>Array</ApiLink> · <ApiLink href={`${MDN}Object`}>Object</ApiLink>
                  </td>
                  <td>Build and transform lists and records (map, filter, keys…).</td>
                </tr>
                <tr>
                  <td>
                    <ApiLink href={`${MDN}Map`}>Map</ApiLink> · <ApiLink href={`${MDN}Set`}>Set</ApiLink>
                  </td>
                  <td>Keyed collections and unique-value sets.</td>
                </tr>
                <tr>
                  <td>
                    <ApiLink href={`${MDN}Uint8Array`}>Uint8Array</ApiLink>
                  </td>
                  <td>The byte-buffer type used for input and the return value.</td>
                </tr>
                <tr>
                  <td>
                    <ApiLink href={`${MDN}DataView`}>DataView</ApiLink>
                  </td>
                  <td>Read and write numbers at byte offsets with explicit endianness.</td>
                </tr>
                <tr>
                  <td>
                    <ApiLink href={`${MDN}ArrayBuffer`}>ArrayBuffer</ApiLink>
                  </td>
                  <td>The raw backing buffer behind typed arrays.</td>
                </tr>
                <tr>
                  <td>
                    <ApiLink href={`${MDN}BigInt`}>BigInt</ApiLink>
                  </td>
                  <td>Integers beyond 2^53 — for 5–8 byte fields.</td>
                </tr>
                <tr>
                  <td>
                    <ApiLink href={`${MDN_API}TextEncoder`}>TextEncoder</ApiLink> ·{' '}
                    <ApiLink href={`${MDN_API}TextDecoder`}>TextDecoder</ApiLink>
                  </td>
                  <td>Convert between strings and UTF-8 bytes.</td>
                </tr>
                <tr>
                  <td>
                    <ApiLink href={`${MDN}parseInt`}>parseInt</ApiLink> · <ApiLink href={`${MDN}Number`}>Number</ApiLink>
                  </td>
                  <td>Parse and convert numbers.</td>
                </tr>
                <tr>
                  <td>
                    <ApiLink href={`${MDN}Date`}>Date</ApiLink>
                  </td>
                  <td>Current time and timestamps.</td>
                </tr>
                <tr>
                  <td>
                    <ApiLink href={`${MDN}RegExp`}>RegExp</ApiLink>
                  </td>
                  <td>Pattern-match and extract from strings.</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="api-section">
            <h3>Blocked</h3>
            <p className="api-blocked">
              <code>window</code> <code>document</code> <code>fetch</code> <code>XMLHttpRequest</code>{' '}
              <code>WebSocket</code> <code>localStorage</code> <code>sessionStorage</code> <code>indexedDB</code>{' '}
              <code>caches</code> <code>navigator</code> <code>eval</code> <code>importScripts</code>{' '}
              <code>Notification</code> <code>ServiceWorker</code> <code>SharedWorker</code> — accessing any throws.
            </p>
          </section>

          <section className="api-section">
            <h3>Limits</h3>
            <ul className="api-list">
              <li>
                <strong>Synchronous only</strong> — the return value is read immediately, so <code>async</code>/
                <code>await</code> and Promises are not awaited.
              </li>
              <li>Execution times out after 5 seconds.</li>
              <li>
                Output must be a <code>Uint8Array</code> (or <code>null</code>).
              </li>
            </ul>
          </section>

          <section className="api-section">
            <h3>Variable types</h3>
            <dl className="api-defs">
              <dt>
                <code>hex</code>
              </dt>
              <dd>
                <code>Uint8Array</code>
              </dd>
              <dt>
                <code>u8</code> / <code>u16</code> / <code>u32</code>
              </dt>
              <dd>integer number — ranges 0–255, 0–65535, 0–4294967295 (checked on set)</dd>
              <dt>
                <code>string</code>
              </dt>
              <dd>string</dd>
            </dl>
          </section>
        </div>
      </div>
    </div>
  )
}
