import { Context, Layer } from "effect";

export interface Interface {
  readonly nodeVersion: string;
  readonly platform: string;
}

export class Service extends Context.Service<Service, Interface>()(
  "@mze-store/tooling/RuntimeInfo",
) {}

export const layer = Layer.succeed(
  Service,
  Service.of({
    nodeVersion: process.version.replace(/^v/, ""),
    platform: process.platform,
  }),
);

export * as RuntimeInfo from "./runtime-info.ts";
