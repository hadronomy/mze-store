import { Console, Effect, Option, Path } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { ChildCommand } from "./child-command.ts";
import { Auth } from "./auth.ts";
import { Database } from "./database.ts";
import { Dev } from "./dev.ts";
import { Docker } from "./docker.ts";
import { Doctor } from "./doctor.ts";
import { Output } from "./output.ts";
import { Reporter } from "./reporter.ts";
import { Services } from "./services.ts";
import { Setup } from "./setup.ts";
import { Tasks } from "./tasks.ts";

export const root = Command.make("mze").pipe(
  Command.withDescription("Run MZE Store development and repository workflows."),
  Command.withSharedFlags({
    json: Flag.boolean("json").pipe(Flag.withDescription("Write versioned NDJSON events.")),
  }),
);

interface WorkflowContext {
  readonly cwd: string;
  readonly mode: Output.Mode;
  readonly nodeVersion: string;
  readonly platform: string;
}

const execute = <A, E, R>(
  name: string,
  workflow: (context: WorkflowContext) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const { json } = yield* root;
    const path = yield* Path.Path;
    const runtime = {
      nodeVersion: process.version.replace(/^v/, ""),
      platform: process.platform,
    };
    const cwd = path.resolve(import.meta.dirname, "../..");
    const mode: Output.Mode = json ? "json" : "human";
    const program = Effect.gen(function* () {
      const output = yield* Output.Service;
      if (runtime.platform !== "darwin" && runtime.platform !== "linux") {
        return yield* new Dev.UnsupportedPlatform({
          exitCode: 1,
          platform: runtime.platform,
        });
      }
      yield* output.write({
        command: name,
        event: "started",
        stream: "stdout",
      });
      const result = yield* workflow({ cwd, mode, ...runtime });
      yield* output.write({
        command: name,
        event: "succeeded",
        stream: "stdout",
      });
      return result;
    }).pipe(
      Effect.provide(ChildCommand.layer),
      Effect.matchEffect({
        onFailure: (error) => Reporter.report(name, error),
        onSuccess: Effect.succeed,
      }),
      Effect.provide(Output.layer(mode)),
    );

    return yield* program;
  });

const setup = Command.make("setup", {}, () =>
  execute("setup", ({ cwd, mode, nodeVersion }) => Setup.run({ cwd, mode, nodeVersion })),
).pipe(Command.withDescription("Prepare environment files and Git hooks."));

const doctor = Command.make("doctor", {}, () =>
  execute("doctor", ({ cwd, nodeVersion, platform }) => Doctor.run({ cwd, nodeVersion, platform })),
).pipe(Command.withDescription("Inspect local tooling without changing it."));

const dev = Command.make(
  "dev",
  {
    target: Argument.choice("target", ["storefront"] as const).pipe(Argument.optional),
  },
  ({ target }) =>
    execute("dev", ({ cwd, platform }) =>
      Dev.run({
        cwd,
        platform,
        target: Option.isSome(target) ? target.value : "all",
      }),
    ),
).pipe(Command.withDescription("Start healthy services and development applications."));

const build = Command.make("build", {}, () => execute("build", ({ cwd }) => Tasks.build(cwd)));
const check = Command.make("check", {}, () => execute("check", ({ cwd }) => Tasks.check(cwd)));
const test = Command.make(
  "test",
  { target: Argument.choice("target", ["e2e"] as const).pipe(Argument.optional) },
  ({ target }) =>
    execute("test", ({ cwd }) =>
      Tasks.test(cwd, Option.isSome(target) ? target.value : "workspace"),
    ),
);
const lint = Command.make("lint", {}, () => execute("lint", ({ cwd }) => Tasks.lint(cwd)));
const format = Command.make("format", {}, () => execute("format", ({ cwd }) => Tasks.format(cwd)));

const servicesStart = Command.make("start", {}, () =>
  execute("services start", ({ cwd }) => Services.start(cwd)),
);
const servicesStop = Command.make("stop", {}, () =>
  execute("services stop", ({ cwd }) => Services.stop(cwd)),
);
const servicesStatus = Command.make("status", {}, () =>
  execute("services status", ({ cwd }) => Services.status(cwd)),
);
const servicesPorts = Command.make("ports", {}, () =>
  execute("services ports", ({ cwd }) =>
    Effect.gen(function* () {
      const output = yield* Output.Service;
      const ports = yield* Services.ports(cwd);
      yield* output.write({
        command: "services ports",
        data: { message: `PostgreSQL ${ports.postgres}; Redis ${ports.redis}`, ...ports },
        event: "message",
        stream: "stdout",
      });
    }),
  ),
);
const services = Command.make("services").pipe(
  Command.withSubcommands([servicesStart, servicesStop, servicesStatus, servicesPorts]),
);

