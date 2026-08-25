import { balanced, methodsFor, type PageFact } from "./structure.js";
import type { FlowRecord, ProjectLanguage } from "./types.js";

/**
 * Lifting a verified spec's steps into a named business function.
 *
 * The layer the reference architecture calls a "business function" and this
 * project calls a flow: one named operation composed of page-object calls,
 * which *returns what it observed* rather than asserting. The spec that calls
 * it holds the assertions, and nothing else:
 *
 *     const outcome = await logIn({ emailField: process.env.TESTLAB_SECRET_EMAIL });
 *     await expect(outcome.heading).toBe('Welcome');
 *
 * That split is what makes the second spec cheap. "Log in" stops being four
 * lines every scenario repeats and becomes one call every scenario shares —
 * and when the login screen changes, one function changes with it.
 *
 * Mechanical, not a model call, and built the same way `pom.ts` is: it
 * recognises exactly the shape synthesis emits, and returns null for anything
 * else rather than guessing. A spec it declines is simply saved as it is
 * today, which is why declining is always safe.
 */

export interface ExtractedFlow {
  /** Exported function name, e.g. `logInWithValidCredentials`. */
  name: string;
  /** Basename within `src/flows`, without extension. */
  file: string;
  /**
   * The flow module's contents, or null when an existing flow already does
   * exactly this and the spec simply calls that one instead.
   */
  source: string | null;
  /** Ordered page-object calls the flow makes — the reuse key. See `flow.ts`. */
  callSequence: string[];
  inputFields: string[];
  outputFields: string[];
  pagesUsed: PageFact[];
  /** Set when an existing flow covered this scenario outright. */
  reusedExisting?: boolean;
  /** Set when this new flow delegates its opening steps to an existing one. */
  composedFrom?: { name: string; steps: number };
}

/** What a statement inside the `it()` body turned out to be. */
type Classified =
  | { kind: "action"; instance: string; method: string; args: string; text: string }
  | { kind: "read"; instance: string; method: string; variable: string; produces: "string" | "boolean"; text: string }
  | { kind: "assertion"; text: string };

/** Every liftable scenario in one spec, and the spec that now calls them. */
export interface Extraction {
  spec: string;
  flows: ExtractedFlow[];
}

/**
 * Lift every scenario in a spec that can be lifted.
 *
 * Per `it()` block rather than per file, because a spec file accumulates: a
 * later run nests a second scenario into the file its page already owns (see
 * `categoryFile`), and treating the file as all-or-nothing would leave one
 * scenario calling a flow and the next one still calling page objects — the
 * layering holding for whichever scenario happened to arrive first.
 *
 * A block that is already lifted simply declines (its body is a flow call,
 * not a sequence of steps) and is left exactly as it is, which is what makes
 * this safe to re-run over the same file on every save.
 */
export function extractBusinessFunctions(args: {
  spec: string;
  pages: PageFact[];
  language: ProjectLanguage;
  /**
   * Flows the client's project already has. Checked before anything is
   * written, so a scenario someone else already automated is called rather
   * than rebuilt beside itself.
   */
  existingFlows?: FlowRecord[];
}): Extraction | null {
  const blocks = itBlocks(args.spec);
  if (blocks.length === 0) return null;

  const known = [...(args.existingFlows ?? [])];
  const flows: ExtractedFlow[] = [];
  const rewrites: Array<{ start: number; end: number; body: string }> = [];

  for (const block of blocks) {
    const lifted = liftBlock({ block, pages: args.pages, language: args.language, existingFlows: known });
    if (!lifted) continue;

    flows.push(lifted.flow);
    rewrites.push({ start: block.start, end: block.end, body: lifted.body });

    // Visible to the next block in the same file, so two scenarios added in
    // one run cannot each mint their own copy of the same flow.
    known.push({
      name: lifted.flow.name,
      file: lifted.flow.file,
      callSequence: lifted.flow.callSequence,
      inputFields: lifted.flow.inputFields,
      outputFields: lifted.flow.outputFields,
      usedBy: [],
      createdAt: 0,
    });
  }

  if (flows.length === 0) return null;

  // Back to front, so an earlier splice cannot shift a later one's offsets.
  let spec = args.spec;
  for (const rewrite of [...rewrites].reverse()) {
    spec = spec.slice(0, rewrite.start) + rewrite.body + spec.slice(rewrite.end);
  }

  return { spec: rebuildImports(spec, flows, args.pages), flows };
}

