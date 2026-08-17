import { Context, Effect, Layer } from "effect";

/**
 * What the live renderer needs to know about the stream it draws on.
 *
 * This exists because Effect's seams answer for the wrong stream. `Stdio`
 * exposes `stdinIsTerminal` and `stdoutIsTerminal` but no standard-error
 * check, and `Terminal.columns` reports the standard-output terminal. The
 * renderer draws on standard error so that `mze build | tee` receives results
 * rather than animation frames, and `mze build > log` still animates. Both
 * facts point at the same escape, so it lives here once, behind a seam tests
 * can replace, instead of scattered `process.stderr` reads.
 */
export interface Interface {
  /** Whether the render stream is a terminal that can accept cursor control. */
  readonly isTerminal: Effect.Effect<boolean>;
  /** Width of the render stream, read fresh so a resize needs no signal handler. */
  readonly columns: Effect.Effect<number>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@mze-store/tooling/TerminalCapabilities",
) {}

/** Width assumed when the stream reports none, matching the common terminal default. */
const FALLBACK_COLUMNS = 80;

/**
 * A usable width from whatever the stream reports.
 *
 * Some pseudo-terminals — `script`, parts of CI, some multiplexers — report a
 * width of `0` rather than omitting it. Taken literally that leaves no room for
 * any text, so every label truncates to nothing.
 */
export const resolveColumns = (reported: number | undefined): number =>
  reported !== undefined && reported > 0 ? reported : FALLBACK_COLUMNS;

export const layer = Layer.sync(Service, () =>
  Service.of({
    columns: Effect.sync(() => resolveColumns(process.stderr.columns)),
    isTerminal: Effect.sync(() => process.stderr.isTTY === true),
  }),
);

export interface FixedOptions {
  readonly isTerminal: boolean;
  readonly columns?: number;
}

/** A deterministic terminal for tests. */
export const fixed = (options: FixedOptions) =>
  Layer.succeed(
    Service,
    Service.of({
      columns: Effect.succeed(resolveColumns(options.columns)),
      isTerminal: Effect.succeed(options.isTerminal),
    }),
  );

export * as TerminalCapabilities from "./terminal-capabilities.ts";
