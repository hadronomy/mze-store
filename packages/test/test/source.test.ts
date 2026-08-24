import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, test } from "vite-plus/test";

import { src } from "@mze-store/test";

const packageDirectory = fileURLToPath(new URL("../", import.meta.url));

describe("src", () => {
  test("exposes explicit language tags that return strings", () => {
    expect(Object.keys(src)).toEqual(["js", "ts", "jsonc", "bash", "sql"]);
    expect(Object.isFrozen(src)).toBe(true);

    for (const tag of Object.values(src)) {
      expect(tag`const value = 1;`).toBe("const value = 1;");
      expectTypeOf(tag`const value = 1;`).toEqualTypeOf<string>();
    }
  });

  test("removes common indentation and outer blank lines", () => {
    expect(src.ts`
      function value() {
        return 1;
      }
    `).toBe("function value() {\n  return 1;\n}");
  });

  test("aligns every line of a multiline substitution", () => {
    const branch = "if (ready) {\n  return 1;\n}";

    expect(src.ts`
      function value() {
        ${branch}
      }
    `).toBe("function value() {\n  if (ready) {\n    return 1;\n  }\n}");
  });

  test("uses cooked template segments", () => {
    expect(src.js`
      const newline = "\\n";
      const digits = /\\d+/u;
    `).toBe('const newline = "\\n";\nconst digits = /\\d+/u;');
  });

  test("keeps escaped template syntax in the source", () => {
    expect(src.ts`
      const nested = \`value: \${value}\`;
    `).toBe("const nested = `value: ${value}`;");
  });

  test("keeps a shebang at byte zero and adds no final newline", () => {
    const script = src.bash`
      #!/usr/bin/env bash
      set -euo pipefail
    `;

    expect(script).toBe("#!/usr/bin/env bash\nset -euo pipefail");
    expect(script.startsWith("#!")).toBe(true);
    expect(script.endsWith("\n")).toBe(false);
  });

  test.each(["module", "commonjs"] as const)("loads the built %s entry", (moduleType) => {
    const load =
      moduleType === "module"
        ? 'const { src } = await import("@mze-store/test")'
        : 'const { src } = require("@mze-store/test")';
    const output = execFileSync(
      process.execPath,
      [`--input-type=${moduleType}`, "--eval", `${load}; process.stdout.write(src.js\`value\`)`],
      { cwd: packageDirectory, encoding: "utf8" },
    );

    expect(output).toBe("value");
  });
});
