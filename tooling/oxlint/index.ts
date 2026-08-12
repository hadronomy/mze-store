import { definePlugin, eslintCompatPlugin, type ESTree, type Scope } from "@oxlint/plugins";
import * as Effect from "effect/Effect";
import { FileContext, Rule, Visitor } from "effect-oxlint";
import { realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";

const ALIAS_PREFIX = "~/";
const RULE_NAME = "prefer-tilde-imports";
const FILE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
] as const;
const MODULE_EXTENSION = /(?:\.d\.(?:mts|cts|ts)|\.(?:mts|cts|tsx|ts|mjs|cjs|jsx|js))$/;

type StaticSpecifier = ESTree.StringLiteral | ESTree.TemplateLiteral;

interface AliasTarget {
  prefix: string;
  suffix: string;
}

interface Project {
  aliasTargets: AliasTarget[];
  cache: ts.ModuleResolutionCache;
  options: ts.CompilerOptions;
}

interface ResolvedTarget {
  path: string;
  resolver: "typescript" | "filesystem";
}

interface CompilerOptionsWithPathsBasePath extends ts.CompilerOptions {
  pathsBasePath?: string;
}

const projectCache = new Map<string, Project | null>();
const parseConfigHost: ts.ParseConfigFileHost = {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic() {},
};

function canonicalPath(path: string): string {
  let canonical = resolve(path);

  try {
    canonical = realpathSync.native(canonical);
  } catch {
    // TypeScript can return a valid future output path that does not exist yet.
  }

  return canonical;
}

function pathKey(path: string): string {
  const canonical = canonicalPath(path);
  return ts.sys.useCaseSensitiveFileNames ? canonical : canonical.toLowerCase();
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function splitSuffix(specifier: string): { path: string; suffix: string } {
  const queryIndex = specifier.indexOf("?");
  const fragmentIndex = specifier.indexOf("#");
  const indexes = [queryIndex, fragmentIndex].filter((index) => index > 0);
  const suffixIndex = indexes.length === 0 ? -1 : Math.min(...indexes);

  return suffixIndex === -1
    ? { path: specifier, suffix: "" }
    : { path: specifier.slice(0, suffixIndex), suffix: specifier.slice(suffixIndex) };
}

function getProject(filename: string): Project | null {
  const configPath = ts.findConfigFile(dirname(filename), (path) => ts.sys.fileExists(path));

  if (!configPath) {
    return null;
  }

  const cached = projectCache.get(configPath);

  if (cached !== undefined) {
    return cached;
  }

  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, parseConfigHost);
  const tildeTargets = parsed?.options.paths?.["~/*"];

  if (!parsed || !tildeTargets || tildeTargets.length === 0) {
    projectCache.set(configPath, null);
    return null;
  }

  const options = parsed.options as CompilerOptionsWithPathsBasePath;
  const pathsBasePath = canonicalPath(
    options.pathsBasePath ?? options.baseUrl ?? dirname(configPath),
  );
  const marker = "__HADRONOMY_ALIAS_WILDCARD__";
  const aliasTargets = tildeTargets.flatMap((target): AliasTarget[] => {
    if (target.split("*").length !== 2) {
      return [];
    }

    const absolutePattern = resolve(pathsBasePath, target.replace("*", marker));
    const markerIndex = absolutePattern.indexOf(marker);

    return markerIndex === -1
      ? []
      : [
          {
            prefix: absolutePattern.slice(0, markerIndex),
            suffix: absolutePattern.slice(markerIndex + marker.length),
          },
        ];
  });

  if (aliasTargets.length === 0) {
    projectCache.set(configPath, null);
    return null;
  }

  const project: Project = {
    aliasTargets,
    cache: ts.createModuleResolutionCache(
      dirname(configPath),
      (path) => (ts.sys.useCaseSensitiveFileNames ? path : path.toLowerCase()),
      parsed.options,
    ),
    options: parsed.options,
  };

  projectCache.set(configPath, project);
  return project;
}

function expandAlias(specifier: string, aliasTarget: AliasTarget): string | null {
  if (!specifier.startsWith(ALIAS_PREFIX)) {
    return null;
  }

  const wildcard = specifier.slice(ALIAS_PREFIX.length).split("/").join(sep);
  return `${aliasTarget.prefix}${wildcard}${aliasTarget.suffix}`;
}

