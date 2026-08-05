// Jest 29 executes transformed TypeScript as CommonJS. This untransformed
// bridge keeps emulate's ESM-only programmatic API on Node's native loader.
exports.createEmulator = async (options) => {
  const emulate = await import("emulate");
  return emulate.createEmulator(options);
};
