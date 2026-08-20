import { Deferred, Effect, Option, Pipeable, Ref } from "effect";

import { ChildCommand } from "./child-command.ts";

/**
 * One unit of graph work. `dependencies` holds live `Node` values, not names,
 * so referencing a dependency that is not yet in scope is a JavaScript
 * reference error at definition time, not a graph-shaped typo to validate.
 */
export interface Node<E = ChildCommand.Error> extends Pipeable.Pipeable {
  readonly name: string;
  readonly effect: Effect.Effect<void, E, ChildCommand.Service>;
  readonly dependencies: ReadonlyArray<Node<E>>;
}

const construct = <E>(
  name: string,
  effect: Effect.Effect<void, E, ChildCommand.Service>,
  dependencies: ReadonlyArray<Node<E>>,
): Node<E> => ({
  name,
  effect,
  dependencies,
  pipe() {
    return Pipeable.pipeArguments(this, arguments);
  },
});

export const make = <E = ChildCommand.Error>(
  name: string,
  effect: Effect.Effect<void, E, ChildCommand.Service>,
): Node<E> => construct(name, effect, []);

/**
 * Declares that `self` must not start until `dependency` has succeeded.
 *
 * `self.pipe(Phase.after(dependency))` reads the way `Layer.provide` does:
 * "self, after dependency." There is no `provide`-style merge because a
 * dependency hands nothing forward — `after` only orders.
 */
export function after<E>(dependency: Node<E>): (self: Node<E>) => Node<E>;
export function after<E>(selfOrDependency: Node<E>): (self: Node<E>) => Node<E> {
  const dependency = selfOrDependency;
  return (self: Node<E>) => construct(self.name, self.effect, [...self.dependencies, dependency]);
}

export interface Graph<E = ChildCommand.Error> {
  readonly nodes: ReadonlyArray<Node<E>>;
}

/**
 * Flattens reachable nodes into one graph, each named node included once.
 *
 * Two different `Node` values sharing a name is a wiring bug no type can
 * catch here (both are just `Node<E>`), so it fails loudly at graph
 * construction instead of silently doubling that phase's work.
 */
export const all = <E = ChildCommand.Error>(...roots: ReadonlyArray<Node<E>>): Graph<E> => {
  const nodes: Array<Node<E>> = [];
  const seen = new Set<Node<E>>();
  const byName = new Map<string, Node<E>>();

  const visit = (node: Node<E>) => {
    if (seen.has(node)) {
      return;
    }

    seen.add(node);
    const existing = byName.get(node.name);
    if (existing !== undefined && existing !== node) {
      throw new Error(`Phase.all: two different phases are both named "${node.name}"`);
    }

    byName.set(node.name, node);
    for (const dependency of node.dependencies) {
      visit(dependency);
    }

    nodes.push(node);
  };

  for (const root of roots) {
    visit(root);
  }

  return { nodes };
};

export const names = (graph: Graph<unknown>): ReadonlyArray<string> =>
  graph.nodes.map((node) => node.name);

/** Told about a graph's run-state transitions; knows nothing about the graph itself. */
export interface Reporter {
  readonly onStarted: (name: string) => Effect.Effect<void>;
  readonly onSucceeded: (name: string) => Effect.Effect<void>;
  readonly onFailed: (name: string) => Effect.Effect<void>;
  readonly onSkipped: (name: string) => Effect.Effect<void>;
}

type Outcome = "succeeded" | "failed" | "skipped";

/**
 * Runs every ready node concurrently, in dependency order, and stops
 * starting new work on the first failure.
 *
 * Each node blocks on a `Deferred` per dependency rather than polling
 * readiness, so unrelated ready nodes still start immediately. The first
 * failure's own error is what the whole graph fails with, so a caller
 * matching on `ChildCommand.Error`'s tags upstream sees the same value it
 * would have from running that one command directly.
 */
export const run = <E>(
  graph: Graph<E>,
  reporter: Reporter,
): Effect.Effect<void, E, ChildCommand.Service> =>
  Effect.gen(function* () {
    const aborted = yield* Ref.make(false);
    const outcomes = yield* Ref.make(new Map<string, Outcome>());
    const failure = yield* Ref.make(Option.none<E>());
    const gates = new Map<string, Deferred.Deferred<void>>();

    for (const node of graph.nodes) {
      gates.set(node.name, yield* Deferred.make<void>());
    }

    const gate = (name: string): Deferred.Deferred<void> => {
      const found = gates.get(name);
      if (found === undefined) {
        throw new Error(`Phase.run: no gate for "${name}" — dependency outside this graph`);
      }

      return found;
    };

    const runOne = (node: Node<E>) =>
      Effect.gen(function* () {
        yield* Effect.forEach(
          node.dependencies,
          (dependency) => Deferred.await(gate(dependency.name)),
          {
            discard: true,
          },
        );

        const settled = yield* Ref.get(outcomes);
        const depsOk = node.dependencies.every(
          (dependency) => settled.get(dependency.name) === "succeeded",
        );
        const halted = yield* Ref.get(aborted);

        if (!depsOk || halted) {
          yield* Ref.update(outcomes, (current) => new Map(current).set(node.name, "skipped"));
          yield* reporter.onSkipped(node.name);
        } else {
          yield* reporter.onStarted(node.name);
          const result = yield* Effect.result(
            node.effect.pipe(
              Effect.provideService(ChildCommand.CurrentPhase, Option.some(node.name)),
            ),
          );

          if (result._tag === "Failure") {
            yield* Ref.update(outcomes, (current) => new Map(current).set(node.name, "failed"));
            yield* Ref.update(
              failure,
              Option.orElse(() => Option.some(result.failure)),
            );
            yield* Ref.set(aborted, true);
            yield* reporter.onFailed(node.name);
          } else {
            yield* Ref.update(outcomes, (current) => new Map(current).set(node.name, "succeeded"));
            yield* reporter.onSucceeded(node.name);
          }
        }

        yield* Deferred.succeed(gate(node.name), undefined);
      });

    yield* Effect.forEach(graph.nodes, runOne, { concurrency: "unbounded", discard: true });

    const outcome = yield* Ref.get(failure);
    if (Option.isSome(outcome)) {
      return yield* Effect.fail(outcome.value);
    }
  });

export * as Phase from "./phase.ts";
