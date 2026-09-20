import path from "path";
import ts from "typescript";

export type GeneratedSourceFile = { path: string; content: string };

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".css", ".json"];

function isCompleteHtmlDocument(content: string): boolean {
  const trimmed = content.trim();
  if (/\{children\}/.test(trimmed) || /className=\{/.test(trimmed)) return false;
  if (trimmed.length < 80) return false;
  const hasDoctype = /<!DOCTYPE html/i.test(trimmed);
  const hasHtml = /<html[\s>]/i.test(trimmed);
  const hasBody = /<body[\s>]/i.test(trimmed);
  return (hasDoctype || hasHtml) && hasBody && !/\{[a-zA-Z_][\w.]*\}/.test(trimmed);
}

/**
 * Files owned by the generated-app runtime rather than by the model. Harmless
 * legacy layout snippets or broken HTML stubs are discarded before a valid page
 * is assessed.
 */
export function isRuntimeOwnedGeneratedPath(value: string, content?: string): boolean {
  const normalized = normalizeGeneratedPath(value);
  if (normalized === "package-lock.json") return true;
  // Discard Next.js App Router layout snippets that cannot execute under the client runtime
  if (/^src\/app\/layout\.[cm]?[jt]sx?$/.test(normalized)) return true;
  // Incomplete HTML fragments (e.g. `<div id="root"></div>`) that are not complete HTML documents
  if (normalized === "index.html" || normalized.endsWith(".html")) {
    if (content !== undefined && !isCompleteHtmlDocument(content)) {
      return true;
    }
  }
  return false;
}
const PLACEHOLDER_MARKERS = [
  "Generation Issue",
  "Awaiting Retry",
  "Customizable component ready for additional features.",
  "AI is assembling your application",
  "Ready for Prompt",
];

export function normalizeGeneratedPath(value: string): string {
  const normalized = path.posix.normalize(value.replace(/\\/g, "/"));
  return normalized === "." ? "" : normalized.replace(/^\.\//, "");
}

export function containsGenerationPlaceholder(content: string): boolean {
  return (
    PLACEHOLDER_MARKERS.some((marker) => content.includes(marker)) ||
    /className\s*=\s*["']\s*\.{3}\s*["']/.test(content) ||
    /(?:\/\/[^\n]*\b(?:TODO|FIXME)\b|\/\*[\s\S]*?\b(?:TODO|FIXME)\b[\s\S]*?\*\/)/.test(content)
  );
}

function cssImportSpecifiers(content: string): string[] {
  const specifiers = new Set<string>();
  let index = 0;

  const skipTrivia = () => {
    while (index < content.length) {
      if (/\s/.test(content[index])) {
        index += 1;
      } else if (content.startsWith("/*", index)) {
        const end = content.indexOf("*/", index + 2);
        index = end === -1 ? content.length : end + 2;
      } else {
        break;
      }
    }
  };
  const readString = (): string | null => {
    const quote = content[index];
    if (quote !== '"' && quote !== "'") return null;
    index += 1;
    let value = "";
    while (index < content.length) {
      const character = content[index++];
      if (character === quote) return value;
      if (character === "\\" && index < content.length) {
        value += content[index++];
      } else {
        value += character;
      }
    }
    return null;
  };

  while (index < content.length) {
    skipTrivia();
    if (index >= content.length) break;
    if (content[index] === '"' || content[index] === "'") {
      readString();
      continue;
    }
    if (!content.slice(index).match(/^@import\b/i)) {
      index += 1;
      continue;
    }

    index += "@import".length;
    skipTrivia();
    let usesUrlFunction = false;
    if (content.slice(index).match(/^url\b/i)) {
      usesUrlFunction = true;
      index += "url".length;
      skipTrivia();
      if (content[index] !== "(") continue;
      index += 1;
      skipTrivia();
    }
    let specifier = readString();
    if (specifier === null && usesUrlFunction) {
      const start = index;
      while (index < content.length && !/[\s)]/.test(content[index])) index += 1;
      specifier = content.slice(start, index) || null;
    }
    if (specifier !== null) specifiers.add(specifier);
  }
  return [...specifiers];
}

function sourceFileFor(filePath: string, content: string): ts.SourceFile {
  const extension = path.posix.extname(filePath);
  const scriptKind = extension === ".tsx"
    ? ts.ScriptKind.TSX
    : extension === ".jsx"
      ? ts.ScriptKind.JSX
      : extension === ".js"
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind);
}

function sourceSyntaxIssue(filePath: string, content: string): string | null {
  const sourceFile = sourceFileFor(filePath, content) as ts.SourceFile & {
    parseDiagnostics?: readonly ts.Diagnostic[];
  };
  const diagnostic = sourceFile.parseDiagnostics?.find(
    (entry) => entry.category === ts.DiagnosticCategory.Error
  );
  return diagnostic ? ts.flattenDiagnosticMessageText(diagnostic.messageText, " ") : null;
}

function jsxOpeningTags(content: string, tagName: "img" | "main" | "section"): string[] {
  const tags: string[] = [];
  const sourceFile = sourceFileFor("generated-visual-check.tsx", content);
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(sourceFile).toLowerCase() === tagName
    ) {
      tags.push(content.slice(node.getStart(sourceFile), node.end));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return tags;
}

function visualQualityIssues(filePath: string, content: string): string[] {
  const issues: string[] = [];
  if (/\.(?:tsx?|jsx?)$/.test(filePath)) {
    const imageTags = jsxOpeningTags(content, "img");
    for (const tag of imageTags) {
      if (!/(?:^|\s)alt\s*=/.test(tag)) {
        issues.push(`${filePath} contains an image without alt text`);
      }
      if (/\bsrc\s*=\s*(?:["']\s*(?:#|about:blank)?\s*["']|\{\s*["']\s*(?:#|about:blank)?\s*["']\s*\})/i.test(tag)) {
        issues.push(`${filePath} contains an unresolved image source`);
      }
      if (/\b(?:placeholder\.com|placehold\.co|via\.placeholder|picsum\.photos|source\.unsplash\.com)\b/i.test(tag)) {
        issues.push(`${filePath} contains a placeholder or random image endpoint`);
      }
    }

    const shellTags = [
      ...jsxOpeningTags(content, "main"),
      ...jsxOpeningTags(content, "section"),
    ];
    for (const tag of shellTags) {
      const fixedMinimum = tag.match(/(?:["'`]|\s)min-w-\[(\d+)px\](?=\s|["'`])/);
      if (fixedMinimum && Number(fixedMinimum[1]) > 390) {
        issues.push(`${filePath} contains a fixed minimum-width page section that can overflow mobile viewports`);
      }
    }
  }

  if (filePath.endsWith(".css")) {
    const rootRules = content.match(/(?:^|[;{}])\s*(?:html|body|#root)(?:\s*,\s*(?:html|body|#root))*\s*\{[^}]*}/gim) || [];
    for (const rule of rootRules) {
      const minimum = rule.match(/min-width\s*:\s*(\d+)px/i);
      if (minimum && Number(minimum[1]) > 390) {
        issues.push(`${filePath} sets a fixed root minimum width that can cause document-level horizontal scrolling`);
      }
    }
  }
  return issues;
}

const UNSUPPORTED_DIRECT_DATABASE_METHODS = new Set([
  "list", "get", "create", "update", "remove", "putMany", "query", "insert", "delete",
]);

function hasUnsupportedDirectDatabaseCall(filePath: string, content: string): boolean {
  const compilerOptions: ts.CompilerOptions = {
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.Latest,
    jsx: ts.JsxEmit.ReactJSX,
  };
  const parsedSource = sourceFileFor(filePath, content);
  const host = ts.createCompilerHost(compilerOptions, true);
  host.fileExists = (name) => name === filePath;
  host.readFile = (name) => name === filePath ? content : undefined;
  host.getSourceFile = (name) => name === filePath ? parsedSource : undefined;
  const program = ts.createProgram([filePath], compilerOptions, host);
  const sourceFile = program.getSourceFile(filePath) || parsedSource;
  const checker = program.getTypeChecker();
  const bindings = new Set<ts.Symbol>();
  const addBinding = (identifier: ts.Identifier | undefined) => {
    const symbol = identifier && checker.getSymbolAtLocation(identifier);
    if (symbol) bindings.add(symbol);
  };

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@/lib/db"
    ) continue;
    const clause = statement.importClause;
    addBinding(clause?.name);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if ((element.propertyName?.text || element.name.text) === "db") addBinding(element.name);
      }
    }
  }
  if (bindings.size === 0) return false;

  // Follow simple local aliases (`const store = client`) so renaming the import
  // cannot bypass validation. Repeat because aliases may form a short chain.
  let addedAlias = true;
  while (addedAlias) {
    addedAlias = false;
    const visitAliases = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isIdentifier(node.initializer)
      ) {
        const sourceSymbol = checker.getSymbolAtLocation(node.initializer);
        const aliasSymbol = checker.getSymbolAtLocation(node.name);
        if (sourceSymbol && aliasSymbol && bindings.has(sourceSymbol) && !bindings.has(aliasSymbol)) {
          bindings.add(aliasSymbol);
          addedAlias = true;
        }
      }
      ts.forEachChild(node, visitAliases);
    };
    visitAliases(sourceFile);
  }

  let unsupported = false;
  const visitCalls = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      Boolean(checker.getSymbolAtLocation(node.expression.expression) &&
        bindings.has(checker.getSymbolAtLocation(node.expression.expression)!)) &&
      UNSUPPORTED_DIRECT_DATABASE_METHODS.has(node.expression.name.text)
    ) unsupported = true;
    if (!unsupported) ts.forEachChild(node, visitCalls);
  };
  visitCalls(sourceFile);
  return unsupported;
}