const databaseCommand = (operation: "generate" | "migrate" | "studio") =>
  Command.make(operation, {}, () =>
    execute(`db ${operation}`, ({ cwd }) => Database.run(cwd, operation, false)),
  );
const databasePush = Command.make(
  "push",
  {
    acceptDataLoss: Flag.boolean("accept-data-loss").pipe(
      Flag.withDescription("Accept schema changes that can delete data."),
    ),
  },
  ({ acceptDataLoss }) =>
    execute("db push", ({ cwd }) => Database.run(cwd, "push", acceptDataLoss)),
);
const database = Command.make("db").pipe(
  Command.withSubcommands([
    databasePush,
    databaseCommand("generate"),
    databaseCommand("migrate"),
    databaseCommand("studio"),
  ]),
);

const authSchema = Command.make("schema", {}, () =>
  execute("auth schema", ({ cwd }) => Auth.schema(cwd)),
);
const auth = Command.make("auth").pipe(Command.withSubcommands([authSchema]));

const dockerSimple = (operation: "build" | "logs" | "up") =>
  Command.make(operation, {}, () =>
    execute(`docker ${operation}`, ({ cwd }) => Docker[operation](cwd)),
  );
const dockerDown = Command.make(
  "down",
  {
    deleteVolumes: Flag.boolean("delete-volumes").pipe(
      Flag.withDescription("Delete persistent PostgreSQL and Redis volumes."),
    ),
  },
  ({ deleteVolumes }) => execute("docker down", ({ cwd }) => Docker.down(cwd, deleteVolumes)),
);
const docker = Command.make("docker").pipe(
  Command.withSubcommands([
    dockerSimple("build"),
    dockerSimple("up"),
    dockerDown,
    dockerSimple("logs"),
  ]),
);

export const command = root.pipe(
  Command.withSubcommands([
    setup,
    doctor,
    dev,
    build,
    check,
    test,
    lint,
    format,
    services,
    database,
    auth,
    docker,
  ]),
);

export const run = (arguments_: ReadonlyArray<string>) => {
  const normalized =
    arguments_.length === 0 || (arguments_.length === 1 && arguments_[0] === "--json")
      ? [...arguments_, "--help"]
      : arguments_;
  const json = normalized.includes("--json");
  const parsed = Command.runWith(command, {
    renderErrors: true,
    version: "1.0.0",
  })(normalized);
  const program = json
    ? Effect.gen(function* () {
        const entries: Array<{ readonly stream: Output.OutputStream; readonly text: string }> = [];
        const capture =
          (stream: Output.OutputStream) =>
          (...values: ReadonlyArray<unknown>) => {
            entries.push({ stream, text: values.map(String).join(" ") });
          };
        const capturedConsole: Console.Console = Object.assign(Object.create(console), {
          debug: capture("stdout"),
          error: capture("stderr"),
          info: capture("stdout"),
          log: capture("stdout"),
          warn: capture("stderr"),
        });
        const emitEntries = (includeStderr: boolean) =>
          Effect.gen(function* () {
            const output = yield* Output.Service;
            for (const entry of entries) {
              if (!includeStderr && entry.stream === "stderr") {
                continue;
              }
              yield* output.write({
                command: "mze",
                data: { message: entry.text },
                event: "message",
                stream: entry.stream,
              });
            }
          }).pipe(Effect.provide(Output.layer("json")));

        return yield* parsed.pipe(
          Effect.provideService(Console.Console, capturedConsole),
          Effect.matchEffect({
            onFailure: (error) => {
              if (error instanceof Reporter.ReportedError) {
                return Effect.fail(error);
              }

              const detail = entries
                .map((entry) => entry.text)
                .join("\n")
                .match(/(?:^|\n)ERROR\s*\n\s*([^\n]+)/)?.[1];
              return emitEntries(false).pipe(
                Effect.andThen(
                  Reporter.report("mze", detail ?? error, 2).pipe(
                    Effect.provide(Output.layer("json")),
                  ),
                ),
              );
            },
            onSuccess: (value) => emitEntries(true).pipe(Effect.as(value)),
          }),
        );
      })
    : parsed;

  return program.pipe(
    Effect.matchEffect({
      onFailure: (error) => {
        if (error instanceof Reporter.ReportedError) {
          return Effect.fail(error);
        }

        return json
          ? Reporter.report("mze", error, 2).pipe(Effect.provide(Output.layer("json")))
          : Effect.fail(new Reporter.ReportedError(2));
      },
      onSuccess: Effect.succeed,
    }),
  );
};

export * as Cli from "./cli.ts";
