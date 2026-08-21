import path from "node:path";
import type { FrameworkIndex, MethodInfo } from "../framework/types.js";
import type { PlanProblem, PlanStep, ResolvedCall, TestPlan, TestRequest } from "./types.js";

/**
 * Turn a request into a plan using only what the index actually contains.
 *
 * No model, no fuzzy guessing. Every reference either resolves to a real
 * method or becomes a problem with concrete suggestions. That is the whole
 * point: this cannot invent a method, so anything it emits is callable.
 */
export function resolvePlan(index: FrameworkIndex, request: TestRequest): TestPlan {
  const steps: PlanStep[] = [];
  const problems: PlanProblem[] = [];
  const reused = new Set<string>();

  const dataAlias = request.data?.as ?? "data";

  for (const step of request.steps) {
    const reference = "use" in step ? step.use : step.expect;
    const resolution = resolveCapability(index, reference, request.platform);

    if (!resolution.call) {
      problems.push({ reference, reason: resolution.reason, suggestions: resolution.suggestions });
      continue;
    }

    const call = resolution.call;
    reused.add(`${call.className}.${call.method}`);

    const args = (step.args ?? []).map((arg) => literal(arg, dataAlias));
    if (args.length < call.requiredParams) {
      problems.push({
        reference,
        reason: `${call.className}.${call.method} needs ${call.requiredParams} argument(s), ${args.length} supplied.`,
        suggestions: [],
      });
      continue;
    }

    if ("use" in step) {
      steps.push({ kind: "action", call, args, comment: step.comment });
    } else {
      steps.push({
        kind: "assertion",
        call,
        args,
        matcher: step.matcher,
        value: step.value === undefined ? undefined : literal(step.value, dataAlias),
        comment: step.comment,
      });
    }
  }

  // A spec whose only steps are actions proves nothing — refuse rather than
  // emit a green test that asserts nothing.
  if (problems.length === 0 && !steps.some((s) => s.kind === "assertion")) {
    problems.push({
      reference: "(assertions)",
      reason: "The plan has no assertion. A test that only performs actions cannot fail meaningfully.",
      suggestions: assertionCandidates(index, request.platform),
    });
  }

  const data = resolveData(index, request);
  if (request.data && !data) {
    problems.push({
      reference: request.data.file,
      reason: `No dataset named "${request.data.file}" was found.`,
      suggestions: index.data.map((d) => d.name),
    });
  }

  return {
    title: request.title,
    test: request.test,
    platform: request.platform,
    specPath: resolveSpecPath(index, request),
    steps,
    reused: [...reused].sort(),
    problems,
    data,
    complete: problems.length === 0,
  };
}

interface Resolution {
  call?: ResolvedCall;
  reason: string;
  suggestions: string[];
}

/** Resolve "ClassName.methodName" against page objects, then helpers. */
function resolveCapability(index: FrameworkIndex, reference: string, platform: "web" | "mobile"): Resolution {
  const [className, methodName] = splitReference(reference);
  if (!className || !methodName) {
    return {
      reason: `"${reference}" is not in the form ClassName.methodName.`,
      suggestions: [],
    };
  }

  const page = index.pageObjects.find((p) => p.className === className);
  if (page) {
    const method = page.methods.find((m) => m.name === methodName);
    if (!method) {
      return {
        reason: `${className} has no public method "${methodName}".`,
        suggestions: page.methods.map((m) => `${className}.${m.name}`),
      };
    }
    if (page.platform !== "shared" && page.platform !== platform) {
      return {
        reason: `${className} is a ${page.platform} page object but this is a ${platform} test.`,
        suggestions: [],
      };
    }
    return {
      call: {
        className,
        method: methodName,
        importPath: page.importPath,
        exportStyle: page.exportStyle,
        defaultExport: page.defaultExport,
        kind: "page",
        isStatic: method.isStatic,
        ...arity(method),
      },
      reason: "",
      suggestions: [],
    };
  }

  const helper = index.helpers.find((h) => h.className === className);
  if (helper) {
    const method = helper.methods.find((m) => m.name === methodName);
    if (!method) {
      return {
        reason: `${className} has no public method "${methodName}".`,
        suggestions: helper.methods.map((m) => `${className}.${m.name}`),
      };
    }
    return {
      call: {
        className,
        method: methodName,
        importPath: helper.importPath,
        exportStyle: "class",
        defaultExport: false,
        kind: "helper",
        isStatic: method.isStatic,
        ...arity(method),
      },
      reason: "",
      suggestions: [],
    };
  }

  return {
    reason: `No page object or helper named "${className}".`,
    suggestions: [
      ...index.pageObjects.map((p) => p.className),
      ...index.helpers.map((h) => h.className),
    ].sort(),
  };
}

