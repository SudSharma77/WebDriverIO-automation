import { useState } from "react";
import type { FrameworkState } from "./types";

/**
 * What the framework already contains.
 *
 * This is the part that makes reuse legible: before running anything, you can
 * see exactly which methods the planner is allowed to call. If a method is not
 * in this list, the planner cannot emit it — so the list doubles as an
 * explanation of why something came back as "needs creating".
 */
export function Inventory({ state }: { state: Extract<FrameworkState, { open: true }> }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const matches = (text: string) => !needle || text.toLowerCase().includes(needle);

  const pages = state.pageObjects
    .map((page) => ({
      ...page,
      methods: page.methods.filter((m) => matches(m.name) || matches(page.className) || matches(m.doc ?? "")),
    }))
    .filter((page) => page.methods.length > 0 || matches(page.className));

  const helpers = state.helpers
    .map((helper) => ({ ...helper, methods: helper.methods.filter((m) => matches(m) || matches(helper.className)) }))
    .filter((helper) => helper.methods.length > 0);

  return (
    <section className="inventory">
      <div className="inventory__head">
        <h2 className="inventory__title">Available in this framework</h2>
        <input
          className="input input--sm"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter methods…"
          aria-label="Filter framework methods"
        />
      </div>

      <Group title="Page objects" count={state.pageObjects.length}>
        {pages.length === 0 && <p className="muted">No page objects match.</p>}
        {pages.map((page) => (
          <details key={page.className} className="entry" open={!!needle}>
            <summary>
              <span className="entry__name">{page.className}</span>
              <span className="entry__badge">{page.platform}</span>
              <span className="entry__count">{page.methods.length}</span>
            </summary>
            <ul className="methods">
              {page.methods.map((method) => (
                <li key={method.name}>
                  <code>
                    {method.name}({method.params.join(", ")})
                  </code>
                  {method.doc && <span className="muted"> — {method.doc}</span>}
                </li>
              ))}
            </ul>
            <p className="entry__file">{page.file}</p>
          </details>
        ))}
      </Group>

      <Group title="Helpers" count={state.helpers.length}>
        {helpers.map((helper) => (
          <details key={helper.className} className="entry" open={!!needle}>
            <summary>
              <span className="entry__name">{helper.className}</span>
              <span className="entry__count">{helper.methods.length}</span>
            </summary>
            <ul className="methods">
              {helper.methods.map((name) => (
                <li key={name}>
                  <code>{name}()</code>
                </li>
              ))}
            </ul>
          </details>
        ))}
        {helpers.length === 0 && <p className="muted">No helpers match.</p>}
      </Group>

      <Group title="Test data" count={state.data.length}>
        {state.data.map((file) => (
          <details key={`${file.name}.${file.format}`} className="entry">
            <summary>
              <span className="entry__name">{file.name}</span>
              <span className="entry__badge">{file.format}</span>
              <span className="entry__count">{file.records}</span>
            </summary>
            <p className="muted entry__fields">{file.fields.join(", ")}</p>
          </details>
        ))}
        {state.data.length === 0 && <p className="muted">No datasets found.</p>}
      </Group>

      <Group title="Existing specs" count={state.specs.length}>
        {state.specs.map((spec) => (
          <details key={spec.file} className="entry">
            <summary>
              <span className="entry__name">{spec.file.split("/").pop()}</span>
              <span className="entry__count">{spec.suites.length}</span>
            </summary>
            <ul className="methods">
              {spec.suites.map((suite) => (
                <li key={suite}>{suite}</li>
              ))}
            </ul>
          </details>
        ))}
      </Group>
    </section>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="group">
      <h3 className="group__title">
        {title} <span className="group__count">{count}</span>
      </h3>
      {children}
    </div>
  );
}