function filesystemCandidates(path: string): string[] {
  const candidates = [path];

  if (!extname(path)) {
    for (const extension of FILE_EXTENSIONS) {
      candidates.push(`${path}${extension}`);
      candidates.push(resolve(path, `index${extension}`));
    }
  }

  return candidates.filter(isFile);
}

function resolveWithFilesystem(
  specifier: string,
  filename: string,
  project: Project,
): string | null {
  const basePaths = specifier.startsWith(".")
    ? [resolve(dirname(filename), specifier)]
    : project.aliasTargets.flatMap((target) => {
        const expanded = expandAlias(specifier, target);
        return expanded ? [expanded] : [];
      });
  const matches = new Map(
    basePaths
      .flatMap(filesystemCandidates)
      .map(canonicalPath)
      .map((path) => [pathKey(path), path] as const),
  );

  return matches.size === 1 ? [...matches.values()][0]! : null;
}

function resolveSpecifier(
  specifier: string,
  filename: string,
  project: Project,
): ResolvedTarget | null {
  const resolvedModule = ts.resolveModuleName(
    specifier,
    filename,
    project.options,
    ts.sys,
    project.cache,
  ).resolvedModule;

  if (resolvedModule) {
    return { path: canonicalPath(resolvedModule.resolvedFileName), resolver: "typescript" };
  }

  const filesystemPath = resolveWithFilesystem(specifier, filename, project);
  return filesystemPath ? { path: filesystemPath, resolver: "filesystem" } : null;
}

function reverseAliasTarget(path: string, aliasTarget: AliasTarget): string | null {
  const absolutePath = resolve(path);

  if (
    !absolutePath.startsWith(aliasTarget.prefix) ||
    !absolutePath.endsWith(aliasTarget.suffix) ||
    absolutePath.length < aliasTarget.prefix.length + aliasTarget.suffix.length
  ) {
    return null;
  }

  const end = aliasTarget.suffix.length === 0 ? undefined : -aliasTarget.suffix.length;
  const wildcard = absolutePath.slice(aliasTarget.prefix.length, end);

  if (!wildcard || wildcard.startsWith(`..${sep}`) || isAbsolute(wildcard)) {
    return null;
  }

  return `${ALIAS_PREFIX}${wildcard.split(sep).join("/")}`;
}

function addCandidate(candidates: string[], candidate: string | null): void {
  if (candidate && !candidates.includes(candidate)) {
    candidates.push(candidate);
  }
}

function targetVariants(
  resolvedPath: string,
  originalSpecifier: string,
  filename: string,
): string[] {
  const variants: string[] = [];

  if (originalSpecifier.startsWith(".")) {
    addCandidate(variants, resolve(canonicalPath(dirname(filename)), originalSpecifier));
  }

  const originalExtension = extname(originalSpecifier);
  const extensionlessTarget = resolvedPath.replace(MODULE_EXTENSION, "");

  if (originalExtension && MODULE_EXTENSION.test(originalExtension)) {
    addCandidate(variants, `${extensionlessTarget}${originalExtension}`);
  }

  if (extensionlessTarget.endsWith(`${sep}index`)) {
    addCandidate(variants, dirname(extensionlessTarget));
  }

  addCandidate(variants, extensionlessTarget);
  addCandidate(variants, resolvedPath);
  return variants;
}

function isSameDirectory(filename: string, targetPath: string): boolean {
  return pathKey(dirname(filename)) === pathKey(dirname(targetPath));
}

