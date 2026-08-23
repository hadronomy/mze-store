// Via @medusajs/framework rather than @medusajs/utils: bun links only declared
// dependencies, and utils reaches this app as a transitive one.
const { loadEnv } = require("@medusajs/framework/utils");

// `.env.test` is committed rather than generated: it carries the compose
// addresses the runner needs, REDIS_URL among them. See the file for why.
loadEnv("test", process.cwd());

module.exports = {
  transform: {
    "^.+\\.[jt]s$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", decorators: true },
          // Stated rather than inferred. @swc/jest otherwise derives the target
          // from the host node version, which lands on one the pinned @swc/core
          // does not recognise. ES2022 is what tsconfig.medusa.json compiles to.
          target: "es2022",
        },
        // The suite stays CommonJS. Node 24.18 and Jest 30.4 can require a
        // synchronous ESM graph. Preserve import() for callers that request it.
        module: { ignoreDynamic: true },
      },
    ],
  },
  testEnvironment: "node",
  moduleFileExtensions: ["js", "ts", "json"],
  moduleNameMapper: {
    "^~/(.*)$": "<rootDir>/src/$1",
  },
  modulePathIgnorePatterns: ["dist/", "<rootDir>/.medusa/"],
  setupFiles: ["./integration-tests/setup.js"],
  testMatch: ["**/integration-tests/**/*.spec.[jt]s"],
};
