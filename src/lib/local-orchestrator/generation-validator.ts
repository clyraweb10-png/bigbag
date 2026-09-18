import path from "path";
import ts from "typescript";

export type GeneratedSourceFile = { path: string; content: string };

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".css", ".json"];
const FORBIDDEN_OUTPUTS = new Set([
  "index.html",
  "package.json",
  "package-lock.json",
  "postcss.config.js",
  "postcss.config.mjs",
  "tsconfig.json",
  "vite.config.js",
  "vite.config.ts",
  "src/main.tsx",
  "src/app/layout.tsx",
]);
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
    if (FORBIDDEN_OUTPUTS.has(file.path)) issues.push(`runtime-owned file must not be generated: ${file.path}`);
    if (containsGenerationPlaceholder(file.content)) issues.push(`placeholder or unfinished code in ${file.path}`);
    if (/\.(?:tsx?|jsx?)$/.test(file.path)) {
      const syntaxIssue = sourceSyntaxIssue(file.path, file.content);
      if (syntaxIssue) issues.push(`syntax error in ${file.path}: ${syntaxIssue}`);
    }
  }

  const page = normalizedFiles.find((file) => file.path === "src/app/page.tsx");
  if (!page && options.requireEntrypoint !== false) {
    issues.push("missing required src/app/page.tsx entrypoint");
  } else if (page) {
    if (!hasDefaultExport(page.path, page.content)) issues.push("src/app/page.tsx has no default export");
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
