/**
 * The two structural markers Vite+ prints around every task under `--log grouped`.
 *
 * Both come from the task runner rather than the tool it runs, which is what
 * makes them worth reading: `vp pack`, `tsc`, and `varlock` all announce
 * themselves differently, but the runner frames every one of them the same way.
 * A task's pass or fail state is deliberately absent — the runner does not put
 * it in the stream, so nothing here invents it.
 */

// CSI sequences only. Vite+ colours these lines, and the markers have to match
// after the colour is gone.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001B\[[0-9;?]*[A-Za-z]/g;

/** A task begins: `[@scope/pkg#build] ~/packages/pkg$ vp pack ◉ cache hit`. */
const STARTED_PATTERN = /^\[([^\]]+)\]\s+\S+\$\s+(.+)$/;

/** A task ends and its buffered block follows: `── [@scope/pkg#build] ──`. */
const FINISHED_PATTERN = /^──\s+\[([^\]]+)\]\s+──\s*$/;

/**
 * Cache state, appended to the command on a start line. Splitting on it keeps
 * the command readable; the state itself is noise on a row that is still running.
 */
const CACHE_STATUS_PATTERN = /\s*[⊘◉○✓✗].*$/;

export const plainText = (text: string): string => text.replaceAll(ANSI_PATTERN, "");

export interface Started {
  readonly kind: "started";
  readonly task: string;
  readonly command: string;
}

export interface Finished {
  readonly kind: "finished";
  readonly task: string;
}

export type Marker = Started | Finished;

export const marker = (line: string): Marker | undefined => {
  const text = plainText(line).trimEnd();
  const finished = FINISHED_PATTERN.exec(text);

  if (finished?.[1] !== undefined) {
    return { kind: "finished", task: finished[1] };
  }

  const started = STARTED_PATTERN.exec(text);

  if (started?.[1] === undefined || started[2] === undefined) {
    return undefined;
  }

  return {
    command: started[2].replace(CACHE_STATUS_PATTERN, "").trim(),
    kind: "started",
    task: started[1],
  };
};

export interface TakenLines {
  readonly lines: ReadonlyArray<string>;
  /** The partial trailing line, to be completed by the next chunk. */
  readonly pending: string;
}

/**
 * Split a chunk into whole lines.
 *
 * Child output arrives in arbitrary byte chunks that cut through the middle of
 * lines, so a marker is only safe to match once its line is complete.
 */
export const takeLines = (pending: string, chunk: string): TakenLines => {
  const parts = `${pending}${chunk}`.split("\n");
  const rest = parts.pop() ?? "";

  return { lines: parts, pending: rest };
};

export * as TaskLog from "./task-log.ts";
