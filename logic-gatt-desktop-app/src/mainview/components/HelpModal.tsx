/**
 * The Help modal: what the app is, the shortest path through it, and what each panel
 * is for. Lifted out of TopBar, which was mostly this.
 */

import { useModalDialog } from '../hooks/useModalDialog'

export function HelpModal({ onClose }: { onClose: () => void }) {
  const panelRef = useModalDialog<HTMLDivElement>(onClose)

  return (
    <div className="help-overlay" onClick={onClose}>
      <div
        className="help-modal"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="help-title">LogicGATT</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="help-content">
          <section>
            <h3>What is this?</h3>
            <p>
              A programmable BLE device emulator. Define GATT services, write response logic, and test BLE interactions
              with real clients.
            </p>
          </section>

          <section>
            <h3>Quick Start</h3>
            <ol>
              <li>
                <strong>Define Services</strong> : Add GATT services and characteristics in{' '}
                <em>Device &rarr; Schema</em> on the left
              </li>
              <li>
                <strong>Write Functions</strong> : Create reusable logic in the <em>Functions</em> tab
              </li>
              <li>
                <strong>Create Scenarios</strong> : Wire up triggers and actions in the <em>Scenarios</em> tab
              </li>
              <li>
                <strong>Connect &amp; Run</strong> : Connect to a device, click <em>Upload &amp; Run</em>
              </li>
            </ol>
          </section>

          <section>
            <h3>Panels</h3>
            <dl>
              <dt>Device &rarr; Schema</dt>
              <dd>Define BLE services and characteristics with UUIDs, properties (R/W/N), and default values</dd>

              <dt>Device &rarr; State</dt>
              <dd>
                The values the running session is working with. Edit one live, put it back with <em>Reset</em>, or
                promote it into the project with <em>Save as initial</em>
              </dd>

              <dt>Scenarios</dt>
              <dd>Event-driven pipelines: trigger on char writes/reads, timers, or startup, then execute steps</dd>

              <dt>Functions</dt>
              <dd>
                Write JavaScript functions that process data. Receives <code>input</code> (Uint8Array) and{' '}
                <code>ctx</code> for state
              </dd>

              <dt>Variables</dt>
              <dd>
                Declare the variables a project has, and the value each one starts from. Reachable in functions via{' '}
                <code>ctx.getVar()</code> / <code>ctx.setVar()</code>
              </dd>

              <dt>Tests</dt>
              <dd>Validate functions with hex input/output test cases</dd>
            </dl>
          </section>

          <section>
            <h3>Scenario Steps</h3>
            <ul>
              <li>
                <strong>Call Function</strong> : Execute a function, passing current data buffer
              </li>
              <li>
                <strong>Notify</strong> : Send BLE notification to the connected client
              </li>
              <li>
                <strong>Respond</strong> : Reply to a read/write request with current buffer
              </li>
            </ul>
          </section>

          <section>
            <h3>Tips</h3>
            <ul>
              <li>
                Click <strong>API</strong> in the Code Editor header for the full function reference (<code>ctx</code>,{' '}
                <code>reader</code>/<code>writer</code>, available globals)
              </li>
              <li>
                Use <code>console.log()</code> in functions : output appears in Functions tab of the terminal
              </li>
              <li>
                A run never writes to the project. <code>ctx.setVar()</code> changes the session value in{' '}
                <em>Device &rarr; State</em>; the starting value in the <em>Variables</em> tab stays put. Reset one
                there, or all of them with <em>Reset all</em>
              </li>
              <li>
                <em>Device &rarr; State</em> also chooses when values go back to their project ones — on Upload &amp;
                Run, on disconnect, or never
              </li>
              <li>Use Tags on services/characteristics for easier identification in scenarios</li>
              <li>
                Save writes the whole project (services, functions, variables, tests, scenarios) to one JSON file.
                Upload &amp; Run never touches it, so testing against a device leaves the file alone
              </li>
              <li>Closing the window does not prompt about unsaved changes : save before quitting</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
