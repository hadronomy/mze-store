# Loading Emulate in the Medusa Jest suite

**Date:** 2026-08-05

**Scope:** `emulate@0.9.0` in the Medusa integration tests

## Decision

The CommonJS wrapper works, but it is not the best long-term option for this repository.

Keep the Jest suite in CommonJS. Configure SWC to preserve dynamic imports, then import Emulate directly from the Stripe test.

```js
// apps/medusa/jest.config.js
module: {
  ignoreDynamic: true,
},
```

```ts
async function startStripeEmulator() {
  const { createEmulator } = await import("emulate");
  return createEmulator({ service: "stripe", port: STRIPE_EMULATOR_PORT });
}

type StripeEmulator = Awaited<ReturnType<typeof startStripeEmulator>>;
```

This design removes both wrapper files:

- `apps/medusa/integration-tests/utils/emulate.cjs`
- `apps/medusa/integration-tests/utils/emulate.d.cts`

This change uses the installed transformer and the standard Node module boundary. It adds no dependency and does not convert the suite to ESM.

## Current toolchain

The result depends on this exact module graph:

| Component             | Repository version | Relevant behavior                                        |
| --------------------- | ------------------ | -------------------------------------------------------- |
| Node                  | 24 in CI           | CommonJS can load ESM with `import()`                    |
| Jest                  | 29.7.0             | The ESM VM path remains experimental                     |
| `@swc/jest`           | 0.2.39             | It emits CommonJS unless Jest marks a file as static ESM |
| `@swc/core`           | 1.5.7              | `module.ignoreDynamic` preserves `import()`              |
| TypeScript            | 6.0.3              | The project uses `module: Node16`                        |
| Medusa test utilities | 2.18.0             | The integration runner is Jest-based and CommonJS        |
| Emulate               | 0.9.0              | The public entry point has only an `import` condition    |

The repository sets Node 24 in [CI](../../.github/workflows/ci.yml). The Medusa package also requires Node 24 or newer.

The local probes used Node 26.5. Node 24 supports the same CommonJS dynamic-import path.

The [Jest configuration](../../apps/medusa/jest.config.js) transforms `.js` and `.ts` files with `@swc/jest`. It does not mark `.ts` as ESM.

The [Medusa TypeScript preset](../../packages/config/tsconfig.medusa.json) uses `module: Node16`. [ADR-0012](../adr/0012-the-medusa-backend-is-a-tsc-island.md) records the CommonJS constraint.

## Why a wrapper seemed necessary

The source test is CommonJS after the Jest transform. That fact alone does not require a wrapper.

