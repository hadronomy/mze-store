import { Context, Effect, Layer } from "effect";
import type { Context as OxlintContext, Diagnostic, Options, SourceCode } from "@oxlint/plugins";

export interface FileContextShape {
  readonly id: string;
  readonly options: Readonly<Options>;
  readonly filename: string;
  readonly physicalFilename: string;
  readonly cwd: string;
  readonly sourceCode: SourceCode;
  readonly report: (diagnostic: Diagnostic) => void;
}

export class FileContext extends Context.Service<FileContext, FileContextShape>()(
  "@mze-store/oxlint/FileContext",
) {}

/**
 * Create a file view that reads the host context when a property is used.
 * Oxlint gives createOnce a setup context before it selects the current file.
 */
export const fromOxlint = (context: OxlintContext): FileContextShape => ({
  get id() {
    return context.id;
  },
  get options() {
    return context.options;
  },
  get filename() {
    return context.filename;
  },
  get physicalFilename() {
    return context.physicalFilename;
  },
  get cwd() {
    return context.cwd;
  },
  get sourceCode() {
    return context.sourceCode;
  },
  report(diagnostic) {
    context.report(diagnostic);
  },
});

export const layer = (context: OxlintContext) => Layer.succeed(FileContext, fromOxlint(context));

export const provide = <A, E, R>(
  context: OxlintContext,
  effect: Effect.Effect<A, E, R | FileContext>,
): Effect.Effect<A, E, R> => effect.pipe(Effect.provide(layer(context)));

export const service = (context: OxlintContext): FileContextShape => fromOxlint(context);
