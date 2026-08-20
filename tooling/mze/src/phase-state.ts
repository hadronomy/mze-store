import { Machine } from "@typeonce/effect-machine";
import { Effect, Option, Ref, Schema, Stream } from "effect";

import { Output } from "./output.ts";
import { Phase } from "./phase.ts";
import { Renderer } from "./renderer.ts";

/**
 * A phase's own run-state, kept separate from `phase.ts`'s scheduler.
 *
 * Five atomic states, one event source (the scheduler telling a phase it
 * started, succeeded, failed, or was skipped) — a real statechart earns its
 * keep here only as a small, honest guard: `Skip` is legal only from
 * `Queued`, `Succeed`/`Fail` only from `Running`, so a scheduler bug sending
 * an event out of order is silently ignored by the machine instead of
 * corrupting a row that already settled.
 */
const State = Schema.TaggedUnion({
  Queued: {},
  Running: {},
  Succeeded: {},
  Failed: {},
  Skipped: {},
});
const States = Machine.states(State.cases);

const Event = Machine.events(
  Schema.TaggedUnion({
    Start: {},
    Succeed: {},
    Fail: {},
    Skip: {},
  }),
);

const definition = Machine.make({
  id: "PhaseState",
  states: States.states,
  events: Event,
  initial: {
    target: (to) => to.Queued(),
    resolve: ({ target }) => target.from(),
  },
});

const machine = definition.handle({
  Queued: {
    on: {
      Start: Machine.transition({
        target: (to) => to.full.Running(),
        resolve: ({ target }) => target.from(),
      }),
      Skip: Machine.transition({
        target: (to) => to.full.Skipped(),
        resolve: ({ target }) => target.from(),
      }),
    },
  },
  Running: {
    on: {
      Succeed: Machine.transition({
        target: (to) => to.full.Succeeded(),
        resolve: ({ target }) => target.from(),
      }),
      Fail: Machine.transition({
        target: (to) => to.full.Failed(),
        resolve: ({ target }) => target.from(),
      }),
    },
  },
  Succeeded: {},
  Failed: {},
  Skipped: {},
});

// `Machine.start`'s return type is a long generic instantiation; deriving it
// from one concrete call site is simpler than reconstructing it by hand.
const startInstance = () => Machine.start(machine);
type PhaseRef = Effect.Success<ReturnType<typeof startInstance>>;
type PhaseEvent = Parameters<PhaseRef["send"]>[0];

type StateTag = "Queued" | "Running" | "Succeeded" | "Failed" | "Skipped";
type SettledTag = Exclude<StateTag, "Queued">;

// `satisfies` instead of a `Record<...>` annotation, so each key keeps its
// own literal value type — narrowing `tag` later narrows the lookup with it,
// which is what lets the write below stay one call per branch instead of a
// runtime check on the result.
const RENDERER_STATUS = {
  Failed: "failed",
  Running: "running",
  Skipped: "skipped",
  Succeeded: "succeeded",
} satisfies Record<SettledTag, Exclude<Renderer.Status, "pending">>;

const OUTPUT_EVENT = {
  Failed: "phase-failed",
  Running: "phase-started",
  Skipped: "phase-skipped",
  Succeeded: "phase-succeeded",
} satisfies Record<
  SettledTag,
  "phase-started" | "phase-succeeded" | "phase-failed" | "phase-skipped"
>;

/**
 * Bridges `phase.ts`'s neutral run-state signals to a per-phase machine, and
 * that machine's committed transitions to the rows `Renderer`/`Output`
 * already know how to draw.
 *
 * One machine instance per phase name, created lazily on first signal.
 * `MachineRef.send` only guarantees mailbox acceptance, not that a
 * transition has committed — `send` below waits for its own transition to
 * show up on `changes` before reporting, so a caller never reports a status
 * the machine has not actually reached yet, and nothing is left relying on a
 * background fiber outliving the graph run that triggered it.
 */
export const reporter = Effect.fn("PhaseState.reporter")(function* (command: string) {
  // `Renderer.Service` is absent in `--json` mode even for a rows-shaped
  // command, so its own render write is best-effort — a closed render pipe
  // must not take a build down over a cosmetic failure. `Output.write` is
  // not similarly guarded because output delivery remains part of the command contract.
  const renderer = yield* Effect.serviceOption(Renderer.Service);
  const output = yield* Output.Service;
  const refs = yield* Ref.make(new Map<string, PhaseRef>());
  const startedAt = yield* Ref.make(new Map<string, number>());

  const forName = (name: string) =>
    Effect.gen(function* () {
      const current = yield* Ref.get(refs);
      const existing = current.get(name);
      if (existing !== undefined) {
        return existing;
      }

      const ref = yield* startInstance();
      yield* Ref.update(refs, (map) => new Map(map).set(name, ref));
      return ref;
    });

  const report = (name: string, tag: SettledTag) =>
    Effect.gen(function* () {
      const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
      if (tag === "Running") {
        yield* Ref.update(startedAt, (map) => new Map(map).set(name, now));
      }

      const status = RENDERER_STATUS[tag];
      if (Option.isSome(renderer)) {
        yield* renderer.value.transition(name, status).pipe(Effect.ignore);
      }

      // A skipped phase never ran, so it carries no start time to measure —
      // `Output`'s type reflects that directly rather than taking an
      // `elapsedMillis` nobody would ever supply for it.
      if (tag === "Skipped") {
        yield* output.write({
          command,
          data: { phase: name },
          event: "phase-skipped",
          stream: "stdout",
        });
        return;
      }

      const start = (yield* Ref.get(startedAt)).get(name);
      yield* output.write({
        command,
        data: start === undefined ? { phase: name } : { elapsedMillis: now - start, phase: name },
        event: OUTPUT_EVENT[tag],
        stream: tag === "Failed" ? "stderr" : "stdout",
      });
    });

  // A phase's machine is never stopped, so `StoppedError` here is a defect in
  // this module, not a normal outcome `Phase.Reporter`'s callers should type
  // against. Each phase's own scheduler fiber is the only caller of `send`
  // for that phase, one call at a time, so waiting for the very next `tag`
  // on `changes` can never catch a later, unrelated transition instead.
  const send = (name: string, event: PhaseEvent, tag: SettledTag) =>
    Effect.gen(function* () {
      const ref = yield* forName(name);
      yield* ref.send(event);
      yield* ref.changes.pipe(
        Stream.filter((snapshot) => snapshot.state.path === tag),
        Stream.take(1),
        Stream.runDrain,
      );
      yield* report(name, tag);
    }).pipe(Effect.orDie);

  return {
    onFailed: (name: string) => send(name, Event.Fail(), "Failed"),
    onSkipped: (name: string) => send(name, Event.Skip(), "Skipped"),
    onStarted: (name: string) => send(name, Event.Start(), "Running"),
    onSucceeded: (name: string) => send(name, Event.Succeed(), "Succeeded"),
  } satisfies Phase.Reporter;
});

export * as PhaseState from "./phase-state.ts";
