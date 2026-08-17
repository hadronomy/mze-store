import ansiEscapes from "ansi-escapes";
import { Chalk, type ChalkInstance } from "chalk";
import { Context, Effect, Fiber, Layer, Ref, Stdio, Stream } from "effect";
import type { PlatformError } from "effect/PlatformError";

import { TaskLog } from "./task-log.ts";
import { TerminalCapabilities } from "./terminal-capabilities.ts";

export type Status = "pending" | "running" | "succeeded" | "failed" | "skipped";

/**
 * One Vite+ task running inside a phase.
 *
 * These rows are transient: a task appears when the runner announces it and
 * leaves when the runner closes it. They carry no mark, because the runner
 * never says in the stream whether a task passed.
 */
export interface Subtask {
  readonly task: string;
  readonly command: string;
  readonly startedAt: number;
}

export interface Row {
  readonly name: string;
  readonly status: Status;
  /** Last meaningful line the phase printed. Shown when no subtask is known. */
  readonly tail: string;
  /** Everything the phase printed, kept whole so a failure can show its first error. */
  readonly buffer: string;
  readonly subtasks: ReadonlyArray<Subtask>;
  readonly startedAt?: number;
  readonly elapsedMillis?: number;
}

export interface State {
  readonly rows: ReadonlyArray<Row>;
  readonly spinner: number;
  /** Partial trailing line of child output, awaiting the chunk that ends it. */
  readonly pending: string;
}