function liftBlock(args: {
  block: ItBlock;
  pages: PageFact[];
  language: ProjectLanguage;
  existingFlows: FlowRecord[];
}): { flow: ExtractedFlow; body: string } | null {
  const { block } = args;

  const kinds = interactionsByCall(args.pages);
  const statements = splitStatements(block.body);
  if (statements.length === 0) return null;

  const classified: Classified[] = [];
  for (const statement of statements) {
    const one = classify(statement, kinds);
    if (!one) return null; // Something this does not understand — leave the spec alone.
    classified.push(one);
  }

  // The steps must all precede the assertions. Synthesis always writes them
  // that way (the plan's Steps then its Expected Result), and anything else
  // would have its ordering changed by the move: an assertion between two
  // clicks would end up running after both of them.
  const firstAssertion = classified.findIndex((c) => c.kind === "assertion");
  const lastStep = classified.map((c) => c.kind !== "assertion").lastIndexOf(true);
  if (firstAssertion !== -1 && firstAssertion < lastStep) return null;

  const steps = classified.filter((c): c is Exclude<Classified, { kind: "assertion" }> => c.kind !== "assertion");
  const assertions = classified.filter((c): c is Extract<Classified, { kind: "assertion" }> => c.kind === "assertion");
  if (steps.length === 0) return null; // Nothing to lift.

  // From the scenario's own `it()` description, which is where synthesis puts
  // the plan's title — so each block is named for what it does, whichever run
  // added it to this file.
  const name = flowName(block.description);
  if (!name) return null;

  const inputs = collectInputs(steps, args.pages);
  const outputs = steps
    .filter((s): s is Extract<Classified, { kind: "read" }> => s.kind === "read")
    .map((s) => ({ field: s.variable, type: s.produces }));
  const pagesUsed = usedPages(steps, args.pages);
  if (pagesUsed.length === 0) return null;

  const callSequence = steps.map((s) => `${s.instance}.${s.method}`);
  const match = matchExistingFlow(callSequence, args.existingFlows);

  // Someone has already automated exactly this. Call theirs; write nothing.
  if (match?.kind === "exact") {
    return {
      flow: {
        name: match.flow.name,
        file: match.flow.name,
        source: null,
        callSequence,
        inputFields: match.flow.inputFields,
        outputFields: match.flow.outputFields,
        pagesUsed,
        reusedExisting: true,
      },
      body: renderBody({
        indent: block.indent,
        name: match.flow.name,
        inputs: alignInputs(inputs, match.flow.inputFields),
        // The sequences are identical, so the Nth read here is the Nth value
        // that flow returns — bind the assertions to *its* field names, not to
        // whatever this spec happened to call its locals.
        outputs: outputs.map((o, i) => ({ ...o, field: match.flow.outputFields[i] ?? o.field })),
        assertions,
        localNames: outputs.map((o) => o.field),
      }),
    };
  }

  const composedFrom = match?.kind === "prefix" ? { name: match.flow.name, steps: match.steps } : undefined;

  return {
    flow: {
      name,
      file: name,
      source: renderFlowModule({
        name,
        title: block.description,
        steps,
        inputs,
        outputs,
        pagesUsed,
        language: args.language,
        ...(match?.kind === "prefix" ? { delegate: match } : {}),
      }),
      callSequence,
      inputFields: inputs.map((i) => i.field),
      outputFields: outputs.map((o) => o.field),
      pagesUsed,
      ...(composedFrom ? { composedFrom } : {}),
    },
    body: renderBody({
      indent: block.indent,
      name,
      inputs,
      outputs,
      assertions,
      localNames: outputs.map((o) => o.field),
    }),
  };
}

type FlowMatch =
  | { kind: "exact"; flow: FlowRecord }
  | { kind: "prefix"; flow: FlowRecord; steps: number };