function importSpecifiers(filePath: string, content: string): string[] {
  if (filePath.endsWith(".css")) return cssImportSpecifiers(content);

  const specifiers = new Set<string>();
  const sourceFile = sourceFileFor(filePath, content);
  const addLiteral = (node: ts.Node | undefined) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.add(node.text);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addLiteral(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addLiteral(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) addLiteral(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...specifiers];
}

function hasDefaultExport(filePath: string, content: string): boolean {
  const sourceFile = sourceFileFor(filePath, content);
  return sourceFile.statements.some((statement) => {
    if (ts.isExportAssignment(statement)) return !statement.isExportEquals;
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      if (statement.isTypeOnly) return false;
      return statement.exportClause.elements.some(
        (element) => !element.isTypeOnly && element.name.text === "default"
      );
    }
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) return false;
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    return Boolean(
      modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
      modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
    );
  });
}

function resolvesLocalImport(
  importer: string,
  specifier: string,
  availablePaths: Set<string>
): boolean {
  let target: string;
  if (specifier.startsWith("@/")) {
    target = `src/${specifier.slice(2)}`;
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    target = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  } else {
    return true;
  }

  const normalized = normalizeGeneratedPath(target);
  const candidates = [normalized];
  if (!path.posix.extname(normalized)) {
    for (const extension of SOURCE_EXTENSIONS) candidates.push(`${normalized}${extension}`);
    for (const extension of SOURCE_EXTENSIONS) candidates.push(`${normalized}/index${extension}`);
  }
  return candidates.some((candidate) => availablePaths.has(candidate));
}

