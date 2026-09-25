import path from "path";
import { createHash } from "node:crypto";
import postcss from "postcss";
import ts from "typescript";
import { scanGeneratedSourceLine } from "../generated-source-security";

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
const STARTER_UI_COMPONENTS = new Set([
  "button", "card", "label", "input", "textarea", "checkbox", "switch", "separator",
  "badge", "skeleton", "skeleton-card", "spinner", "alert", "empty-state", "metric-card", "table", "dialog",
  "sheet", "dropdown-menu", "tabs", "tooltip", "select", "breadcrumbs", "pagination",
  "form", "index", "sparkline", "chart-container", "image-frame",
]);

export function seedRecordIntent(text: string): boolean | null {
  const request = /\b(?:seed(?:ed|ing)?|demo|sample|fixture|mock)(?:\s+(?:the|a|my|some|[0-9]+|one|two|three|five|ten))?\s+(?:data|database|records|products?|inventory|catalog(?:ue)?|items?|users?|orders?)\b/gi;
  let permitted: boolean | null = null;
  let prohibited = false;
  for (const match of text.matchAll(request)) {
    const prefix = text.slice(Math.max(0, (match.index || 0) - 45), match.index);
    const remainder = text.slice((match.index || 0) + match[0].length).split(/[.!?;\n]/, 1)[0];
    const negatedBefore = /\b(?:no|never|without|avoid|don't|do not|must not|remove|delete|stop|disable|not)\s+(?:\w+\s+){0,4}$/i.test(prefix);
    const negatedAfter = /^\s+(?:(?:is|are|was|were|should|must|can|will)\s+(?:not|never|unnecessary|unwanted|forbidden|prohibited)|(?:isn't|aren't|wasn't|weren't|shouldn't|mustn't|can't|won't))\b/i.test(remainder);
    prohibited ||= negatedBefore || negatedAfter;
    if (!negatedBefore && !negatedAfter) permitted = true;
  }
  return prohibited ? false : permitted;
}

function containsInlineSeedRecords(filePath: string, content: string): boolean {
  if (!/\.[cm]?[jt]sx?$/.test(filePath)) return false;
  const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function resolvesRecordArray(reference: ts.Identifier): boolean {
    for (let scope: ts.Node | undefined = reference.parent; scope; scope = scope.parent) {
      if (ts.isFunctionLike(scope) && scope.parameters.some((parameter) =>
        ts.isIdentifier(parameter.name) && parameter.name.text === reference.text)) return false;
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
      const declaration = scope.statements
        .filter(ts.isVariableStatement)
        .flatMap((statement) => [...statement.declarationList.declarations])
        .find((entry) => ts.isIdentifier(entry.name) && entry.name.text === reference.text && entry.pos < reference.pos);
      if (declaration) return Boolean(declaration.initializer && ts.isArrayLiteralExpression(declaration.initializer) &&
        declaration.initializer.elements.some((element) => ts.isObjectLiteralExpression(element)));
    }
    return false;
  }

  function boundNames(binding: ts.BindingName): Set<string> {
    if (ts.isIdentifier(binding)) return new Set([binding.text]);
    return new Set(binding.elements.flatMap((element) =>
      ts.isOmittedExpression(element) ? [] : [...boundNames(element.name)]));
  }

  function refersToRecord(argument: ts.Expression, recordNames: Set<string>): boolean {
    while (ts.isAsExpression(argument) || ts.isTypeAssertionExpression(argument) ||
      ts.isSatisfiesExpression(argument) || ts.isParenthesizedExpression(argument) || ts.isNonNullExpression(argument)) {
      argument = argument.expression;
    }
    return ts.isIdentifier(argument) && recordNames.has(argument.text) ||
      ts.isObjectLiteralExpression(argument) && argument.properties.some((property) =>
        ts.isSpreadAssignment(property) && refersToRecord(property.expression, recordNames) ||
        ts.isShorthandPropertyAssignment(property) && recordNames.has(property.name.text) ||
        ts.isPropertyAssignment(property) && refersToRecord(property.initializer, recordNames));
  }

  function createsRecord(node: ts.Node, recordNames: Set<string>): boolean {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "create" &&
      node.arguments.some((argument) => refersToRecord(argument, recordNames))) return true;
    return Boolean(ts.forEachChild(node, (child) => createsRecord(child, recordNames) || undefined));
  }

  let found = false;
  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isForOfStatement(node) && ts.isIdentifier(node.expression) && resolvesRecordArray(node.expression) &&
      ts.isVariableDeclarationList(node.initializer)) {
      found = node.initializer.declarations.some((declaration) =>
        createsRecord(node.statement, boundNames(declaration.name)));
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      ["forEach", "map"].includes(node.expression.name.text) && ts.isIdentifier(node.expression.expression) &&
      resolvesRecordArray(node.expression.expression)) {
      found = node.arguments.some((argument) =>
        (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) &&
        argument.parameters.some((parameter) => createsRecord(argument.body, boundNames(parameter.name))));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

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

function nonCodeComponentIssue(filePath: string, content: string): string | null {
  if (!/\.(?:tsx|jsx)$/.test(filePath)) return null;
  const sourceFile = sourceFileFor(filePath, content);
  const hasModuleCode = sourceFile.statements.some((statement) =>
    ts.isImportDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement) ||
    ts.isExportDeclaration(statement) ||
    ts.isExportAssignment(statement) ||
    ts.isVariableStatement(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isModuleDeclaration(statement)
  );
  return hasModuleCode ? null : `non-code content in ${filePath}; return a complete component module`;
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
  // A sibling ui.tsx wins module resolution over components/ui/index.ts and
  // would make every preinstalled primitive import disappear.
  if (/^src\/components\/ui\.[cm]?[jt]sx?$/.test(normalized)) return true;
  const starterUi = /^src\/components\/ui\/([a-z][a-z0-9-]*)\.[cm]?[jt]sx?$/.exec(normalized);
  if (starterUi && STARTER_UI_COMPONENTS.has(starterUi[1])) return true;
  const starterLayout = /^src\/components\/layout\/(dashboard-shell|marketing-shell|storefront-shell|editorial-shell|focus-shell|index)\.[cm]?[jt]sx?$/.exec(normalized);
  if (starterLayout) {
    // The starter's barrel is the one supported import surface. An index.tsx
    // from the model can shadow index.ts and silently change every shell import.
    if (starterLayout[1] === "index") return true;
    // A model may customize a shell at the same path. Only the injected starter
    // (including layouts created before the marker was introduced) is runtime-owned.
    // Callers checking a deletion have no content; protect the known path until
    // a replacement is supplied so the workspace cannot lose an imported shell.
    if (content === undefined) return true;
    if (content?.startsWith("// @bigbag-runtime-layout\n")) return true;
    const legacyHashes: Record<string, string> = {
      "dashboard-shell": "6d3ad636b60c7fe6708455099b3da204ccde8c8c30c333932808d53ed83945aa",
      "marketing-shell": "d34d50b027be686719c69f3f0c2fe26536bfae9b53cfdf48e07984d8ac7021f8",
      "storefront-shell": "884ba9736a5a51e90c025db3651f68b9673abf13486a6446135fffb3e99a07a4",
      "editorial-shell": "1a1ae10eff7b16732f045a13e49816ab04af22c8324b4e19305163c00bbaa7ea",
      "focus-shell": "6685bef90cd6ae8c0b783ba541f7fe8bf691428dc741cc960b0b1b7875f76f50",
      index: "8c8bb0120e2ce0755feb8a8840e662ec7d70d3c5375720b1d893e56a00b4543e",
    };
    return Boolean(content && createHash("sha256").update(content).digest("hex") === legacyHashes[starterLayout[1]]);
  }
  // These files execute during installation or build and are owned by the
  // platform. Package additions go through the vetted dependency scanner.
  if (/^(?:package\.json|(?:vite|postcss|tailwind|tsconfig)\.config\.[cm]?[jt]s|tsconfig\.json)$/.test(normalized)) return true;
  if (normalized === "package-lock.json") return true;
  if (normalized === "index.html") return true;
  // The platform injects a browser-safe, project-scoped database client here.
  // Model replacements can bypass capability routing or invent dependencies.
  if (/^src\/lib\/db\.[cm]?[jt]sx?$/.test(normalized)) return true;
  if (/^src\/lib\/auth\.[cm]?[jt]sx?$/.test(normalized)) return true;
  if (/^src\/lib\/auth-bridge\.[cm]?[jt]sx?$/.test(normalized)) return true;
  if (/^src\/lib\/files\.[cm]?[jt]sx?$/.test(normalized)) return true;
  if (/^src\/lib\/utils\.[cm]?[jt]sx?$/.test(normalized)) return true;
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

/**
 * Keep files named by validation diagnostics at the front of the bounded
 * repair context. Large generations previously truncated the failing file out
 * of the prompt, causing repeated model rewrites that could never address the
 * reported syntax error.
 */
export function validationRepairContext(
  files: GeneratedSourceFile[],
  issues: string[],
  maxCharacters = 48_000
): string {
  const issueText = issues.join("\n");
  const prioritized = files
    .map((file, index) => ({ file, index, referenced: issueText.includes(normalizeGeneratedPath(file.path)) }))
    .sort((left, right) => Number(right.referenced) - Number(left.referenced) || left.index - right.index)
    .map(({ file }) => file);
  let remaining = Math.max(1, maxCharacters);
  const completeFiles: string[] = [];
  for (const file of prioritized) {
    const block = `### File: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``;
    const cost = block.length + (completeFiles.length ? 2 : 0);
    if (cost > remaining) continue;
    completeFiles.push(block);
    remaining -= cost;
  }
  return completeFiles.join("\n\n");
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

function inactiveAnchorIssue(filePath: string, content: string): string | null {
  const sourceFile = sourceFileFor(filePath, content);
  let found = false;
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(sourceFile).toLowerCase() === "a") {
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
      const href = attributes.find((attribute) => attribute.name.getText(sourceFile) === "href")?.initializer;
      const onClick = attributes.some((attribute) => attribute.name.getText(sourceFile) === "onClick");
      if (href && ts.isStringLiteral(href) && href.text.trim() === "#" && !onClick) found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found ? `${filePath} contains a link to "#" with no click action; wire it to a real destination or explain that the action is unavailable` : null;
}

function generatedNavigationAndLandmarkIssues(filePath: string, content: string): string[] {
  const sourceFile = sourceFileFor(filePath, content);
  const issues = new Set<string>();
  const shellNames = new Set(["DashboardShell", "MarketingShell", "EditorialShell", "FocusShell"]);
  const staticAttribute = (node: ts.JsxOpeningLikeElement, name: string): string | null => {
    const attribute = node.attributes.properties.find((entry) => ts.isJsxAttribute(entry) && entry.name.getText(sourceFile) === name);
    if (!attribute || !ts.isJsxAttribute(attribute)) return null;
    if (attribute.initializer && ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text.trim();
    const expression = attribute.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : null;
    return expression && ts.isStringLiteral(expression) ? expression.text.trim() : null;
  };
  const associatedLabelIds = new Set<string>();
  const collectLabels = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ["label", "Label"].includes(node.tagName.getText(sourceFile))) {
      const target = staticAttribute(node, "htmlFor");
      if (target) associatedLabelIds.add(target);
    }
    ts.forEachChild(node, collectLabels);
  };
  collectLabels(sourceFile);
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && node.name.getText(sourceFile) === "href" &&
      ts.isStringLiteral(node.initializer) && node.initializer.text.trim() === "#" &&
      ts.isObjectLiteralExpression(node.parent) &&
      !node.parent.properties.some((property) => ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === "onClick")) {
      issues.add(`${filePath} contains an inert navigation destination href: "#"; use a real route or an onClick action`);
    }
    if (ts.isJsxElement(node) && shellNames.has(node.openingElement.tagName.getText(sourceFile))) {
      let nestedMain = false;
      const findMain = (child: ts.Node): void => {
        if ((ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) && child.tagName.getText(sourceFile) === "main") {
          nestedMain = true;
        }
        ts.forEachChild(child, findMain);
      };
      node.children.forEach(findMain);
      if (nestedMain) issues.add(`${filePath} nests <main> inside a layout shell that already provides the main landmark; use a section or div for its children`);
    }
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(sourceFile) === "SelectTrigger") {
      const id = staticAttribute(node, "id");
      if (!staticAttribute(node, "aria-label") && !staticAttribute(node, "aria-labelledby") &&
        !(id && associatedLabelIds.has(id))) {
        issues.add(`${filePath} uses SelectTrigger without an accessible name; add aria-label, aria-labelledby, or an id connected to a visible label`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...issues];
}

function blockingBrowserDialogIssue(filePath: string, content: string): string | null {
  const sourceFile = sourceFileFor(filePath, content);
  let found = false;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      found ||= (ts.isIdentifier(callee) && ["prompt", "alert", "confirm"].includes(callee.text)) ||
        (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) &&
          callee.expression.text === "window" && ["prompt", "alert", "confirm"].includes(callee.name.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found ? `${filePath} uses a blocking browser prompt/alert/confirm for an app workflow; use an accessible form, dialog, or toast with validation instead` : null;
}

function visualQualityIssues(filePath: string, content: string): string[] {
  const issues: string[] = [];
  if (/\.(?:tsx?|jsx?)$/.test(filePath)) {
    const inactiveAnchor = inactiveAnchorIssue(filePath, content);
    if (inactiveAnchor) issues.push(inactiveAnchor);
    const blockingDialog = blockingBrowserDialogIssue(filePath, content);
    if (blockingDialog) issues.push(blockingDialog);
    issues.push(...generatedNavigationAndLandmarkIssues(filePath, content));
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

  // ── Part 5: Design-system QA extensions ──────────────────────────────────

  if (/\.(?:tsx?|jsx?)$/.test(filePath)) {
    // E-series: Banned placeholder strings (extends containsGenerationPlaceholder)
    const BANNED_PLACEHOLDERS = [
      "John Doe", "Jane Smith", "Acme Corp", "Test Company",
      "Product 1", "Product 2", "Item 1", "Item 2", "Task 1", "Task 2",
      "User 1", "User 2", "test@test.com", "foo@bar.com",
    ] as const;
    for (const banned of BANNED_PLACEHOLDERS) {
      if (content.includes(banned)) {
        issues.push(`${filePath} contains banned placeholder content: "${banned}" — replace with authentic synthetic domain data`);
      }
    }

    // A-series: Banned charting library imports
    const bannedChartMatch = content.match(/from\s+['"](?:recharts|chart\.js|d3|victory|nivo|apexcharts|highcharts)['"]/);
    if (bannedChartMatch) {
      issues.push(`${filePath} imports a banned charting library (${bannedChartMatch[0]}) — use Sparkline, SimpleBarChart, ChartContainer, or DistributionBar from @/components/ui/ instead`);
    }

    // A-series: Raw hex colors in Tailwind utility classes bypass design tokens
    const hexClassMatch = content.match(/className\s*=\s*[`"'][^`"']*(?:text|bg|border)-\[#[0-9a-fA-F]{3,6}\][^`"']*[`"']/);
    if (hexClassMatch) {
      issues.push(`${filePath} uses a raw hex color in a Tailwind class name — use var(--token) references like bg-[var(--primary)] instead`);
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
  const sourceFile = sourceFileFor("generated.tsx", content);
  const credential = /\b(?:password(?:Hash|_hash)?|accessToken|refreshToken|sessionToken|credential)\b/i;
  let writesCredential = false;
  let readsProjectRecords = false;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const operation = node.expression.name.text;
      if (operation === "create" || operation === "update") {
        // Inspect only this call's arguments. A broad source regex can consume
        // an unrelated auth.signUp password hundreds of characters later.
        writesCredential ||= node.arguments.some((argument) => credential.test(argument.getText(sourceFile)));
      } else if (operation === "list" || operation === "get") {
        readsProjectRecords = true;
      }
    }
    if (!writesCredential) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return writesCredential || (readsProjectRecords &&
    /\b(?:passwordHash|password_hash|accessToken|refreshToken|sessionToken)\b/.test(content));
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
  if (!/\.(?:tsx?|jsx?)$/.test(filePath)) return [];

  const issues: string[] = [];
  const sourceFile = sourceFileFor(filePath, content);
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "@/lib/auth" && statement.importClause?.name) {
      issues.push(`${filePath} imports a default auth client; use import { auth } from "@/lib/auth"`);
    }
  }
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "auth" &&
      node.expression.name.text === "signInWithProvider") {
      issues.push(`${filePath} calls unsupported auth.signInWithProvider(); use auth.signIn(email, password) and an email/password form`);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "auth" &&
      node.expression.name.text === "onAuthStateChange") {
      const callback = node.arguments[0];
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && callback.parameters.length === 1 &&
        ts.isIdentifier(callback.parameters[0].name)) {
        const parameter = callback.parameters[0].name.text;
        const inspect = (child: ts.Node) => {
          if (ts.isPropertyAccessExpression(child) && child.name.text === "session" &&
            ts.isIdentifier(child.expression) && child.expression.text === parameter) {
            issues.push(`${filePath} reads .session from the one-argument auth.onAuthStateChange callback; its argument is Session | null directly`);
          }
          ts.forEachChild(child, inspect);
        };
        inspect(callback.body);
      }
    }
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

function generatedUiImportIssues(filePath: string, content: string): string[] {
  if (!/\.(?:tsx?|jsx?)$/.test(filePath)) return [];
  const sourceFile = sourceFileFor(filePath, content);
  const issues: string[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
      !/^@\/components\/ui(?:\/|$)/.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      issues.push(`${filePath} imports ${bindings.name.text} as a UI namespace; import the supported named components instead (for example { Button }, { Dialog, DialogContent }, { Input }, { Label }, { Card })`);
    }
  }
  return issues;
}

function generatedDbListOptionIssues(filePath: string, content: string): string[] {
  if (!/\.(?:tsx?|jsx?)$/.test(filePath)) return [];
  const unsupported = managedDatabaseCalls(filePath, content).unsupportedListOptions;
  return unsupported.length > 0
    ? [`${filePath} passes unsupported ${unsupported.join(", ")} option(s) to collection.list(); only limit and offset exist; load authorized records and filter/sort in the view`]
    : [];
}

const UNSUPPORTED_DIRECT_DATABASE_METHODS = new Set([
  "list", "get", "create", "update", "remove", "putMany", "query", "insert", "delete",
]);

function managedDatabaseCalls(filePath: string, content: string): { unsupported: boolean; collection: boolean; unsupportedListOptions: string[] } {
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
  const collectionBindings = new Set<ts.Symbol>();
  const addBinding = (identifier: ts.Identifier | undefined, target = bindings) => {
    const symbol = identifier && checker.getSymbolAtLocation(identifier);
    if (symbol) target.add(symbol);
  };

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !resolvesLocalRuntimeModule(filePath, statement.moduleSpecifier.text, "db")
    ) continue;
    const clause = statement.importClause;
    addBinding(clause?.name);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if ((element.propertyName?.text || element.name.text) === "db") addBinding(element.name);
        if ((element.propertyName?.text || element.name.text) === "collection") addBinding(element.name, collectionBindings);
      }
    }
  }
  if (bindings.size === 0 && collectionBindings.size === 0) return { unsupported: false, collection: false, unsupportedListOptions: [] };

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
        const target = sourceSymbol && (bindings.has(sourceSymbol) ? bindings : collectionBindings.has(sourceSymbol) ? collectionBindings : null);
        if (target && aliasSymbol && !target.has(aliasSymbol)) {
          target.add(aliasSymbol);
          addedAlias = true;
        }
      }
      ts.forEachChild(node, visitAliases);
    };
    visitAliases(sourceFile);
  }

  const isManagedCollectionFactory = (expression: ts.Expression): boolean => {
    if (!ts.isCallExpression(expression)) return false;
    if (ts.isPropertyAccessExpression(expression.expression) && expression.expression.name.text === "collection" &&
      ts.isIdentifier(expression.expression.expression)) {
      const receiver = checker.getSymbolAtLocation(expression.expression.expression);
      return Boolean(receiver && bindings.has(receiver));
    }
    if (ts.isIdentifier(expression.expression)) {
      const callee = checker.getSymbolAtLocation(expression.expression);
      return Boolean(callee && collectionBindings.has(callee));
    }
    return false;
  };
  const collectionValues = new Set<ts.Symbol>();
  let foundCollectionAlias = true;
  while (foundCollectionAlias) {
    foundCollectionAlias = false;
    const visitCollectionAliases = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const value = node.initializer;
        const valueSymbol = ts.isIdentifier(value) ? checker.getSymbolAtLocation(value) : undefined;
        if (isManagedCollectionFactory(value) || (valueSymbol && collectionValues.has(valueSymbol))) {
          const aliasSymbol = checker.getSymbolAtLocation(node.name);
          if (aliasSymbol && !collectionValues.has(aliasSymbol)) {
            collectionValues.add(aliasSymbol);
            foundCollectionAlias = true;
          }
        }
      }
      ts.forEachChild(node, visitCollectionAliases);
    };
    visitCollectionAliases(sourceFile);
  }

  let unsupported = false;
  let collection = false;
  const unsupportedListOptions = new Set<string>();
  const visitCalls = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "list" &&
        node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
        const receiver = node.expression.expression;
        const receiverSymbol = ts.isIdentifier(receiver) ? checker.getSymbolAtLocation(receiver) : undefined;
        if (isManagedCollectionFactory(receiver) || (receiverSymbol && collectionValues.has(receiverSymbol))) {
          for (const property of node.arguments[0].properties) {
            if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
            const name = property.name;
            if ((ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text !== "limit" && name.text !== "offset") {
              unsupportedListOptions.add(name.text);
            }
          }
        }
      }
      if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
        const symbol = checker.getSymbolAtLocation(node.expression.expression);
        if (symbol && bindings.has(symbol)) {
          if (UNSUPPORTED_DIRECT_DATABASE_METHODS.has(node.expression.name.text)) unsupported = true;
          if (node.expression.name.text === "collection" || node.expression.name.text === "from") collection = true;
        }
      } else if (ts.isIdentifier(node.expression)) {
        const symbol = checker.getSymbolAtLocation(node.expression);
        if (symbol && collectionBindings.has(symbol)) collection = true;
      }
    }
    ts.forEachChild(node, visitCalls);
  };
  visitCalls(sourceFile);
  return { unsupported, collection, unsupportedListOptions: [...unsupportedListOptions] };
}

function hasUnsupportedDirectDatabaseCall(filePath: string, content: string): boolean {
  return managedDatabaseCalls(filePath, content).unsupported;
}

function hasManagedCollectionCall(filePath: string, content: string): boolean {
  if (!/\.[cm]?[jt]sx?$/.test(filePath)) return false;
  return managedDatabaseCalls(filePath, content).collection;
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
    /** Requested account flows must use the supported, server-verified identity client. */
    requireAuthentication?: boolean;
    /** Commerce management controls must use the server-reported owner role. */
    requireCommerceRole?: boolean;
    /** Existing source is security-scanned so a narrow edit cannot preserve a critical violation. */
    existingSources?: GeneratedSourceFile[];
    /** Business records requested by the user must survive a refresh. */
    requirePersistence?: boolean;
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
  const sourceSecurityIssues = (filePath: string, content: string): string[] =>
    content.split(/\r?\n/).flatMap((line, index) =>
      scanGeneratedSourceLine(filePath, line).map((finding) =>
        `${filePath}:${index + 1} ${finding.severity.toLowerCase()} security issue: ${finding.finding}`
      )
    );

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
      /(?:^|\/)(?:seeds?|fixtures?)(?:\/|(?:[-_.](?:data|products?|inventory|orders?|customers?|users?|records?|catalog(?:ue)?|items?))?\.(?:[cm]?[jt]sx?|json)$)/i.test(file.path)
    ) {
      issues.push(`${file.path} adds seed or fixture data without an explicit user request for demo/seed data`);
    }
    if (options.allowSeedData !== true && containsInlineSeedRecords(file.path, file.content)) {
      issues.push(`${file.path} adds inline seed records without an explicit user request for demo/seed data`);
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
    issues.push(...sourceSecurityIssues(file.path, file.content));
    issues.push(...generatedAuthContractIssues(file.path, file.content));
    issues.push(...generatedUiImportIssues(file.path, file.content));
    issues.push(...generatedDbListOptionIssues(file.path, file.content));
    if (/\.(?:tsx?|jsx?)$/.test(file.path)) {
      const syntaxIssue = sourceSyntaxIssue(file.path, file.content);
      if (syntaxIssue) issues.push(`syntax error in ${file.path}: ${syntaxIssue}`);
      const nonCodeIssue = nonCodeComponentIssue(file.path, file.content);
      if (nonCodeIssue) issues.push(nonCodeIssue);
      if (importSpecifiers(file.path, file.content).some((specifier) => specifier === "recharts" || specifier.startsWith("recharts/"))) {
        issues.push(`${file.path} imports recharts, whose module graph exceeds production sandbox capacity; use lightweight CSS or inline SVG charts`);
      }
      if (hasUnsupportedDirectDatabaseCall(file.path, file.content)) {
        issues.push(`${file.path} invents a database method; use db.collection(name).list/get/create/update/remove`);
      }
    }
  }

  for (const existing of options.existingSources || []) {
    const existingPath = normalizeGeneratedPath(existing.path);
    if (generatedPaths.has(existingPath)) continue;
    issues.push(...generatedSecurityIssues(existingPath, existing.content));
    issues.push(...sourceSecurityIssues(existingPath, existing.content));
  }

  const effectiveSources = [...normalizedFiles, ...(options.existingSources || []).filter((file) => !generatedPaths.has(normalizeGeneratedPath(file.path)))];
  const modelSources = effectiveSources.filter((file) => !isRuntimeOwnedGeneratedPath(file.path, file.content));
  if (options.requireEntrypointFirst && !modelSources.some((file) =>
    /\.(?:tsx|jsx)$/.test(file.path) && (
      jsxOpeningTags(file.content, "main").length > 0 ||
      /<(?:DashboardShell|MarketingShell|EditorialShell|FocusShell)(?:\s|>)/.test(file.content)
    )
  )) {
    issues.push("generated app has no main landmark; wrap the primary page content in <main> or use a supplied layout shell");
  }
  if (options.requireAuthentication) {
    if (!modelSources.some((file) => importsAuthentication(file.path, file.content) && /\bauth\.(?:getSession|onAuthStateChange|signIn|signUp)\s*\(/.test(file.content))) {
      issues.push("requested authentication has no real identity client usage; import auth from @/lib/auth and implement signup, signin, session loading, and logout");
    }
    if (!modelSources.some((file) => importsAuthentication(file.path, file.content) && /\bauth\.(?:signIn|signUp)\s*\(/.test(file.content))) {
      issues.push("requested authentication has no usable sign-in or sign-up action; call the supported auth client from an accessible account form");
    }
    if (!modelSources.some((file) => importsAuthentication(file.path, file.content) && /\bauth\.signOut\s*\(/.test(file.content))) {
      issues.push("requested authentication has no sign-out action; give signed-in users a working way to leave their account");
    }
  }
  if (options.requireCommerceRole) {
    if (!modelSources.some((file) => /\bauth\.(?:getCommerceRole|getProjectRole)\s*\(/.test(file.content))) {
      issues.push("commerce owner controls have no server-verified role; call auth.getProjectRole() and show management only to the returned owner");
    }
    if (!modelSources.some((file) => hasManagedCollectionCall(file.path, file.content) && /\bcollection(?:<[^>\n]+>)?\s*\(\s*["']carts["']/.test(file.content))) {
      issues.push("commerce cart has no durable carts collection; use db.collection(\"carts\") so guest and signed-in bags survive refresh");
    }
    for (const file of modelSources) {
      if (/\b(?:const|let)\s+(?:isOwner|ownerRole|isAdmin)\s*=\s*true\b|\b(?:const|let)\s*\[\s*(?:isOwner|ownerRole|isAdmin)\s*(?:,\s*[A-Za-z_$][\w$]*)?\s*\]\s*=\s*(?:React\.)?useState(?:<[^>\n]+>)?\s*\(\s*true\s*\)/.test(file.content)) {
        issues.push(`${file.path} hardcodes the owner role; derive it from auth.getProjectRole()`);
      }
    }
  }
  if (options.requirePersistence) {
    if (!modelSources.some((file) => hasManagedCollectionCall(file.path, file.content))) {
      issues.push("requested application data has no durable database collection; use the project-scoped @/lib/db client instead of component state or hardcoded rows");
    }
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

  const availablePaths = new Set([
    ...existingPathList,
    ...generatedPaths,
    ...[...STARTER_UI_COMPONENTS].map((name) => `src/components/ui/${name}.${name === "index" ? "ts" : "tsx"}`),
    ...["dashboard-shell", "marketing-shell", "storefront-shell", "editorial-shell", "focus-shell"]
      .map((name) => `src/components/layout/${name}.tsx`),
    "src/components/layout/index.ts",
    "src/lib/utils.ts",
    "src/lib/db.ts",
    "src/lib/auth.ts",
    "src/lib/auth-bridge.ts",
    "src/lib/files.ts",
  ]);
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
