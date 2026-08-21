import { useState } from "react";
import type { TypecheckResult } from "./api";
import type { PlanResult } from "./types";

interface Props {
  plan: PlanResult;
  applying: boolean;
  applied: string[] | null;
  onApply: () => void;
  checking: boolean;
  check: TypecheckResult | null;
  onCheck: () => void;
}

/**
 * The review surface.
 *
 * The point of showing this before writing anything is that the reuse-vs-create
 * decision is visible: which of the framework's existing methods were used, and
 * what the planner could not find. Applying writes exactly the diff shown here.
 */
export function PlanView({ plan, applying, applied, onApply, checking, check, onCheck }: Props) {
  const spec = plan.changes[0];

  return (
    <div className="plan">
      <header className="plan__head">
        <div>
          <h2 className="plan__title">{plan.title}</h2>
          <p className="plan__test">{plan.test}</p>
        </div>
        <span className="pill" data-status={plan.complete ? "passed" : "failed"}>
          <span className="pill__dot" aria-hidden="true" />
          {plan.complete ? "Ready to write" : "Blocked"}
        </span>
      </header>

      <p className="plan__meta">
        {plan.mode === "deterministic"
          ? "Resolved without calling a model"
          : `${plan.llmCalls} model call${plan.llmCalls === 1 ? "" : "s"}`}
        {plan.data && ` · data from ${plan.data.file}[${plan.data.index}] as ${plan.data.as}`}
      </p>

      {plan.duplicateOf && (
        <p className="banner" data-tone="warn" role="status">
          An existing spec may already cover this: <strong>{plan.duplicateOf}</strong>
        </p>
      )}

      <div className="ledger">
        <Ledger tone="reuse" title="Reused from your framework" empty="Nothing existing matched.">
          {plan.reused.map((name) => (
            <code key={name} className="chip chip--reuse">
              {name}
            </code>
          ))}
        </Ledger>

        {plan.missing.length > 0 && (
          <Ledger tone="create" title="Not in the framework yet" empty="">
            {plan.missing.map((gap, i) => (
              <span key={i} className="chip chip--create">
                {gap.suggestedClass ? (
                  <code>
                    {gap.suggestedClass}.{gap.suggestedMethod ?? "…"}
                  </code>
                ) : null}
                <span className="chip__note">{gap.capability}</span>
              </span>
            ))}
          </Ledger>
        )}
      </div>

      {plan.problems.length > 0 && (
        <div className="problems" role="alert">
          <h3>Unresolved — nothing will be written</h3>
          {plan.problems.map((problem, i) => (
            <div className="problem" key={i}>
              <code>{problem.reference}</code>
              <p>{problem.reason}</p>
              {problem.suggestions.length > 0 && (
                <p className="muted">Available: {problem.suggestions.slice(0, 10).join(", ")}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {spec && <SpecPreview change={spec} />}

      {check && <CheckResult check={check} />}

      {applied ? (
        <p className="banner" data-tone="ok" role="status">
          Written to <strong>{applied.join(", ")}</strong>
        </p>
      ) : (
        spec && (
          <div className="plan__actions">
            {/* Compiling the candidate in place is the only pre-write signal
                that the generated code is actually valid against this project. */}
            <button className="btn btn--ghost" type="button" onClick={onCheck} disabled={!plan.complete || checking}>
              {checking && <span className="spinner" aria-hidden="true" />}
              {checking ? "Compiling…" : "Check it compiles"}
            </button>
            <button className="btn btn--primary" type="button" onClick={onApply} disabled={!plan.complete || applying}>
              {applying && <span className="spinner" aria-hidden="true" />}
              {applying ? "Writing…" : `Write ${spec.action === "create" ? "new file" : "changes"} into the framework`}
            </button>
          </div>
        )
      )}
    </div>
  );
}

function CheckResult({ check }: { check: TypecheckResult }) {
  if (check.status === "skipped") {
    return (
      <p className="banner" data-tone="warn" role="status">
        Could not compile-check: {check.reason}
      </p>
    );
  }
  if (check.status === "passed") {
    return (
      <p className="banner" data-tone="ok" role="status">
        Compiles cleanly against this framework — imports resolve and every method call is valid.
      </p>
    );
  }

  // Errors elsewhere in the project are pre-existing, not caused by this spec.
  const mine = check.diagnostics.filter((d) => d.inCandidate);
  const elsewhere = check.diagnostics.length - mine.length;

  return (
    <div className="problems" role="alert">
      <h3>Does not compile — {mine.length} error{mine.length === 1 ? "" : "s"} in the generated spec</h3>
      {mine.map((d, i) => (
        <div className="problem" key={i}>
          <code>
            line {d.line}:{d.column} (TS{d.code})
          </code>
          <p>{d.message}</p>
        </div>
      ))}
      {elsewhere > 0 && (
        <p className="muted">
          {elsewhere} further error{elsewhere === 1 ? "" : "s"} elsewhere in the project — pre-existing, not from this
          spec.
        </p>
      )}
    </div>
  );
}

function SpecPreview({ change }: { change: PlanResult["changes"][number] }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(change.after);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="preview">
      <header className="preview__head">
        <span className="preview__action" data-action={change.action}>
          {change.action === "create" ? "new file" : "modify"}
        </span>
        <code className="preview__path">{change.path}</code>
        <button className="btn btn--ghost" type="button" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </header>
      <pre className="code">
        <code>{change.after}</code>
      </pre>
    </section>
  );
}

function Ledger({
  tone,
  title,
  empty,
  children,
}: {
  tone: "reuse" | "create";
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <div className="ledger__col" data-tone={tone}>
      <h3 className="ledger__title">{title}</h3>
      <div className="ledger__items">{items.length > 0 ? children : <p className="muted">{empty}</p>}</div>
    </div>
  );
}
