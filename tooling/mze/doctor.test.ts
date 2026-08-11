import { expect, it } from "@effect/vitest";

import { Doctor } from "./doctor.ts";

it("accepts only healthy PostgreSQL and Redis services", () => {
  expect(
    Doctor.servicesHealthy(
      [
        JSON.stringify({ Health: "healthy", Service: "postgres" }),
        JSON.stringify({ Health: "healthy", Service: "redis" }),
      ].join("\n"),
    ),
  ).toBe(true);
  expect(
    Doctor.servicesHealthy(
      JSON.stringify([
        { Health: "healthy", Service: "postgres" },
        { Health: "starting", Service: "redis" },
      ]),
    ),
  ).toBe(false);
  expect(Doctor.servicesHealthy("not json")).toBe(false);
});