/**
 * Reject model output that can compile only after placeholder files are invented.
 * Existing runtime/template files may be supplied as available paths, but known
 * placeholder files should be omitted by the caller.
 */
export function generationValidationIssues(
  files: GeneratedSourceFile[],
  existingPaths: Iterable<string> = [],
  options: { requireEntrypoint?: boolean } = {}
): string[] {
  const issues: string[] = [];
  if (files.length === 0) issues.push("no source files were returned");
  const normalizedFiles = files.map((file) => ({
    path: normalizeGeneratedPath(file.path),
    content: file.content,
  }));
  const generatedPaths = new Set<string>();

  for (const file of normalizedFiles) {
    if (
      !file.path ||
      file.path.startsWith("/") ||
      /^[A-Za-z]:\//.test(file.path) ||
      file.path === ".." ||
      file.path.startsWith("../") ||
      file.path.includes("/../") ||
      file.path.includes("\0")
    ) {
      issues.push(`unsafe output path: ${file.path || "(empty)"}`);
      continue;
    }
    if (generatedPaths.has(file.path)) issues.push(`duplicate file block: ${file.path}`);
    generatedPaths.add(file.path);
    if (isRuntimeOwnedGeneratedPath(file.path, file.content)) issues.push(`runtime-owned file must not be generated: ${file.path}`);
    if (containsGenerationPlaceholder(file.content)) issues.push(`placeholder or unfinished code in ${file.path}`);
    issues.push(...visualQualityIssues(file.path, file.content));
    if (/\.(?:tsx?|jsx?)$/.test(file.path)) {
      const syntaxIssue = sourceSyntaxIssue(file.path, file.content);
      if (syntaxIssue) issues.push(`syntax error in ${file.path}: ${syntaxIssue}`);
      if (hasUnsupportedDirectDatabaseCall(file.path, file.content)) {
        issues.push(`${file.path} invents a database method; use db.collection(name).list/get/create/update/remove`);
      }
    }
  }

  const VALID_ENTRYPOINTS = new Set([
    "src/app/page.tsx",
    "src/app/page.jsx",
    "src/App.tsx",
    "src/App.jsx",
    "src/app.tsx",
    "src/app.jsx",
    "src/main.tsx",
    "src/main.jsx",
    "src/index.tsx",
    "src/index.jsx",
    "app/page.tsx",
    "app/page.jsx",
    "pages/index.tsx",
    "pages/index.jsx",
    "index.html",
  ]);

  const existingNormalized = new Set([...existingPaths].map(normalizeGeneratedPath));
  const hasExistingEntrypoint = [...existingNormalized].some(
    (p) => VALID_ENTRYPOINTS.has(p) || p.endsWith("/page.tsx") || p.endsWith("/page.jsx") || p === "index.html"
  );

  const foundEntrypoint = normalizedFiles.find(
    (file) => VALID_ENTRYPOINTS.has(file.path) || file.path.endsWith("/page.tsx") || file.path.endsWith("/page.jsx")
  );

  if (!hasExistingEntrypoint && !foundEntrypoint && options.requireEntrypoint !== false) {
    issues.push("missing required application entrypoint (e.g. src/App.tsx, src/app/page.tsx, or index.html)");
  }

  for (const file of normalizedFiles) {
    if (
      file.path === "src/app/page.tsx" ||
      file.path === "src/app/page.jsx" ||
      file.path === "src/App.tsx" ||
      file.path === "src/App.jsx" ||
      file.path === "src/app.tsx" ||
      file.path === "src/app.jsx"
    ) {
      if (!hasDefaultExport(file.path, file.content)) {
        issues.push(`${file.path} has no default export`);
      }
    }
  }

  const availablePaths = new Set(
    [...existingPaths, ...generatedPaths].map(normalizeGeneratedPath)
  );
  for (const file of normalizedFiles) {
    if (!/\.(?:tsx?|jsx?|css)$/.test(file.path)) continue;
    for (const specifier of importSpecifiers(file.path, file.content)) {
      if (!resolvesLocalImport(file.path, specifier, availablePaths)) {
        issues.push(`${file.path} imports missing local module ${specifier}`);
      }
    }
  }

  return [...new Set(issues)];
}
