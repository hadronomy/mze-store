import { expect, it } from "vite-plus/test";

import { TerminalCapabilities } from "./terminal-capabilities.ts";

it("keeps a width the stream actually reports", () => {
  expect(TerminalCapabilities.resolveColumns(120)).toBe(120);
  expect(TerminalCapabilities.resolveColumns(20)).toBe(20);
});

it("falls back when the stream reports no usable width", () => {
  // `script` and some CI pseudo-terminals answer 0 instead of omitting it.
  // Taken literally there is no room for text and every label truncates away.
  expect(TerminalCapabilities.resolveColumns(0)).toBe(80);
  expect(TerminalCapabilities.resolveColumns(undefined)).toBe(80);
  expect(TerminalCapabilities.resolveColumns(-1)).toBe(80);
});
