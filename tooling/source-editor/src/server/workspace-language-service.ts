import { basename, dirname, isAbsolute, relative } from "node:path";

import ts from "typescript";

import {
  createSourceLanguageService,
  type SourceDocument,
  type SourceLanguageService,
} from "./language-service.ts";

interface WorkspaceLanguageServiceOptions {
  readonly directory: string;
  readonly warn: (message: string) => void;
}

export interface WorkspaceLanguageService extends SourceLanguageService {
  /** Reloads only projects that can use the changed workspace files. */
  reloadProjects(changedFileNames: readonly string[]): void;
}

const inferredProject = "<inferred>";
const ignoredDirectories = new Set([
  ".cache",
  ".git",
  ".medusa",
  ".output",
  ".tanstack",
  ".vinxi",
  ".vite-hooks",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

/** Routes each host document to the nearest TypeScript project. */
export function createWorkspaceLanguageService(
  options: WorkspaceLanguageServiceOptions,
): WorkspaceLanguageService {
  const services = new Map<string, SourceLanguageService>();
  const documents = new Map<string, SourceDocument>();
  const documentProjects = new Map<string, string>();

  const projectFor = (fileName: string): string => {
    const configPath = ts.findConfigFile(dirname(fileName), (path) => ts.sys.fileExists(path));
    if (configPath === undefined) return inferredProject;
    const workspaceRelativePath = relative(options.directory, configPath);
    return workspaceRelativePath.startsWith("..") ? inferredProject : configPath;
  };

  const createProject = (project: string): SourceLanguageService => {
    if (project === inferredProject) {
      return createSourceLanguageService({ documents: [], currentDirectory: options.directory });
    }

    const config = ts.readConfigFile(project, (fileName) => ts.sys.readFile(fileName));
    if (config.error !== undefined) {
      options.warn(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
      return createSourceLanguageService({ documents: [], currentDirectory: dirname(project) });
    }
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      dirname(project),
      {},
      project,
    );
    for (const diagnostic of parsed.errors) {
      options.warn(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    }
    const projectFiles: SourceDocument[] = parsed.fileNames.flatMap((fileName) => {
      const text = ts.sys.readFile(fileName);
      return text === undefined ? [] : [{ fileName, text }];
    });
    return createSourceLanguageService({
      documents: [],
      projectFiles,
      compilerOptions: parsed.options,
      currentDirectory: dirname(project),
    });
  };

  const serviceForProject = (project: string): SourceLanguageService => {
    const current = services.get(project);
    if (current !== undefined) return current;
    const service = createProject(project);
    services.set(project, service);
    return service;
  };

  const serviceForFile = (fileName: string): SourceLanguageService => {
    const project = documentProjects.get(fileName) ?? projectFor(fileName);
    return serviceForProject(project);
  };

  const reloadAllProjects = (): void => {
    for (const service of services.values()) service.dispose();
    services.clear();
    documentProjects.clear();
    for (const document of documents.values()) {
      const project = projectFor(document.fileName);
      documentProjects.set(document.fileName, project);
      serviceForProject(project).updateDocument(document);
    }
  };

  const reloadSelectedProjects = (projects: ReadonlySet<string>): void => {
    for (const project of projects) {
      services.get(project)?.dispose();
      services.delete(project);
    }
    for (const document of documents.values()) {
      const project = documentProjects.get(document.fileName) ?? projectFor(document.fileName);
      if (!projects.has(project)) continue;
      serviceForProject(project).updateDocument(document);
    }
  };

  const isProjectInput = (fileName: string): boolean => {
    const workspacePath = relative(options.directory, fileName);
    if (workspacePath.startsWith("..") || isAbsolute(workspacePath)) return false;
    if (basename(fileName) === "routeTree.gen.ts") return false;
    return !workspacePath.split(/[\\/]/).some((part) => ignoredDirectories.has(part));
  };

  const isTypeScriptConfig = (fileName: string): boolean =>
    /^tsconfig(?:\..+)?\.json$/u.test(basename(fileName));

  return {
    updateDocument: (document) => {
      documents.set(document.fileName, document);
      const project = projectFor(document.fileName);
      const previousProject = documentProjects.get(document.fileName);
      if (previousProject !== undefined && previousProject !== project) {
        services.get(previousProject)?.removeDocument(document.fileName);
      }
      documentProjects.set(document.fileName, project);
      serviceForProject(project).updateDocument(document);
    },
    removeDocument: (fileName) => {
      documents.delete(fileName);
      const project = documentProjects.get(fileName);
      if (project === undefined) return;
      services.get(project)?.removeDocument(fileName);
      documentProjects.delete(fileName);
    },
    getDiagnostics: (fileName) => serviceForFile(fileName).getDiagnostics(fileName),
    getCompletions: (position, requestOptions, formattingSettings) =>
      serviceForFile(position.fileName).getCompletions(
        position,
        requestOptions,
        formattingSettings,
      ),
    getHover: (position, maximumLength) =>
      serviceForFile(position.fileName).getHover(position, maximumLength),
    getDefinitions: (position) => serviceForFile(position.fileName).getDefinitions(position),
    getReferences: (position) => serviceForFile(position.fileName).getReferences(position),
    getRename: (position, newName) =>
      serviceForFile(position.fileName).getRename(position, newName),
    getFormatting: (fileName, range, formattingSettings) =>
      serviceForFile(fileName).getFormatting(fileName, range, formattingSettings),
    getCodeActions: (range, errorCodes, formattingSettings, preferences) =>
      serviceForFile(range.fileName).getCodeActions(
        range,
        errorCodes,
        formattingSettings,
        preferences,
      ),
    getApplicableRefactors: (range, preferences) =>
      serviceForFile(range.fileName).getApplicableRefactors(range, preferences),
    getRefactorEdits: (range, refactorName, actionName, formattingSettings, preferences) =>
      serviceForFile(range.fileName).getRefactorEdits(
        range,
        refactorName,
        actionName,
        formattingSettings,
        preferences,
      ),
    getSemanticClassifications: (range) =>
      serviceForFile(range.fileName).getSemanticClassifications(range),
    getInlayHints: (range, preferences) =>
      serviceForFile(range.fileName).getInlayHints(range, preferences),
    reloadProjects: (changedFileNames) => {
      const projectInputs = changedFileNames.filter(isProjectInput);
      if (projectInputs.length === 0) return;
      if (projectInputs.some(isTypeScriptConfig)) {
        reloadAllProjects();
        return;
      }
      reloadSelectedProjects(new Set(projectInputs.map(projectFor)));
    },
    dispose: () => {
      for (const service of services.values()) service.dispose();
      services.clear();
      documents.clear();
      documentProjects.clear();
    },
  };
}