function arity(method: MethodInfo): { paramCount: number; requiredParams: number } {
  return {
    paramCount: method.params.length,
    requiredParams: method.params.filter((p) => !p.optional).length,
  };
}

function splitReference(reference: string): [string | undefined, string | undefined] {
  const at = reference.lastIndexOf(".");
  if (at <= 0) return [undefined, undefined];
  return [reference.slice(0, at), reference.slice(at + 1)];
}

/**
 * Render an argument as source.
 *
 * A string of the form `data.field` (or `<alias>.field`) is emitted as a live
 * reference into the loaded dataset rather than a quoted literal — that is what
 * makes "only the test data changes" true in practice.
 */
function literal(value: unknown, dataAlias: string): string {
  if (typeof value === "string") {
    const reference = asDataReference(value, dataAlias);
    if (reference) return reference;
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
  return JSON.stringify(value);
}

/**
 * Recognise a reference into the loaded dataset.
 *
 * Models reach for whichever placeholder syntax they have seen most —
 * `product.name`, `<product.name>`, `{{product.name}}`, `${product.name}` — and
 * quoting one of those emits a spec that searches for the literal text
 * "<product.name>". Accepting all of them keeps the data binding intact
 * regardless of which style turns up.
 */
function asDataReference(value: string, alias: string): string | null {
  const unwrapped = value
    .trim()
    .replace(/^\$\{(.*)\}$/s, "$1")
    .replace(/^\{\{(.*)\}\}$/s, "$1")
    .replace(/^<(.*)>$/s, "$1")
    .trim();

  // Only a bare property path off the alias qualifies; anything else is text.
  const pattern = new RegExp(`^${escapeRegExp(alias)}(\\.[A-Za-z_$][\\w$]*|\\[\\d+\\])+$`);
  return pattern.test(unwrapped) ? unwrapped : null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveData(index: FrameworkIndex, request: TestRequest): TestPlan["data"] {
  if (!request.data) return undefined;
  const match = index.data.find((d) => d.name === request.data!.file);
  if (!match) return undefined;
  return {
    file: match.name,
    index: request.data.index ?? 0,
    as: request.data.as ?? "data",
  };
}

function resolveSpecPath(index: FrameworkIndex, request: TestRequest): string {
  if (request.specPath) return path.resolve(index.root, request.specPath);

  const dir = index.layout.specsDir ?? "test/specs";
  const slug =
    request.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "generated";

  return path.resolve(index.root, dir, `${slug}${specSuffix(index, request.platform)}`);
}

/**
 * Name the file so the project's own runner picks it up.
 *
 * A config globbing `./test/specs/**‌/*.ios.spec.ts` only sees files ending
 * `.ios.spec.ts`. Deriving the suffix from that glob means a generated spec
 * joins the existing suite automatically, instead of needing --spec forever.
 */
function specSuffix(index: FrameworkIndex, platform: "web" | "mobile"): string {
  const ext = index.layout.language === "ts" ? ".ts" : ".js";
  const wanted = platform === "web" ? ["web", "default"] : ["android", "ios", "mobile"];

  const candidates = index.configs
    .filter((c) => wanted.some((name) => c.platform.toLowerCase().includes(name)))
    .flatMap((c) => c.specs);

  for (const glob of candidates) {
    const basename = glob.split("/").pop() ?? "";
    // `*.ios.spec.ts` -> `.ios.spec.ts`; a literal name yields nothing usable.
    const match = /^\*(\.[^*]+)$/.exec(basename);
    if (match?.[1]) return match[1];
  }

  return `.spec${ext}`;
}

/** Read-shaped methods make the best assertion targets. */
function assertionCandidates(index: FrameworkIndex, platform: "web" | "mobile"): string[] {
  return index.pageObjects
    .filter((p) => p.platform === "shared" || p.platform === platform)
    .flatMap((p) =>
      p.methods
        .filter((m) => /^(get|is|has|count)/i.test(m.name))
        .map((m) => `${p.className}.${m.name}`),
    )
    .slice(0, 12);
}
