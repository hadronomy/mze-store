import { dedent } from "ts-dedent";

type SourceTag = (strings: TemplateStringsArray, ...values: unknown[]) => string;

const renderSource: SourceTag = (strings, ...values) => dedent(strings, ...values);

export const src = Object.freeze({
  js: renderSource,
  ts: renderSource,
  jsonc: renderSource,
  bash: renderSource,
  sql: renderSource,
});
