import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { FrameworkIndex } from "../framework/types.js";
import type { FileChange } from "./types.js";

export type TypecheckStatus = "passed" | "failed" | "skipped";

export interface TypecheckDiagnostic {
  line: number;
  column: number;
  message: string;
  code: number;
  /** True when the error is in the candidate spec rather than elsewhere. */
  inCandidate: boolean;
}

export interface TypecheckResult {
  status: TypecheckStatus;
  reason?: string;
  diagnostics: TypecheckDiagnostic[];
}

/**
 * Compile the candidate spec against the framework, without keeping it.
 *
 * This is the useful middle rung between "read the preview" and "run the test":
 * it needs no browser and no running application, but it still catches the
 * failures that actually happen — an import path that does not resolve, a
 * method that does not exist on the class, a wrong argument type, an alias the
 * project does not define.
 *
 * The file is written to its real destination so that path aliases and the
 * tsconfig `include` behave exactly as they will after a real write, then
 * removed (or the previous content restored) in a finally block.
 */
export async function typecheckChange(index: FrameworkIndex, change: FileChange): Promise<TypecheckResult> {
  if (index.layout.language !== "ts") {
    return { status: "skipped", reason: "Framework is JavaScript — there is nothing to typecheck.", diagnostics: [] };
  }

  const configPath = path.join(index.root, "tsconfig.json");
  if (!(await exists(configPath))) {
    return { status: "skipped", reason: "No tsconfig.json in the framework.", diagnostics: [] };
  }
  if (!(await exists(path.join(index.root, "node_modules")))) {
    return {
      status: "skipped",
      reason: "The framework's dependencies are not installed, so its types cannot be resolved. Run `npm install` in the framework, then try again.",
      diagnostics: [],
    };
  }

  const target = path.join(index.root, change.path);
  const previous = await readIfExists(target);

  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, change.after, "utf8");

    const diagnostics = await compile(index.root, configPath, target);
    const inCandidate = diagnostics.filter((d) => d.inCandidate);

    return {
      // Pre-existing errors elsewhere in the project are not this spec's fault,
      // so only errors in the candidate decide pass/fail.
      status: inCandidate.length === 0 ? "passed" : "failed",
      diagnostics,
    };
  } finally {
    if (previous === null) {
      await fs.rm(target, { force: true });
    } else {
      await fs.writeFile(target, previous, "utf8");
    }
  }
}

async function compile(root: string, configPath: string, candidate: string): Promise<TypecheckDiagnostic[]> {
  const raw = ts.readConfigFile(configPath, ts.sys.readFile);
  if (raw.error) {
    return [{ line: 0, column: 0, code: 0, inCandidate: false, message: flatten(raw.error.messageText) }];
  }

  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, root);
  const fileNames = parsed.fileNames.includes(candidate) ? parsed.fileNames : [...parsed.fileNames, candidate];

  const program = ts.createProgram({
    rootNames: fileNames,
    options: { ...parsed.options, noEmit: true },
  });

  const source = program.getSourceFile(candidate);
  const all = [
    ...program.getSemanticDiagnostics(source),
    ...program.getSyntacticDiagnostics(source),
    // Whole-program errors that would break the build regardless.
    ...program.getGlobalDiagnostics(),
  ];

  const normalized = path.normalize(candidate).toLowerCase();

  return all.slice(0, 40).map((diagnostic) => {
    const file = diagnostic.file;
    const position =
      file && diagnostic.start !== undefined
        ? file.getLineAndCharacterOfPosition(diagnostic.start)
        : { line: 0, character: 0 };

    return {
      line: position.line + 1,
      column: position.character + 1,
      code: diagnostic.code,
      message: flatten(diagnostic.messageText),
      inCandidate: !!file && path.normalize(file.fileName).toLowerCase() === normalized,
    };
  });
}

function flatten(message: string | ts.DiagnosticMessageChain): string {
  return ts.flattenDiagnosticMessageText(message, " ");
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}
