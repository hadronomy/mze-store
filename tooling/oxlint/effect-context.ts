import { Context, Layer } from "effect";
import type { Context as OxlintContext, Diagnostic, Options, SourceCode } from "@oxlint/plugins";

export class FileContextUnavailable extends Error {
  readonly _tag = "FileContextUnavailable";

  constructor() {
    super("FileContext is available only during a file callback");
  }
}

export class FileContextClosed extends Error {
  readonly _tag = "FileContextClosed";

  constructor() {
    super("FileContext is closed after the file callback");
  }
}

export interface FileFrame {
  readonly id: string;
  readonly options: Readonly<Options>;
  readonly filename: string;
  readonly physicalFilename: string;
  readonly cwd: string;
  readonly sourceCode: SourceCode;
  readonly report: (diagnostic: Diagnostic) => void;
}

export interface FileContextShape {
  readonly use: <A>(callback: (file: FileFrame) => A) => A;
}

export class FileContext extends Context.Service<FileContext, FileContextShape>()(
  "@mze-store/oxlint/FileContext",
) {}

export interface FileContextController {
  readonly service: FileContextShape;
  readonly before: () => void;
  readonly close: () => void;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

export const makeController = (context: OxlintContext): FileContextController => {
  let current: FileFrame | undefined;
  let open = false;
  let epoch = 0;

  const service: FileContextShape = {
    use<A>(callback: (file: FileFrame) => A): A {
      if (!current) {
        throw new FileContextUnavailable();
      }

      const result = callback(current);

      if (isPromiseLike(result)) {
        throw new TypeError("FileContext.use callbacks must return synchronously");
      }

      return result;
    },
  };

  return {
    service,
    before() {
      open = true;
      const frameEpoch = ++epoch;
      const frame: FileFrame = {
        id: context.id,
        options: context.options,
        filename: context.filename,
        physicalFilename: context.physicalFilename,
        cwd: context.cwd,
        sourceCode: context.sourceCode,
        report(diagnostic) {
          if (!open || frameEpoch !== epoch) {
            throw new FileContextClosed();
          }

          context.report(diagnostic);
        },
      };
      current = frame;
    },
    close() {
      open = false;
      epoch += 1;
      current = undefined;
    },
  };
};

export const layer = (service: FileContextShape) => Layer.succeed(FileContext, service);