/**
 * The most useful existing flow for this call sequence.
 *
 * Exact means the scenario is already automated — call it. A prefix means this
 * scenario *starts* the way an existing one does, which is the "log in first"
 * case: the new flow delegates its opening steps rather than repeating them,
 * so when the login screen changes only one function has to.
 *
 * Prefix only, never a shared middle: two scenarios starting the same way is a
 * precondition, whereas a run of calls in common somewhere in the middle is
 * usually coincidence (both happen to dismiss the same banner) and naming it
 * would be inventing a concept nobody has.
 */
function matchExistingFlow(callSequence: string[], existing: FlowRecord[]): FlowMatch | null {
  let best: FlowMatch | null = null;

  for (const flow of existing) {
    if (flow.callSequence.length === 0) continue;

    if (sameSequence(flow.callSequence, callSequence)) return { kind: "exact", flow };

    const shared = flow.callSequence.length;
    if (shared >= MIN_DELEGATED_STEPS && shared < callSequence.length && sameSequence(flow.callSequence, callSequence.slice(0, shared))) {
      if (!best || (best.kind === "prefix" && shared > best.steps)) best = { kind: "prefix", flow, steps: shared };
    }
  }

  return best;
}

/**
 * Below this, delegating costs more than it saves: a one-call flow reads worse
 * as `await openHomePage()` than as the call it wraps.
 */
const MIN_DELEGATED_STEPS = 2;

function sameSequence(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((call, i) => call === b[i]);
}

/**
 * Rename this spec's inputs onto the existing flow's parameter names.
 *
 * Both are derived from the same element properties, so they normally agree —
 * but if the existing flow has since been edited by hand, its signature is the
 * authority and anything it does not declare is dropped rather than passed to
 * a parameter that no longer exists.
 */
function alignInputs(inputs: InputField[], declared: string[]): InputField[] {
  return inputs.filter((i) => declared.includes(i.field));
}

/** A value the flow observed and hands back for the spec to assert on. */
interface OutputField {
  field: string;
  type: "string" | "boolean";
}

/** An argument a caller has to supply, and the call it is supplied to. */
interface InputField {
  field: string;
  /** The expression the spec passed, e.g. `process.env.TESTLAB_SECRET_EMAIL`. */
  expression: string;
}

interface ItBlock {
  /** Offset of the first character inside the arrow body's braces. */
  start: number;
  end: number;
  body: string;
  /** The scenario's own description — the title synthesis gave it. */
  description: string;
  indent: string;
}

