import { Effect, Schema } from "effect";

import { ChildCommand } from "./child-command.ts";

export class DataLossConfirmationRequired extends Schema.TaggedError<DataLossConfirmationRequired>()(
  "DataLossConfirmationRequired",
  {
    exitCode: Schema.Number,
    flag: Schema.String,
    operation: Schema.String,
  },
) {}

export const run = (
  cwd: string,
  operation: "generate" | "migrate" | "push" | "studio",
  acceptDataLoss: boolean,
) =>
  Effect.gen(function* () {
    if (operation === "push" && !acceptDataLoss) {
      return yield* new DataLossConfirmationRequired({
        exitCode: 2,
        flag: "--accept-data-loss",
        operation: "db push",
      });
    }

    const commands = yield* ChildCommand.Service;
    yield* commands.run({
      executable: "vp",
      arguments: [
        "run",
        "--filter",
        "@mze-store/db",
        `db:${operation}`,
        ...(operation === "push" && acceptDataLoss ? ["--force"] : []),
      ],
      cwd,
    });
  });

export * as Database from "./database.ts";
