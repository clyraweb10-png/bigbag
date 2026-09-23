import path from "path";
import postcss from "postcss";
import ts from "typescript";

export type GeneratedSourceFile = { path: string; content: string };

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".css", ".json"];
export const APPLICATION_ENTRYPOINT_PATHS = new Set([
  "src/app/page.tsx",
  "src/app/page.jsx",
  "src/app/page.js",
  "src/App.tsx",
  "src/App.jsx",
  "src/App.js",
  "src/app.tsx",
  "src/app.jsx",
  "src/app.js",
  "src/pages/index.tsx",
  "src/pages/index.jsx",
  "src/pages/index.js",
  "app/page.tsx",
  "app/page.jsx",
  "app/page.js",
  "pages/index.tsx",
  "pages/index.jsx",
  "pages/index.js",
]);
const FORBIDDEN_GENERATED_CHARACTERS = /[\u00a0\u200b-\u200d\u2013\u2014\u2018\u2019\u201c\u201d\u2026\u2060\ufeff]/u;
const VITE_BUILT_IN_ENVIRONMENT_VARIABLES = new Set(["BASE_URL", "DEV", "MODE", "PROD", "SSR"]);

function forbiddenCharacterIssue(filePath: string, content: string): string | null {
  const match = FORBIDDEN_GENERATED_CHARACTERS.exec(content);
  if (!match) return null;
  const codePoint = match[0].codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") || "UNKNOWN";
  return `${filePath} contains forbidden Unicode character U+${codePoint}; use plain ASCII punctuation and spaces`;
}