function makeRelativeCandidate(path: string, filename: string): string | null {
  const relativePath = relative(canonicalPath(dirname(filename)), path)
    .split(sep)
    .join("/");

  if (!relativePath || relativePath.startsWith("../")) {
    return null;
  }

  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

function resolvesToTarget(
  candidate: string,
  original: ResolvedTarget,
  filename: string,
  project: Project,
): boolean {
  const resolved = resolveSpecifier(candidate, filename, project);

  if (!resolved || pathKey(resolved.path) !== pathKey(original.path)) {
    return false;
  }

  return original.resolver === "filesystem" || resolved.resolver === "typescript";
}

/**
 * Return the policy-compliant module specifier when TypeScript can prove that
 * the replacement selects the same file. A null result means "leave it alone."
 */
export function getPreferredSpecifier(filename: string, specifier: string): string | null {
  const project = getProject(filename);

  if (!project) {
    return null;
  }

  const { path: importPath, suffix } = splitSuffix(specifier);
  const originalTarget = resolveSpecifier(importPath, filename, project);

  if (!originalTarget) {
    return null;
  }

  const variants = targetVariants(originalTarget.path, importPath, filename);
  const aliasCandidates: string[] = [];

  for (const aliasTarget of project.aliasTargets) {
    for (const variant of variants) {
      addCandidate(aliasCandidates, reverseAliasTarget(variant, aliasTarget));
    }
  }

  if (aliasCandidates.length === 0) {
    return null;
  }

  const sameDirectory = isSameDirectory(filename, originalTarget.path);

  if (sameDirectory && (importPath === "." || importPath.startsWith("./"))) {
    return null;
  }

  if (!sameDirectory && importPath.startsWith(ALIAS_PREFIX)) {
    return null;
  }

  const candidates = sameDirectory
    ? variants.flatMap((variant) => {
        const relativeCandidate = makeRelativeCandidate(variant, filename);
        return relativeCandidate ? [relativeCandidate] : [];
      })
    : aliasCandidates;

  for (const candidate of candidates) {
    if (resolvesToTarget(candidate, originalTarget, filename, project)) {
      const replacement = `${candidate}${suffix}`;
      return replacement === specifier ? null : replacement;
    }
  }

  return null;
}

function getStaticSpecifier(node: StaticSpecifier | ESTree.Expression | null): string | null {
  if (!node) {
    return null;
  }

  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }

  if (
    node.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0]?.value.cooked ?? null;
  }

  return null;
}

function reportSpecifier(
  context: FileContext.FileContextService,
  node: StaticSpecifier | ESTree.Expression | null,
): void {
  const specifier = getStaticSpecifier(node);

  if (specifier === null || !node) {
    return;
  }

  const replacement = getPreferredSpecifier(context.physicalFilename, specifier);

  if (!replacement) {
    return;
  }

  context.report({
    node,
    messageId: "preferTildeImports",
    data: { replacement },
    fix(fixer) {
      return fixer.replaceTextRange([node.range[0] + 1, node.range[1] - 1], replacement);
    },
  });
}

function isGlobalRequire(
  context: FileContext.FileContextService,
  node: ESTree.Expression,
): boolean {
  if (node.type !== "Identifier" || node.name !== "require") {
    return false;
  }

  let scope: Scope | null = context.sourceCode.getScope(node);

  while (scope) {
    const variable = scope.set.get("require");

    if (variable) {
      return variable.defs.length === 0;
    }

    scope = scope.upper;
  }

  return true;
}

function reportCallArgument(
  context: FileContext.FileContextService,
  argument: ESTree.Argument | undefined,
): void {
  if (argument?.type !== "SpreadElement") {
    reportSpecifier(context, argument ?? null);
  }
}

const preferTildeImportsPlan = Rule.plan({
  meta: {
    type: "suggestion",
    docs: {
      description: "Use ./ within one directory and ~/ across directories in one source surface.",
      recommended: true,
    },
    fixable: "code",
    messages: {
      preferTildeImports: "Use '{{replacement}}' for this import.",
    },
  },
  create: () =>
    Effect.succeed({
      syncVisitors: Visitor.merge(
        Visitor.onSync("ImportDeclaration", (node, context) => {
          reportSpecifier(context, node.source);
        }),
        Visitor.onSync("ExportAllDeclaration", (node, context) => {
          reportSpecifier(context, node.source);
        }),
        Visitor.onSync("ExportNamedDeclaration", (node, context) => {
          reportSpecifier(context, node.source);
        }),
        Visitor.onSync("ImportExpression", (node, context) => {
          reportSpecifier(context, node.source);
        }),
        Visitor.onSync("TSImportType", (node, context) => {
          reportSpecifier(context, node.source);
        }),
        Visitor.onSync("TSExternalModuleReference", (node, context) => {
          reportSpecifier(context, node.expression);
        }),
        Visitor.onSync("CallExpression", (node, context) => {
          if (isGlobalRequire(context, node.callee)) {
            reportCallArgument(context, node.arguments[0]);
            return;
          }

          if (
            node.callee.type === "MemberExpression" &&
            !node.callee.computed &&
            node.callee.property.name === "resolve" &&
            isGlobalRequire(context, node.callee.object)
          ) {
            reportCallArgument(context, node.arguments[0]);
          }
        }),
      ),
    }),
});

const preferTildeImportsRule = Rule.compile(preferTildeImportsPlan);

const plugin = definePlugin({
  meta: { name: "hadronomy" },
  rules: { [RULE_NAME]: preferTildeImportsRule },
});

export { preferTildeImportsRule };
export default eslintCompatPlugin(plugin);