/** Every `it('...', async () => { ... })` in the file, in source order. */
function itBlocks(spec: string): ItBlock[] {
  const blocks: ItBlock[] = [];
  const pattern = /\bit\s*\(/g;

  for (let match = pattern.exec(spec); match; match = pattern.exec(spec)) {
    const parenIndex = match.index + match[0].length - 1;
    const callArgs = balanced(spec, parenIndex);
    if (callArgs === null) continue;

    const description = /^\s*(['"`])((?:[^\\]|\\.)*?)\1/.exec(callArgs)?.[2];
    if (!description) continue;

    // The arrow body is the `{ ... }` after the `=>`.
    const arrow = callArgs.indexOf("=>");
    const bodyOpen = arrow === -1 ? -1 : callArgs.indexOf("{", arrow);
    if (bodyOpen === -1) continue;

    const absoluteOpen = parenIndex + 1 + bodyOpen;
    const body = balancedBraces(spec, absoluteOpen);
    if (body === null) continue;

    const lineStart = spec.lastIndexOf("\n", match.index) + 1;
    blocks.push({
      start: absoluteOpen + 1,
      end: absoluteOpen + 1 + body.length,
      body,
      description,
      indent: spec.slice(lineStart, match.index),
    });

    // Skip past this block, so a nested it() (there should not be one) cannot
    // be picked up as a sibling.
    pattern.lastIndex = absoluteOpen + 1 + body.length;
  }

  return blocks;
}

/** As `balanced`, for `{}` rather than `()`. */
function balancedBraces(source: string, open: number): string | null {
  let depth = 0;
  let quote: string | null = null;

  for (let i = open; i < source.length; i++) {
    const char = source[i]!;
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * Top-level statements, split on `;` at depth zero.
 *
 * Comments and blank lines are dropped rather than carried: a comment written
 * against a raw step ("// 2. Enter the password") describes a line that is
 * about to move into another file, so keeping it would leave the spec
 * annotated with steps it no longer performs.
 */
function splitStatements(body: string): string[] {
  const statements: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth++;
    else if (char === ")" || char === "]" || char === "}") depth--;
    else if (char === ";" && depth === 0) {
      statements.push(body.slice(start, i));
      start = i + 1;
    }
  }
  if (body.slice(start).trim()) statements.push(body.slice(start));

  return statements.map(stripComments).filter(Boolean);
}

function stripComments(statement: string): string {
  return statement
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"))
    .join(" ")
    .trim();
}

const ACTION = /^await\s+(\w+)\.(\w+)\((.*)\)$/s;
const READ = /^const\s+(\w+)\s*(?::[^=]+)?=\s*await\s+(\w+)\.(\w+)\((.*)\)$/s;
const ASSERTION = /^await\s+expect\s*\(|^expect\s*\(/;

function classify(statement: string, kinds: Map<string, string>): Classified | null {
  if (ASSERTION.test(statement)) return { kind: "assertion", text: statement };

  const read = READ.exec(statement);
  if (read) {
    const [, variable, instance, method] = read;
    const kind = kinds.get(`${instance}.${method}`);
    // A value-producing call assigned to a name is what becomes an Output
    // field. A void method assigned to something is not a shape this
    // recognises.
    if (kind !== "read" && kind !== "check") return null;
    return {
      kind: "read",
      instance: instance!,
      method: method!,
      variable: variable!,
      // Known exactly, from the interaction the method was generated for:
      // getText returns a string, isVisible a boolean.
      produces: kind === "check" ? "boolean" : "string",
      text: statement,
    };
  }

  const action = ACTION.exec(statement);
  if (action) {
    const [, instance, method, callArgs] = action;
    const kind = kinds.get(`${instance}.${method}`);
    // `open()` is generated by renderPage rather than by methodsFor, so it is
    // never in the map — but it is unambiguously an action.
    if (method !== "open" && kind !== "click" && kind !== "type" && kind !== "wait") return null;
    return { kind: "action", instance: instance!, method: method!, args: callArgs!.trim(), text: statement };
  }

  return null;
}

/** `homePage.clickGo` -> `click`, for every method the page objects expose. */
function interactionsByCall(pages: PageFact[]): Map<string, string> {
  const kinds = new Map<string, string>();
  for (const page of pages) {
    const instance = instanceName(page.className);
    for (const element of page.elements) {
      for (const { name, interaction } of methodsFor(element)) {
        kinds.set(`${instance}.${name}`, interaction);
      }
    }
  }
  return kinds;
}

/**
 * Arguments the caller has to keep supplying.
 *
 * A literal stays inside the flow — it is part of what the flow *is*, and
 * pulling every string out into a parameter would leave a function whose
 * signature is longer than its body. Anything else (a credential read from the
 * environment, a value computed in the spec) becomes an input, because the
 * flow cannot know it.
 */
function collectInputs(steps: Classified[], pages: PageFact[]): InputField[] {
  const inputs: InputField[] = [];
  const propertyByMethod = new Map<string, string>();

  for (const page of pages) {
    const instance = instanceName(page.className);
    for (const element of page.elements) {
      for (const { name } of methodsFor(element)) {
        propertyByMethod.set(`${instance}.${name}`, element.property);
      }
    }
  }

  for (const step of steps) {
    if (step.kind !== "action" || !step.args) continue;
    if (isLiteral(step.args)) continue;

    const field = propertyByMethod.get(`${step.instance}.${step.method}`);
    if (!field || inputs.some((i) => i.field === field)) continue;
    inputs.push({ field, expression: step.args });
  }

  return inputs;
}

function isLiteral(expression: string): boolean {
  return /^(['"`]).*\1$/s.test(expression.trim()) || /^-?\d+(\.\d+)?$/.test(expression.trim());
}

function usedPages(steps: Classified[], pages: PageFact[]): PageFact[] {
  const wanted = new Set(steps.map((s) => (s.kind === "assertion" ? "" : s.instance)));
  return pages.filter((p) => wanted.has(instanceName(p.className)));
}

/**
 * `Verify the "Free" tag is shown` -> `verifyTheFreeTagIsShown`.
 *
 * Derived from the plan's own title, which came from the human's prompt — the
 * one place in this pipeline that knows what the steps *mean*. Naming from the
 * page-object calls alone (all `flow.ts` can see) would produce
 * `clickAndTypeAndClick`, which is why extraction lives here and not there.
 */
export function flowName(title: string): string | null {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return null;

  const identifier = words
    .slice(0, 8)
    .map((word, index) => (index === 0 ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join("");

  return /^[0-9]/.test(identifier) ? `flow${identifier[0]!.toUpperCase()}${identifier.slice(1)}` : identifier;
}

function renderFlowModule(args: {
  name: string;
  title: string;
  steps: Classified[];
  inputs: InputField[];
  outputs: OutputField[];
  pagesUsed: PageFact[];
  language: ProjectLanguage;
  /** An existing flow that already performs this one's opening steps. */
  delegate?: { flow: FlowRecord; steps: number };
}): string {
  const ts = args.language === "ts";
  const capital = args.name[0]!.toUpperCase() + args.name.slice(1);
  const inputType = `${capital}Input`;
  const outputType = `${capital}Output`;

  const pageImports = args.pagesUsed
    .map((p) => `import { ${instanceName(p.className)} } from '../pages/${p.className}.js';`)
    .join("\n");
  const delegateImport = args.delegate
    ? `\nimport { ${args.delegate.flow.name} } from './${args.delegate.flow.name}.js';`
    : "";

  // Ahead of the function and its doc comment, so the comment documents the
  // function rather than whichever interface happens to precede it.
  const interfaces = !ts
    ? ""
    : [
        args.inputs.length > 0
          ? `export interface ${inputType} {\n${args.inputs
              .map((i) => `  /** Passed to ${i.field}. */\n  ${i.field}?: string;`)
              .join("\n")}\n}`
          : "",
        args.outputs.length > 0
          ? `export interface ${outputType} {\n${args.outputs.map((o) => `  ${o.field}: ${o.type};`).join("\n")}\n}`
          : "",
      ]
        .filter(Boolean)
        .map((block) => `${block}\n\n`)
        .join("");

  const parameter = args.inputs.length === 0 ? "" : ts ? `input: ${inputType} = {}` : "input = {}";
  const returnType = ts ? `: Promise<${args.outputs.length > 0 ? outputType : "void"}>` : "";

  // The delegated prefix becomes one call to the flow that already performs
  // it, so the login screen (or whatever it is) has exactly one definition.
  const delegated = args.delegate
    ? [
        `  await ${args.delegate.flow.name}(${delegatedArguments(args.delegate.flow, args.inputs)});`,
        ...args.steps.slice(args.delegate.steps).map(renderStep(args.inputs)),
      ]
    : args.steps.map(renderStep(args.inputs));

  const body = delegated.filter(Boolean).join("\n");

  const returns =
    args.outputs.length > 0 ? `\n\n  return { ${args.outputs.map((o) => o.field).join(", ")} };` : "";

  return `import { step } from '@testlab/framework';
${pageImports}${delegateImport}

${interfaces}/**
 * ${args.title}
 *
 * Extracted from a verified run. Composes page objects into one named
 * operation and returns what it observed — the spec that calls it holds the
 * assertions. Safe to rename, re-order or extend by hand: nothing regenerates
 * over the top of this file.
 */
export async function ${args.name}(${parameter})${returnType} {
  step(${JSON.stringify(args.title)});
${body}${returns}
}
`;
}

function renderStep(inputs: InputField[]): (step: Classified) => string {
  return (step) => {
    if (step.kind === "assertion") return "";
    if (step.kind === "read") return `  const ${step.variable} = await ${step.instance}.${step.method}();`;
    return `  await ${step.instance}.${step.method}(${argumentFor(step, inputs)});`;
  };
}

/** Forward this flow's own inputs to the one it delegates its opening to. */
function delegatedArguments(flow: FlowRecord, inputs: InputField[]): string {
  const forwarded = flow.inputFields.filter((field) => inputs.some((i) => i.field === field));
  if (forwarded.length === 0) return "";
  return `{ ${forwarded.map((field) => `${field}: input.${field}`).join(", ")} }`;
}

function argumentFor(step: Extract<Classified, { kind: "action" }>, inputs: InputField[]): string {
  if (!step.args) return "";
  if (isLiteral(step.args)) return step.args;
  const match = inputs.find((i) => i.expression === step.args);
  return match ? `input.${match.field}` : step.args;
}

/** The scenario's new body: one flow call, then its assertions. */
function renderBody(args: {
  indent: string;
  name: string;
  inputs: InputField[];
  outputs: OutputField[];
  assertions: Array<{ text: string }>;
  /**
   * What the spec's own read variables were called, positionally aligned with
   * `outputs`. The two differ when reusing an existing flow, whose field names
   * win — the assertions have to be rebound from the local name to that name.
   */
  localNames: string[];
}): string {
  const inner = `${args.indent}  `;
  const fields = args.outputs.map((o) => o.field);
  const outcome = resultName(fields);

  const call =
    args.inputs.length === 0
      ? `await ${args.name}()`
      : `await ${args.name}({\n${args.inputs
          .map((i) => `${inner}  ${i.field}: ${i.expression},`)
          .join("\n")}\n${inner}})`;

  const assignment = args.outputs.length > 0 ? `const ${outcome} = ${call};` : `${call};`;

  // Every read the flow absorbed is now a field on what it returned, so the
  // assertions have to look there instead of at a local that no longer exists.
  const rebound = args.assertions.map((assertion) => {
    let text = assertion.text;
    args.localNames.forEach((local, i) => {
      const field = fields[i] ?? local;
      text = text.replace(new RegExp(`\\b${escapeRegExp(local)}\\b`, "g"), `${outcome}.${field}`);
    });
    return `${inner}${text};`;
  });

  const body = [`${inner}${assignment}`, "", ...rebound].join("\n");
  return `\n${body}\n${args.indent}`;
}

/**
 * A name for the flow's result that cannot collide with one of its own
 * fields — a spec whose read was called `result` would otherwise produce
 * `result.result`.
 */
function resultName(outputs: string[]): string {
  for (const candidate of ["outcome", "result", "flowResult"]) {
    if (!outputs.includes(candidate)) return candidate;
  }
  return "flowOutcome";
}

/**
 * Rewrite the import block for what the spec now actually uses.
 *
 * Not simply "one flow import and nothing else": a file can hold a scenario
 * that was lifted next to one that was not (a hand-edited block, say), and
 * that second scenario still needs its page objects. So imports are recomputed
 * from what the rewritten body references, which is the only thing that can be
 * right in both cases.
 */
function rebuildImports(spec: string, flows: ExtractedFlow[], pages: PageFact[]): string {
  const firstImport = spec.search(/^import\b/m);
  const body = spec.replace(/^import[^\n]*\n/gm, "");

  // Flows this run lifted, plus any the file already called — a scenario
  // lifted by an earlier run is not in `flows`, and dropping its import would
  // leave the spec calling a function it no longer imports.
  const names = new Set(flows.map((f) => f.name));
  for (const [, existing] of spec.matchAll(/import\s*\{\s*(\w+)\s*\}\s*from\s*'\.\.\/\.\.\/src\/flows\/\w+\.js'/g)) {
    if (new RegExp(`\\b${escapeRegExp(existing!)}\\s*\\(`).test(body)) names.add(existing!);
  }

  const lines = [...names].map((name) => `import { ${name} } from '../../src/flows/${name}.js';`);

  for (const page of pages) {
    const instance = instanceName(page.className);
    if (new RegExp(`\\b${escapeRegExp(instance)}\\.`).test(body)) {
      lines.push(`import { ${instance} } from '../../src/pages/${page.className}.js';`);
    }
  }

  // Framework helpers, if an unlifted scenario still calls one directly.
  const helpers = [...new Set([...body.matchAll(/\b(click|type|getText|isVisible|waitForGone|waitForPageLoad|dismissIfPresent|selectOption)\s*\(/g)].map((m) => m[1]!))];
  if (helpers.length > 0) lines.push(`import { ${helpers.sort().join(", ")} } from '@testlab/framework';`);

  const head = firstImport === -1 ? "" : spec.slice(0, firstImport);
  return `${head}${lines.join("\n")}\n${body.slice(head.length).replace(/^\n+/, "\n")}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function instanceName(className: string): string {
  return className[0]!.toLowerCase() + className.slice(1);
}
