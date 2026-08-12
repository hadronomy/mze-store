import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Runtime } from "effect";

import { Cli } from "./cli.ts";
import { RuntimeInfo } from "./runtime-info.ts";

let signalExitCode: number | undefined;
process.once("SIGINT", () => {
  signalExitCode = 130;
});
process.once("SIGTERM", () => {
  signalExitCode = 143;
});

const teardown: Runtime.Teardown = (exit, onExit) =>
  Runtime.defaultTeardown(exit, (code) => onExit(signalExitCode ?? code));

Cli.run(process.argv.slice(2))
  .pipe(Effect.provide(RuntimeInfo.layer))
  .pipe(Effect.provide(NodeServices.layer))
  .pipe(NodeRuntime.runMain({ teardown }));
