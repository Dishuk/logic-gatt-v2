# Logic Constructor

The logic constructor is where a project defines how the emulated BLE device behaves. It
lives entirely in the desktop app; the phone only carries out the resulting commands.

A **project** has these parts, all serialized together (see [Project format](#project-format)):

- **Schema** — the GATT services and characteristics, plus device/advertising settings.
- **Variables** — named values that persist across calls and hold device state.
- **Functions** — JavaScript that transforms bytes.
- **Scenarios** — bindings from a trigger (a BLE read/write, a timer, startup, manual) to a
  pipeline of steps that call functions and send BLE responses/notifications.
- **Tests** — fixed input/expected-output checks for individual functions.

Data flow:

```
BLE write on Char A → scenario triggers → function(s) transform the bytes
                    → notify Char B / respond to the read → BLE
```

All logic runs on the desktop. A BLE central's read/write is relayed from the phone to the
desktop, the matching scenario runs, and the desktop tells the phone how to respond.

---

## Schema

- **Service** — `uuid`, a `tag` (display name), and a list of characteristics.
- **Characteristic** — `uuid`, `tag`, `properties` (`read` / `write` / `notify`), and a
  `defaultValue` (hex). A characteristic must declare a property to allow the matching
  operation (a scenario can only `notify` a characteristic whose `notify` property is set,
  etc.).
- **Device settings** — `deviceName`, `appearance`, `manufacturerData` (hex).

Uploading a schema builds the GATT server on the phone and starts advertising.

---

## Variables

Named values in a single flat namespace, shared by all functions and scenarios. Declare a
variable in the Variables tab before use; `getVar`/`setVar` on an unknown name logs a warning
and does nothing.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique identifier |
| `type` | `hex \| u8 \| u16 \| u32 \| string` | How the value is stored/interpreted |
| `initialValue` | `string` | Hex (`"00 00 00 01"`) or a literal, per type |

The `type` fixes what `getVar` returns and what `setVar` accepts:

| Type | Value in JS | `setVar` accepts |
|------|-------------|------------------|
| `hex` | `Uint8Array` | a `Uint8Array` |
| `u8` | `number` | integer 0–255 |
| `u16` | `number` | integer 0–65535 |
| `u32` | `number` | integer 0–4294967295 |
| `string` | `string` | a string |

`setVar` with a wrong type or out-of-range number logs an error and leaves the variable
unchanged. Values persist across scenario runs and reset to `initialValue` when the schema is
reloaded. Variables are the only way to share state between scenarios.

---

## Functions

A function is a **JavaScript** body (not TypeScript — no type annotations). It receives the
current buffer as `input: Uint8Array` and must `return` a `Uint8Array`.

```js
// `input` is a Uint8Array, already in scope. Write the body only — no function wrapper.
const r = reader(input)
const cmd = r.uint8()
return writer().uint8(0x00).uint8(cmd).build()
```

### Return contract

- Return a `Uint8Array` → it becomes the input to the next pipeline step.
- Return `null`/`undefined` → the pipeline stops after this step (no error).
- Return anything else → a warning is logged and the pipeline stops.

### `ctx`

| Call | Signature | Behavior |
|------|-----------|----------|
| `ctx.getVar(name)` | `(string) => Uint8Array \| number \| string \| undefined` | Read a variable, typed per its declaration. Unknown name → warning, returns `undefined`. |
| `ctx.setVar(name, value)` | `(string, value) => void` | Write a variable. Value must match the variable's type (see [Variables](#variables)); mismatch → error, no change. Unknown name → warning. |
| `ctx.log(msg)` | `(string) => void` | Print a line to the Terminal panel. |
| `ctx.runScenario(name)` | `(string) => void` | Queue another scenario to run after this pipeline finishes, with the pipeline's final buffer as its input. Unknown name → warning. |

### `console`

`console.log`, `console.warn`, `console.error`, `console.info` all print to the Terminal
panel (objects are JSON-stringified).

### `reader(data)` — stateful binary reader

`reader(data: Uint8Array)` returns a reader that advances a cursor as it reads.

| Method | Returns | Bytes |
|--------|---------|-------|
| `uint8()` / `int8()` | `number` | 1 |
| `uint16LE()` / `uint16BE()` | `number` | 2 |
| `int16LE()` / `int16BE()` | `number` | 2 |
| `uint32LE()` / `uint32BE()` | `number` | 4 |
| `int32LE()` / `int32BE()` | `number` | 4 |
| `uintLE(n)` / `uintBE(n)` | `number`, or `bigint` if `n > 4` | n |
| `intLE(n)` / `intBE(n)` | `number`, or `bigint` if `n > 4` | n |
| `bytes(n)` | `Uint8Array` | n |
| `skip(n)` | `void` | advances n |
| `remaining()` | `number` | — |
| `pos` | `number` (read/write) | — |

### `writer()` — chainable binary writer

`writer()` returns a builder; every write returns the writer, and `build()` returns the
`Uint8Array`.

| Method | Argument | Bytes |
|--------|----------|-------|
| `uint8(v)` / `int8(v)` | `number` | 1 |
| `uint16LE(v)` / `uint16BE(v)` | `number` | 2 |
| `int16LE(v)` / `int16BE(v)` | `number` | 2 |
| `uint32LE(v)` / `uint32BE(v)` | `number` | 4 |
| `int32LE(v)` / `int32BE(v)` | `number` | 4 |
| `uintLE(v, n)` / `uintBE(v, n)` | `number \| bigint`, count | n |
| `intLE(v, n)` / `intBE(v, n)` | `number \| bigint`, count | n |
| `bytes(data)` | `Uint8Array \| number[]` | data.length |
| `build()` | — | returns `Uint8Array` |

### Sandbox constraints

Functions run in a Web Worker with a restricted scope:

- Only `input`, `ctx`, `console`, `reader`, `writer` are available. There is **no** `notify`
  or `respond` in a function — sending on BLE is done by scenario steps.
- `window`, `document`, `fetch`, `WebSocket`, `localStorage`, `sessionStorage`, `eval`,
  `navigator`, `XMLHttpRequest`, `importScripts`, `indexedDB`, `caches`, and similar globals
  are blocked; accessing one throws.
- Execution is capped at **5 seconds**; a function that exceeds it is terminated and produces
  no output (the pipeline stops).
- Exceptions are caught and logged to the Terminal; they stop the pipeline but never crash
  the app.

### Common patterns

Parse a request, build a response:

```js
const r = reader(input)
const cmd = r.uint8()
const len = r.uint8()
const data = r.bytes(len)
let sum = 0; for (const b of data) sum += b
return writer().uint8(0x00).uint8(cmd).uint16LE(sum & 0xffff).build()
```

Keep state in a variable (`counter` declared as `u32`):

```js
const n = ctx.getVar('counter') + 1
ctx.setVar('counter', n)
return writer().uint32LE(n).build()
```

Chain to another scenario after this pipeline:

```js
ctx.runScenario('sendAck')
return input
```

---

## Scenarios

A scenario binds one trigger to an ordered list of steps.

```ts
interface Scenario { id: string; name: string; enabled: boolean; trigger: Trigger; steps: Step[] }
```

Disabled scenarios (`enabled: false`) never run.

### Triggers

Choose the trigger type in the scenario card; the relevant fields appear.

| Trigger | Fields | Fires when | Input buffer |
|---------|--------|------------|--------------|
| `char-write` | `serviceUuid`, `charUuid` | A central writes that characteristic | the written bytes |
| `char-read` | `serviceUuid`, `charUuid` | A central reads that characteristic | empty |
| `timer` | `intervalMs`, `repeat` | The interval elapses; `repeat: false` fires once | empty |
| `startup` | — | Shortly after the schema is uploaded | empty |
| `manual` | — | The user runs the scenario from the UI | empty |

### Steps

Steps run top to bottom. Each receives the previous step's output buffer; the first receives
the trigger's input buffer.

| Step | Fields | Behavior |
|------|--------|----------|
| `call-function` | `functionName` | Run the named function with the current buffer as `input`; its return becomes the next buffer. Returning null/none stops the pipeline. A missing function name stops the pipeline. |
| `notify` | `serviceUuid`, `charUuid` | Send the current buffer as a notification on that characteristic; the buffer passes through unchanged. Skipped if the buffer is empty/null. |
| `respond` | — | Send the current buffer as the read response. Valid only under a `char-read` trigger; ignored otherwise. |

### Execution model

1. On schema upload, variables reset to their initial values, `startup` scenarios run (after
   a brief settle delay), and `timer` scenarios are scheduled.
2. A `char-write`/`char-read` event runs every enabled scenario whose trigger matches the
   service+characteristic, in definition order. Each matching scenario gets its **own copy**
   of the original input buffer — matching scenarios do not chain into each other.
3. Within a scenario, the buffer flows step → step. `ctx.runScenario(name)` from inside a
   function queues that scenario to run after the current pipeline, with the final buffer as
   its input.

### Examples

**Echo a write back as a notification.** Trigger `char-write` on Char A; steps:
`call-function → echo`, then `notify → Char B`. Function `echo`: `return input`.

**Answer a read.** Trigger `char-read` on Char A; steps: `call-function → buildStatus`,
then `respond`. Function `buildStatus` returns the bytes the central should read.

**Emit a reading every second.** Trigger `timer` (`intervalMs: 1000`, `repeat: true`); steps:
`call-function → nextSample`, then `notify → measurement char`.

---

## Tests

A test pairs a function with a fixed input and (optionally) an expected output:

```ts
interface UserTest { id: string; name: string; functionId: string; inputHex: string; expectedHex: string }
```

The Test panel runs the selected function against `inputHex`, using the project's current
**variables** (so `getVar`/`setVar` work, and `setVar` updates the variable). It does not run
a scenario pipeline, so `ctx.runScenario` has no effect.

- With `expectedHex` set → **pass** if the function's output equals it (hex compared byte for
  byte, whitespace-insensitive).
- With `expectedHex` empty → **pass** if the function returns null or an empty buffer.

The panel shows per-test pass/fail and an aggregate (`passed/total`).

---

## Project format

Everything is serialized together:

```json
{ "services": [ ... ], "functions": [ ... ], "variables": [ ... ], "scenarios": [ ... ], "tests": [ ... ] }
```

Built-in example projects are in `src/bun/presets/` (`default.json` demonstrates the function
API; `heart-rate-monitor.json` uses timers, reads, and a control point).