export interface FrameOptions {
  readonly colors: ChalkInstance;
  readonly columns: number;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const FRAME_INTERVAL = "80 millis";
const ROW_INDENT = "  ";
const TAIL_INDENT = "    ";
const SUBTASK_INDENT = "      ";
/** Vite+ runs four tasks at once by default; the cap only guards a raised limit. */
const MAX_SUBTASK_ROWS = 5;

export const elapsed = (millis: number): string => {
  if (millis < 60_000) {
    return `${(millis / 1000).toFixed(1)}s`;
  }

  const seconds = Math.round(millis / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
};

export const truncate = (text: string, width: number): string => {
  if (width <= 1) {
    return "";
  }

  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
};

/**
 * The last line worth showing from a chunk of child output.
 *
 * Returns undefined when the chunk carries no text, so a run of blank lines
 * leaves the previous tail in place rather than blanking the row.
 */
export const lastLine = (text: string): string | undefined => {
  const lines = TaskLog.plainText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  return lines.at(-1);
};

const mark = (row: Row, spinner: number, colors: ChalkInstance): string => {
  switch (row.status) {
    case "running":
      return colors.cyan(SPINNER_FRAMES[spinner % SPINNER_FRAMES.length]!);
    case "succeeded":
      return colors.green("✔");
    case "failed":
      return colors.red("✗");
    default:
      return colors.dim("○");
  }
};

const suffix = (row: Row, colors: ChalkInstance): string => {
  if (row.status === "skipped") {
    return colors.dim("skipped");
  }

  return row.elapsedMillis === undefined ? "" : colors.dim(elapsed(row.elapsedMillis));
};

const rowLines = (row: Row, spinner: number, options: FrameOptions): ReadonlyArray<string> => {
  const { colors, columns } = options;
  const quiet = row.status === "pending" || row.status === "skipped";
  const detail = suffix(row, colors);
  const head = `${ROW_INDENT}${mark(row, spinner, colors)} ${quiet ? colors.dim(row.name) : row.name}${
    detail === "" ? "" : `  ${detail}`
  }`;

  if (row.status !== "running") {
    return [head];
  }

  // Subtask rows say more than the tail ever did, so they replace it. The tail
  // stays as the fallback for a phase whose command is not a Vite+ task run.
  if (row.subtasks.length > 0) {
    const shown = row.subtasks.slice(0, MAX_SUBTASK_ROWS);
    const hidden = row.subtasks.length - shown.length;
    const width = columns - SUBTASK_INDENT.length - 3;
    const lines = shown.map((subtask) => {
      const label = subtask.command === "" ? subtask.task : `${subtask.task}  ${subtask.command}`;
      return `${SUBTASK_INDENT}${colors.cyan(
        SPINNER_FRAMES[spinner % SPINNER_FRAMES.length]!,
      )} ${colors.dim(truncate(label, width))}`;
    });

    return hidden > 0
      ? [head, ...lines, `${SUBTASK_INDENT}${colors.dim(`+${hidden} more`)}`]
      : [head, ...lines];
  }

  if (row.tail === "") {
    return [head];
  }

  return [
    head,
    `${TAIL_INDENT}${colors.dim(truncate(row.tail, columns - TAIL_INDENT.length - 1))}`,
  ];
};

/**
 * Fold the markers found in a batch of lines into the running task set.
 *
 * A task can announce twice under one name because Vite+ splits a compound
 * `a && b` command into separate runs, so a start replaces any entry it shares
 * a name with rather than adding beside it.
 */
export const applyMarkers = (
  subtasks: ReadonlyArray<Subtask>,
  lines: ReadonlyArray<string>,
  now: number,
): ReadonlyArray<Subtask> =>
  lines.reduce<ReadonlyArray<Subtask>>((current, line) => {
    const found = TaskLog.marker(line);

    if (found === undefined) {
      return current;
    }

    const without = current.filter(({ task }) => task !== found.task);
    return found.kind === "started"
      ? [...without, { command: found.command, startedAt: now, task: found.task }]
      : without;
  }, subtasks);

/** The whole block, newline-terminated. Pure, so the shape is cheap to assert. */
export const frame = (state: State, options: FrameOptions): string => {
  if (state.rows.length === 0) {
    return "";
  }

  return `${state.rows.flatMap((row) => rowLines(row, state.spinner, options)).join("\n")}\n`;
};

export type Mode =
  /** Animated rows. Only ever selected for a terminal. */
  | "live"
  /** One line per transition, for a pipe, a log file, or CI. */
  | "plain"
  /** Child output passes through, framed by a delimiter per phase. */
  | "verbose";

export interface Interface {
  /** Declare every phase up front so the reader can see how many remain. */
  readonly begin: (phases: ReadonlyArray<string>) => Effect.Effect<void, PlatformError>;
  readonly transition: (
    phase: string,
    status: Exclude<Status, "pending">,
  ) => Effect.Effect<void, PlatformError>;
  /**
   * Route one chunk of child output: captured always, displayed per mode.
   *
   * Output produced while no phase runs passes straight through on its own
   * stream, so a command without rows behaves exactly as it did before.
   */
  readonly childOutput: (
    text: string,
    stream: "stdout" | "stderr",
  ) => Effect.Effect<void, PlatformError>;
  /** Settle the list: whatever never ran is reported skipped, not erased. */
  readonly end: Effect.Effect<void, PlatformError>;
  /** Write a plain line without corrupting a live frame. */
  readonly write: (text: string) => Effect.Effect<void, PlatformError>;
  /** Everything the failed phase printed, for the block under the rows. */
  readonly failureOutput: Effect.Effect<string>;
}

export class Service extends Context.Service<Service, Interface>()("@mze-store/tooling/Renderer") {}

export interface Options {
  /** Force color in tests. Omit to use Chalk's stream detection. */
  readonly color?: boolean;
}

const startRow = (row: Row, now: number): Row => ({
  ...row,
  startedAt: now,
  status: "running",
});

const settleRow = (row: Row, status: Exclude<Status, "pending">, now: number): Row => ({
  ...row,
  elapsedMillis: row.startedAt === undefined ? undefined : now - row.startedAt,
  status,
  subtasks: [],
  tail: "",
});

export const layer = (mode: Mode, options: Options = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const stdio = yield* Stdio.Stdio;
      const capabilities = yield* TerminalCapabilities.Service;
      const colors =
        options.color === undefined ? new Chalk() : new Chalk({ level: options.color ? 1 : 0 });
      const state = yield* Ref.make<State>({ pending: "", rows: [], spinner: 0 });
      // Lines of the live frame currently on screen, so the next draw knows how
      // far up to reach. Zero in every non-animated mode.
      const drawn = yield* Ref.make(0);
      const animated = mode === "live" && (yield* capabilities.isTerminal);

      const writeTo = (stream: "stdout" | "stderr", text: string) =>
        text === ""
          ? Effect.void
          : Stream.make(text).pipe(
              Stream.run(
                stream === "stdout"
                  ? stdio.stdout({ endOnDone: false })
                  : stdio.stderr({ endOnDone: false }),
              ),
            );

      /** Frames always draw on the render stream, whatever the child used. */
      const writeText = (text: string) => writeTo("stderr", text);

      const clear = Effect.gen(function* () {
        const previous = yield* Ref.get(drawn);

        if (previous === 0) {
          return;
        }

        yield* writeText(ansiEscapes.cursorUp(previous) + ansiEscapes.eraseDown);
        yield* Ref.set(drawn, 0);
      });

      const draw = Effect.gen(function* () {
        if (!animated) {
          return;
        }

        const columns = yield* capabilities.columns;
        const current = yield* Ref.get(state);
        const text = frame(current, { colors, columns });

        yield* clear;
        yield* writeText(text);
        yield* Ref.set(drawn, text === "" ? 0 : text.split("\n").length - 1);
      });

      /**
       * Erase the frame, write the line, and leave repainting to the painter.
       *
       * Once the painter has stopped there is nothing to repaint, which is what
       * makes a line written after `end` the last thing on the terminal.
       */
      const write = (text: string) =>
        Effect.gen(function* () {
          yield* clear;
          yield* writeText(text);
        });

      if (animated) {
        yield* Effect.addFinalizer(() => writeText(ansiEscapes.cursorShow).pipe(Effect.ignore));
        yield* writeText(ansiEscapes.cursorHide);
      }

      /**
       * The one thing that paints frames.
       *
       * Its lifetime is the answer to "may the rows be redrawn?", so no flag
       * has to track that separately and no flag can disagree with it.
       */
      const painter = animated
        ? yield* Effect.gen(function* () {
            yield* Ref.update(state, (current) => ({ ...current, spinner: current.spinner + 1 }));
            yield* draw;
            yield* Effect.sleep(FRAME_INTERVAL);
          }).pipe(Effect.forever, Effect.forkScoped)
        : undefined;

      const delimiter = (phase: string) =>
        Effect.gen(function* () {
          const columns = yield* capabilities.columns;
          const rule = "─".repeat(Math.max(0, columns - phase.length - 5));
          yield* writeText(`\n${colors.dim("──")} ${colors.bold(phase)} ${colors.dim(rule)}\n`);
        });

      const begin = (phases: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          yield* Ref.update(state, (current) => ({
            ...current,
            rows: phases.map((name) => ({
              buffer: "",
              name,
              status: "pending" as const,
              subtasks: [],
              tail: "",
            })),
          }));
          yield* draw;
        });

      /** One row on its own line, for the modes that log instead of redraw. */
      const rowLine = (phase: string) =>
        Effect.gen(function* () {
          const columns = yield* capabilities.columns;
          const row = (yield* Ref.get(state)).rows.find((current) => current.name === phase);
          yield* writeText(
            frame(
              { pending: "", rows: row === undefined ? [] : [row], spinner: 0 },
              {
                colors,
                columns,
              },
            ),
          );
        });

      const transition = (phase: string, status: Exclude<Status, "pending">) =>
        Effect.gen(function* () {
          const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
          yield* Ref.update(state, (current) => ({
            ...current,
            // Each phase is its own process, so a half-written line cannot span
            // the boundary and must not be prefixed onto the next phase's first.
            pending: "",
            rows: current.rows.map((row) =>
              row.name === phase
                ? status === "running"
                  ? startRow(row, now)
                  : settleRow(row, status, now)
                : row,
            ),
          }));

          if (animated) {
            return yield* draw;
          }

          if (status !== "running") {
            return yield* rowLine(phase);
          }

          // A spinner glyph is noise in a log file, so a starting phase gets an
          // arrow in plain mode and a section rule in verbose mode.
          return yield* mode === "verbose"
            ? delimiter(phase)
            : writeText(`${ROW_INDENT}${colors.cyan("→")} ${phase}\n`);
        });

      const childOutput = (text: string, stream: "stdout" | "stderr") =>
        Effect.gen(function* () {
          const current = yield* Ref.get(state);

          // Output that belongs to no phase still belongs on screen: `mze test`
          // streams its reporters once the service row has settled, and a
          // command with no rows at all must behave as it always did.
          if (!current.rows.some((row) => row.status === "running")) {
            yield* clear;
            return yield* writeTo(stream, text);
          }

          const tail = lastLine(text);
          const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
          const taken = TaskLog.takeLines(current.pending, text);

          yield* Ref.update(state, (previous) => ({
            ...previous,
            pending: taken.pending,
            rows: previous.rows.map((row) =>
              row.status === "running"
                ? {
                    ...row,
                    buffer: `${row.buffer}${text}`,
                    subtasks: applyMarkers(row.subtasks, taken.lines, now),
                    tail: tail ?? row.tail,
                  }
                : row,
            ),
          }));

          // Verbose shows the child directly, so the capture is only a record.
          return mode === "verbose" ? yield* writeText(text) : undefined;
        });

      const end = Effect.gen(function* () {
        yield* Ref.update(state, (current) => ({
          ...current,
          rows: current.rows.map((row) =>
            row.status === "pending" ? { ...row, status: "skipped" as const } : row,
          ),
        }));

        if (painter !== undefined) {
          // Retire the painter first, so the frame it leaves is the final one.
          yield* Fiber.interrupt(painter);
          yield* draw;
          // Leave the settled block on screen: the next write must not erase it.
          yield* Ref.set(drawn, 0);
          return;
        }

        const current = yield* Ref.get(state);
        const skipped = current.rows.filter((row) => row.status === "skipped");
        yield* writeText(
          frame(
            { pending: "", rows: skipped, spinner: 0 },
            {
              colors,
              columns: yield* capabilities.columns,
            },
          ),
        );
      });

      const failureOutput = Effect.gen(function* () {
        // Verbose already printed every chunk as it arrived. Handing the buffer
        // back would print the whole failed phase a second time.
        if (mode === "verbose") {
          return "";
        }

        const current = yield* Ref.get(state);
        return current.rows.find((row) => row.status === "failed")?.buffer ?? "";
      });

      return Service.of({ begin, childOutput, end, failureOutput, transition, write });
    }),
  );

export * as Renderer from "./renderer.ts";