function structuredFileIssue(filePath: string, content: string): string | null {
  if (filePath.endsWith(".json")) {
    try {
      JSON.parse(content);
    } catch (error) {
      return `invalid JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (filePath.endsWith(".css")) {
    try {
      postcss.parse(content, { from: filePath });
    } catch (error) {
      return `invalid CSS in ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return null;
}

function referencedEnvironmentVariables(content: string): string[] {
  const names = new Set<string>();
  for (const match of content.matchAll(/\bprocess\.env\.([A-Z][A-Z0-9_]*)\b/g)) {
    if (match[1] !== "NODE_ENV") names.add(match[1]);
  }
  for (const match of content.matchAll(/\bimport\.meta\.env\.([A-Z][A-Z0-9_]*)\b/g)) {
    if (
      !VITE_BUILT_IN_ENVIRONMENT_VARIABLES.has(match[1]) &&
      match[1].startsWith("VITE_")
    ) names.add(match[1]);
  }
  return [...names];
}

function unexposedViteEnvironmentVariables(content: string): string[] {
  const names = new Set<string>();
  for (const match of content.matchAll(/\bimport\.meta\.env\.([A-Z][A-Z0-9_]*)\b/g)) {
    const name = match[1];
    if (!VITE_BUILT_IN_ENVIRONMENT_VARIABLES.has(name) && !name.startsWith("VITE_")) {
      names.add(name);
    }
  }
  return [...names];
}

function declaredEnvironmentVariables(content: string): Set<string> {
  const names = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (match) names.add(match[1]);
  }
  return names;
}

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
  if (normalized === "index.html") return true;
  // The platform injects a browser-safe, project-scoped database client here.
  // Model replacements can bypass capability routing or invent dependencies.
  if (/^src\/lib\/db\.[cm]?[jt]sx?$/.test(normalized)) return true;
  if (/^src\/lib\/auth\.[cm]?[jt]sx?$/.test(normalized)) return true;
  if (/^src\/lib\/auth-bridge\.[cm]?[jt]sx?$/.test(normalized)) return true;
  if (/^src\/(?:main|index)\.[cm]?[jt]sx?$/.test(normalized) && content?.includes("@bigbag-runtime-entry")) {
    return true;
  }
  // Discard Next.js App Router layout snippets that cannot execute under the client runtime
  if (/^src\/app\/layout\.[cm]?[jt]sx?$/.test(normalized)) return true;
  // Incomplete HTML fragments that are not complete HTML documents
  if (normalized.endsWith(".html")) {
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

function resolvesLocalRuntimeModule(filePath: string, specifier: string, target: "auth" | "db"): boolean {
  if (specifier === `@/lib/${target}`) return true;
  if (!specifier.startsWith(".")) return false;
  const resolved = normalizeGeneratedPath(path.posix.join(path.posix.dirname(filePath), specifier))
    .replace(/\.(?:[cm]?[jt]sx?)$/, "")
    .replace(/\/index$/, "");
  return resolved === `src/lib/${target}` || resolved === `lib/${target}`;
}

function hasInMemoryAuthenticationMap(filePath: string, content: string): boolean {
  const sourceFile = sourceFileFor(filePath, content);
  let found = false;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isNewExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === "Map"
    ) {
      const purpose = `${node.name.getText(sourceFile)} ${node.initializer.typeArguments?.map((entry) => entry.getText(sourceFile)).join(" ") || ""}`;
      if (/\b(?:users?|profiles?|accounts?|credentials?|sessions?|passwords?|identities|auth)\b/i.test(purpose)) found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function projectDatabaseHandlesCredentials(content: string): boolean {
  return (
    /\.(?:create|update)\s*\([\s\S]{0,400}\b(?:password(?:Hash|_hash)?|accessToken|refreshToken|sessionToken|credential)\b/i.test(content) ||
    (/\.(?:list|get)\s*\(/.test(content) && /\b(?:passwordHash|password_hash|accessToken|refreshToken|sessionToken)\b/.test(content))
  );
}

function usesBrowserStorageAsAuthAuthority(content: string): boolean {
  return /\b(?:localStorage|sessionStorage)\s*(?:\.\s*(?:getItem|setItem|removeItem)\s*\(\s*["'`][^"'`]*(?:auth|session|access[_-]?token|refresh[_-]?token|bearer|jwt)[^"'`]*["'`]|\[\s*["'`][^"'`]*(?:auth|session|token|bearer|jwt)[^"'`]*["'`]\s*])/i.test(content);
}

function generatedSecurityIssues(filePath: string, content: string): string[] {
  if (!/\.(?:tsx?|jsx?)$/.test(filePath)) return [];

  const issues: string[] = [];
  const usesProjectDatabase = importSpecifiers(filePath, content)
    .some((specifier) => resolvesLocalRuntimeModule(filePath, specifier, "db"));
  const handlesPasswords = /\bpasswords?\b/i.test(content);
  const implementsClientPasswordAuth =
    /\bpassword_?hash\b|\bhashPassword\b/i.test(content) ||
    (/crypto\.subtle\.digest\s*\(/.test(content) && handlesPasswords) ||
    /\b(?:password|candidate)\s*(?:===|!==|==|!=)\s*(?:\w+\.)?(?:password|passwordHash|password_hash)\b/i.test(content);
  if (implementsClientPasswordAuth) {
    issues.push(`${filePath} implements password hashing or comparison in browser code; use a real server-verified authentication provider`);
  }

  if (usesProjectDatabase && projectDatabaseHandlesCredentials(content)) {
    issues.push(`${filePath} uses the project CRUD datastore as an authentication system; it is not an end-user identity or authorization boundary`);
  }

  if (
    /\b(?:signIn|signUp|login)\b/.test(content) &&
    hasInMemoryAuthenticationMap(filePath, content) &&
    !importsAuthentication(filePath, content) &&
    !/\b(?:fetch|axios)\s*\(/.test(content)
  ) {
    issues.push(`${filePath} implements in-memory demo authentication without a real provider or server boundary`);
  }

  if (
    /\b(?:local\s+demo|demo\s+(?:identity|account|role)|switch\s+identity|acting\s+as)\b/i.test(content) &&
    /\b(?:identity|authentication|authorization|ownership|role|account)\b/i.test(content) &&
    /\b(?:client[- ]side|onSelect|setIdentity|setRole|useState)\b/i.test(content) &&
    !/\b(?:fetch|axios)\s*\(|@supabase\/supabase-js|@auth0\/|firebase\/auth/.test(content)
  ) {
    issues.push(`${filePath} uses a local demo identity or role switcher as an authorization boundary; use real server-verified authentication and ownership`);
  }

  if (
    usesBrowserStorageAsAuthAuthority(content)
  ) {
    issues.push(`${filePath} uses browser storage as an authentication authority; sessions must be verified by a supported server-side authentication boundary`);
  }

  if (/\b(?:VITE_|NEXT_PUBLIC_)?(?:SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|AWS_SECRET_ACCESS_KEY)\b/.test(content)) {
    issues.push(`${filePath} references a server-only secret from generated browser source`);
  }

  return issues;
}

function generatedAuthContractIssues(filePath: string, content: string): string[] {
  if (!/\.(?:tsx?|jsx?)$/.test(filePath) || !/\bauth\.(?:getSession|signIn|signUp)\s*\(/.test(content)) return [];

  const issues: string[] = [];
  const sourceFile = sourceFileFor(filePath, content);
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      ts.isAwaitExpression(node.initializer) &&
      ts.isCallExpression(node.initializer.expression) &&
      ts.isPropertyAccessExpression(node.initializer.expression.expression)
    ) {
      const receiver = node.initializer.expression.expression.expression;
      const method = node.initializer.expression.expression.name.text;
      if (ts.isIdentifier(receiver) && receiver.text === "auth") {
        if (method === "getSession") {
          issues.push(
            `${filePath} destructures auth.getSession(); the BigBag auth client returns Session | null directly, so assign the return value without a data wrapper`
          );
        }
        if (
          (method === "signIn" || method === "signUp") &&
          node.name.elements.some((element) => {
            const property = element.propertyName || element.name;
            return (ts.isIdentifier(property) || ts.isStringLiteralLike(property)) && property.text === "error";
          })
        ) {
          issues.push(
            `${filePath} destructures error from auth.${method}(); BigBag auth methods throw provider errors, so use try/catch and read the returned { user, session } data`
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
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

function importsAuthentication(filePath: string, content: string): boolean {
  return importSpecifiers(filePath, content).some((specifier) => {
    if (
      specifier === "@/lib/auth" ||
      specifier === "@supabase/supabase-js" ||
      specifier === "firebase/auth" ||
      specifier === "@auth0/auth0-react" ||
      specifier.startsWith("@auth0/")
    ) return true;
    return resolvesLocalRuntimeModule(filePath, specifier, "auth");
  });
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
  options: {
    requireEntrypoint?: boolean;
    requireEntrypointFirst?: boolean;
    existingEnvironmentExample?: string;
    /** Seed/demo records are allowed only when the user's initial request explicitly asks for them. */
    allowSeedData?: boolean;
    /** Generated auth UI is allowed only when the user's request needs accounts or protected data. */
    allowAuthentication?: boolean;
    /** Existing source is security-scanned so a narrow edit cannot preserve a critical violation. */
    existingSources?: GeneratedSourceFile[];
  } = {}
): string[] {
  const issues: string[] = [];
  const existingPathList = [...existingPaths].map(normalizeGeneratedPath);
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
    if (!file.content.trim()) issues.push(`empty generated file: ${file.path}`);
    if (isRuntimeOwnedGeneratedPath(file.path, file.content)) issues.push(`runtime-owned file must not be generated: ${file.path}`);
    if (containsGenerationPlaceholder(file.content)) issues.push(`placeholder or unfinished code in ${file.path}`);
    if (
      options.allowSeedData !== true &&
      /(?:^|\/)(?:seed|seeds|fixtures?)(?:\.(?:[cm]?[jt]sx?|json)|\/)/i.test(file.path)
    ) {
      issues.push(`${file.path} adds seed or fixture data without an explicit user request for demo/seed data`);
    }
    if (
      options.allowAuthentication === false &&
      importsAuthentication(file.path, file.content)
    ) {
      issues.push(`${file.path} adds authentication even though the user did not request accounts or protected data`);
    }
    if (/\b__BIGBAG_DB__\b/.test(file.content)) {
      issues.push(`${file.path} references unsupported runtime global __BIGBAG_DB__; use the browser-safe @/lib/db client`);
    }
    const characterIssue = forbiddenCharacterIssue(file.path, file.content);
    if (characterIssue) issues.push(characterIssue);
    const structuredIssue = structuredFileIssue(file.path, file.content);
    if (structuredIssue) issues.push(structuredIssue);
    issues.push(...visualQualityIssues(file.path, file.content));
    issues.push(...generatedSecurityIssues(file.path, file.content));
    issues.push(...generatedAuthContractIssues(file.path, file.content));
    if (/\.(?:tsx?|jsx?)$/.test(file.path)) {
      const syntaxIssue = sourceSyntaxIssue(file.path, file.content);
      if (syntaxIssue) issues.push(`syntax error in ${file.path}: ${syntaxIssue}`);
      if (hasUnsupportedDirectDatabaseCall(file.path, file.content)) {
        issues.push(`${file.path} invents a database method; use db.collection(name).list/get/create/update/remove`);
      }
    }
  }

  for (const existing of options.existingSources || []) {
    const existingPath = normalizeGeneratedPath(existing.path);
    if (generatedPaths.has(existingPath)) continue;
    issues.push(...generatedSecurityIssues(existingPath, existing.content));
  }

  const existingNormalized = new Set(existingPathList);
  const hasExistingEntrypoint = [...existingNormalized].some((entry) => APPLICATION_ENTRYPOINT_PATHS.has(entry));
  const foundEntrypointIndex = normalizedFiles.findIndex((file) => APPLICATION_ENTRYPOINT_PATHS.has(file.path));
  const foundEntrypoint = foundEntrypointIndex >= 0 ? normalizedFiles[foundEntrypointIndex] : undefined;

  if (!hasExistingEntrypoint && !foundEntrypoint && options.requireEntrypoint !== false) {
    issues.push("missing required application entrypoint (src/App.tsx, src/app/page.tsx, or src/pages/index.tsx)");
  }
  if (!hasExistingEntrypoint && foundEntrypointIndex > 0 && options.requireEntrypointFirst) {
    issues.push(`${foundEntrypoint!.path} must be the first generated file block`);
  }

  const effectiveEntrypoints = new Set(
    [...existingNormalized].filter((entry) => APPLICATION_ENTRYPOINT_PATHS.has(entry) && !generatedPaths.has(entry))
  );
  for (const generatedPath of generatedPaths) {
    if (APPLICATION_ENTRYPOINT_PATHS.has(generatedPath)) effectiveEntrypoints.add(generatedPath);
  }
  if (effectiveEntrypoints.size > 1) {
    issues.push(`multiple application entrypoints are present: ${[...effectiveEntrypoints].sort().join(", ")}`);
  }

  const generatedEnvironmentExample = normalizedFiles.find((file) => file.path === ".env.example");
  const hasExistingEnvironmentExample =
    existingNormalized.has(".env.example") || options.existingEnvironmentExample !== undefined;
  const declaredEnvironment = generatedEnvironmentExample
    ? declaredEnvironmentVariables(generatedEnvironmentExample.content)
    : options.existingEnvironmentExample !== undefined
      ? declaredEnvironmentVariables(options.existingEnvironmentExample)
      : null;
  for (const file of normalizedFiles) {
    for (const variable of unexposedViteEnvironmentVariables(file.content)) {
      issues.push(`${file.path} references import.meta.env.${variable}, which Vite does not expose; use a VITE_ prefix`);
    }
    for (const variable of referencedEnvironmentVariables(file.content)) {
      if (!generatedEnvironmentExample && !hasExistingEnvironmentExample) {
        issues.push(`${file.path} references ${variable} but .env.example is missing`);
      } else if (declaredEnvironment && !declaredEnvironment.has(variable)) {
        issues.push(`${file.path} references ${variable} but .env.example does not declare it`);
      } else if (!declaredEnvironment) {
        issues.push(`${file.path} references ${variable} but existing .env.example declarations were not provided for validation`);
      }
    }
  }

  for (const file of normalizedFiles) {
    if (APPLICATION_ENTRYPOINT_PATHS.has(file.path) && !hasDefaultExport(file.path, file.content)) {
      issues.push(`${file.path} has no default export`);
    }
  }

  const availablePaths = new Set(
    [...existingPathList, ...generatedPaths]
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