Node supports dynamic `import()` in CommonJS. Node uses the ESM loader for every `import()` call. [Node ESM interoperability](https://nodejs.org/api/esm.html#interoperability-with-commonjs)

The problem comes from the SWC transform. SWC changes a dynamic import to a `require()` call when it emits CommonJS by default.

The installed transformer produced this result in a local probe:

```js
// Current default
Promise.resolve().then(() => require("emulate"));

// With module.ignoreDynamic: true
import("emulate");
```

The `@swc/jest` source spreads the supplied module options. It then selects `es6` or `commonjs` from Jest's `supportsStaticESM` value. [`@swc/jest@0.2.39` source](https://github.com/swc-project/pkgs/blob/ac1ef1b4fcdbaba7c7c5fb4c7c0e743f19e502a5/packages/jest/index.ts#L41-L59)

SWC defines `ignoreDynamic: true` for this exact purpose. It preserves dynamic imports while SWC transforms the other module syntax. [SWC module configuration](https://swc.rs/docs/configuration/modules#ignoredynamic)

Emulate declares `"type": "module"`. Its root export provides `import` and `types`, but it provides no `require` or `default` condition. [`emulate@0.9.0` package source](https://github.com/vercel-labs/emulate/blob/1e4b71a1da6e8c937318958bebf03bcb87d61dd5/packages/emulate/package.json#L1-L17)

Node uses different conditions for `import()` and `require()`. The two conditions are mutually exclusive. [Node conditional exports](https://nodejs.org/api/packages.html#conditional-exports)

As a result, `require("emulate")` fails before Node evaluates the Emulate module. The local Node probe returned `ERR_PACKAGE_PATH_NOT_EXPORTED`.

An untransformed `.cjs` wrapper escapes the configured transform pattern. Its dynamic import therefore remains an import instead of becoming a require call.

The phrase "Node's native loader" is not exact inside Jest. Jest 29 routes dynamic imports through its VM module implementation. [Jest runtime source](https://github.com/jestjs/jest/blob/v29.7.0/packages/jest-runtime/src/index.ts#L1664-L1685)

The test command already enables `--experimental-vm-modules`. Jest requires this flag for its ESM path. [Jest 29 ESM guide](https://jestjs.io/docs/29.7/ecmascript-modules)

## Why `ignoreDynamic` is the better boundary

The recommended setting corrects the transform at its source. It does not hide the transform behind an untransformed file.

Jest tells transformers when dynamic imports are available. Its documentation says that transformed CommonJS can contain `import()` when `supportsDynamicImport` is true. [Jest 29 transformation API](https://jestjs.io/docs/29.7/code-transformation#writing-custom-transformers)

The standard test script always supplies the required VM flag. A wrapper depends on that same flag.

TypeScript gives another useful reference point. Its `node16` CommonJS output preserves dynamic imports for Node's ESM loader. [TypeScript module reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html#node16-node18-node20-nodenext)

The repository already selects `node16` for the Medusa build. `ignoreDynamic` makes the Jest transform match that module behavior.

The helper function also preserves the package type without a declaration wrapper. TypeScript infers the return type from the dynamic import.

A direct static type import needs a `resolution-mode` attribute in this CommonJS file. Return-type inference avoids that extra syntax.

The setting applies to all project files transformed by this Jest configuration. This is a small global effect, not a test-only filename exception.

No other Medusa project file currently contains a dynamic import. Future dynamic imports will get the correct Node `node16` behavior.

## Validation

The following checks used the installed dependency versions:

1. An `@swc/jest` transform probe showed the default `require()` rewrite.
2. The same probe preserved `import()` with `module.ignoreDynamic: true`.
3. A temporary Jest probe loaded `createEmulator` directly.
4. The real Stripe Store API integration test passed with the direct import.
5. A full-Jest-ESM probe lost the CommonJS global `jest`, as the Jest guide describes.
6. The full repository test suite passed all 4 suites and 16 tests.

These probes did not require an Emulate wrapper or a new package.

## Alternatives

### Keep the CommonJS wrapper

**Result:** Valid fallback, but not preferred.

The wrapper has a very small blast radius. It also adds two files for one import and hides the SWC behavior from the Jest configuration.

The declaration wrapper duplicates an interface boundary that Emulate already publishes. The recommended helper infers that type from Emulate.

Keep the wrapper only if the project cannot change the shared Jest transform.

### Convert the Jest suite to native ESM

**Result:** Reject.

Jest 29 calls its ESM support experimental. It requires ESM output, `--experimental-vm-modules`, and `extensionsToTreatAsEsm` for TypeScript. [Jest 29 ESM guide](https://jestjs.io/docs/29.7/ecmascript-modules)

An ESM test must import `jest` from `@jest/globals`. Static ESM also changes module mocking and removes CommonJS mock hoisting.

The repository contains several tests that use the injected `jest` global. More important, the Medusa application remains a CommonJS island.

Medusa 2.18 loads the application through a synchronous `require()`. [Medusa bootstrap source](https://github.com/medusajs/medusa/blob/v2.18.0/packages/medusa-test-utils/src/medusa-test-runner-utils/bootstrap-app.ts#L9-L27)

The Medusa runner itself uses Jest globals for all lifecycle hooks. [Medusa test runner source](https://github.com/medusajs/medusa/blob/v2.18.0/packages/medusa-test-utils/src/medusa-test-runner.ts#L368-L449)

Converting the suite changes many module boundaries to solve one import. It conflicts with the recorded backend architecture.

### Add an untransformed `.mjs` wrapper

**Result:** Reject.

An `.mjs` file gives the wrapper static ESM syntax. It does not solve how the CommonJS test reaches that file.

SWC changes a static test import to `require()`. A dynamic test import still needs `ignoreDynamic: true`.

After that setting exists, the test can import Emulate directly. The `.mjs` wrapper adds no value.

### Use `createRequire()` or modern `require(esm)`

**Result:** Reject.

Modern Node can synchronously require ESM graphs that contain no top-level await. Node made this function stable in version 25.4. [Node `require(esm)`](https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require)

That capability does not override package export conditions. `createRequire()` also uses the `require` condition.

Emulate does not publish a `require` or `default` root export. Both `require()` and `createRequire()` returned `ERR_PACKAGE_PATH_NOT_EXPORTED` in local probes.

Jest 29 also owns module loading inside the test VM. It rejects a recognized ESM file on its CommonJS require path. [Jest ESM rejection](https://github.com/jestjs/jest/blob/v29.7.0/packages/jest-runtime/src/index.ts#L911-L920)

Using an absolute path to `dist/api.js` bypasses the package's public export. That path is private and can change in a patch release.

### Add Node module hooks

**Result:** Reject.

Module hooks customize resolution and source loading. They do not stop SWC from changing `import()` into `require()`.

Node deprecated the asynchronous `module.register()` API in version 25.9. Node recommends `module.registerHooks()` instead. [Node module hooks](https://nodejs.org/api/module.html#customization-hooks)

The synchronous hooks remain release-candidate APIs in the current Node documentation. Jest 29 does not document integration with these hooks.

A global loader hook has a much larger blast radius than one supported SWC option.

### Transform Emulate to CommonJS

**Result:** Reject.

Jest skips `node_modules` transforms by default. A transform exception can compile a selected dependency. [Jest 29 transformation API](https://jestjs.io/docs/29.7/code-transformation)

Emulate still has no `require` export. A mapping must bypass its public export before the transform can start.

This design couples the test to Emulate's private `dist` layout. It also transforms Emulate's generated module graph instead of using its published ESM form.

### Replace SWC with `ts-jest`

**Result:** Reject.

TypeScript `node16` emit preserves the required dynamic import. Thus, `ts-jest` can avoid this specific SWC default.

This repository does not install `ts-jest`. Replacing the transformer changes every integration test and adds a dependency for one module option.

The project already runs a separate type check. The current SWC transformer remains the smaller and faster boundary.

### Spawn the Emulate CLI

**Result:** Reject.

Emulate documents `createEmulator` for tests. The returned object provides `url`, `reset()`, and `close()`. [Emulate programmatic API](https://emulate.dev/docs/programmatic-api)

The source implements these methods on the in-process server handle. [`createEmulator` source](https://github.com/vercel-labs/emulate/blob/1e4b71a1da6e8c937318958bebf03bcb87d61dd5/packages/emulate/src/api.ts#L19-L85)

The CLI installs process signal handlers and calls `process.exit(0)` during shutdown. [Emulate CLI source](https://github.com/vercel-labs/emulate/blob/1e4b71a1da6e8c937318958bebf03bcb87d61dd5/packages/emulate/src/commands/start.ts#L194-L210)

A spawned CLI needs readiness checks, signal cleanup, output handling, and child-process failure handling. It does not return the test lifecycle methods.

The programmatic API has less state and gives Jest deterministic cleanup. It is the correct Emulate interface for this test.

## Final recommendation

Use `module.ignoreDynamic: true` in the existing `@swc/jest` configuration. Import Emulate dynamically from a typed helper in the Stripe test.

Keep the suite and Medusa application in CommonJS. Keep `--experimental-vm-modules` while the project uses Jest 29.

Keep the `.cjs` wrapper and its `.d.cts` declaration removed.

Revisit native Jest ESM only when Medusa removes its synchronous CommonJS loader. Do not add module hooks or a child Emulate process for this import.
