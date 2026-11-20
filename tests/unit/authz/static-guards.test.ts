import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { actionKey, PUBLIC_ACTIONS } from './policy';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SRC = join(ROOT, 'src');
const ACTIONS_DIR = 'src/server/actions/';
const REQUIRE_ROLE_MODULE = 'src/server/auth/require-role';
const ACTION_RESULT_MODULE = 'src/server/action-result';

/** 라우트 파일에서 허용하는 설정 export(값 export) */
const ROUTE_SEGMENT_CONFIG = new Set(['dynamic', 'dynamicParams', 'revalidate', 'fetchCache', 'runtime', 'preferredRegion', 'maxDuration', 'metadata']);
/** 가드 없이 열어 둔 route handler(정확히 이 파일들만) */
const PUBLIC_ROUTES = new Set(['src/app/api/auth/[...nextauth]/route.ts', 'src/app/api/health/route.ts']);
/** requirePage 없이 열어 둔 page(로그인 화면, 리디렉션만 하는 루트) */
const PUBLIC_PAGES = new Set(['src/app/(auth)/login/page.tsx', 'src/app/page.tsx']);
/** 데이터 접근을 하면 안 되는 App Router 특수 파일 */
const NON_GUARDED_SPECIAL = /\/(layout|template|default|not-found|error|global-error|loading|forbidden|unauthorized)\.(ts|tsx|js|jsx)$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const rel = (p: string) => relative(ROOT, p).split(sep).join('/');

function parse(file: string) {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind) {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

/** 문장 목록 앞쪽의 지시문(prologue) 문자열들 */
function directives(statements: readonly ts.Statement[]): string[] {
  const out: string[] = [];
  for (const s of statements) {
    if (ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)) out.push(s.expression.text);
    else break;
  }
  return out;
}

/** 파일 수준과 함수 수준 'use server' 위치 */
function findUseServer(sf: ts.SourceFile): { fileLevel: boolean; inline: string[] } {
  const inline: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) &&
      node.body &&
      ts.isBlock(node.body) &&
      directives(node.body.statements).includes('use server')
    ) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      inline.push(`${line + 1}행`);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return { fileLevel: directives(sf.statements).includes('use server'), inline };
}

/** import 된 이름 → 모듈의 저장소 기준 경로(확장자 없음). 상대 경로와 '@/' 별칭을 풀어 준다. */
function importedFrom(sf: ts.SourceFile, file: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue;
    const spec = s.moduleSpecifier.text;
    const resolved = spec.startsWith('@/')
      ? `src/${spec.slice(2)}`
      : spec.startsWith('.')
        ? rel(resolve(dirname(file), spec))
        : spec;
    const named = s.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) map.set(el.name.text, resolved.replace(/\.(ts|tsx)$/, ''));
    }
  }
  return map;
}

/** 파일 안에서 이 이름을 직접 선언(함수·변수)했는지 — import 를 가리는 바꿔치기 탐지 */
function declaresLocally(sf: ts.SourceFile, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name && ts.isIdentifier(node.name) && node.name.text === name) {
      found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return found;
}

/** `[const x =] await <callee>(...)` 형태인지 */
function isAwaitCall(stmt: ts.Statement | undefined, callee: string): boolean {
  if (!stmt) return false;
  let expr: ts.Expression | undefined;
  if (ts.isExpressionStatement(stmt)) expr = stmt.expression;
  else if (ts.isVariableStatement(stmt) && stmt.declarationList.declarations.length === 1) {
    expr = stmt.declarationList.declarations[0].initializer;
  }
  return (
    !!expr &&
    ts.isAwaitExpression(expr) &&
    ts.isCallExpression(expr.expression) &&
    ts.isIdentifier(expr.expression.expression) &&
    expr.expression.expression.text === callee
  );
}

/** 함수 본문 첫 문장이 requireRole 이거나, `return toActionResult(async () => { requireRole... })` 인지 */
function startsWithRequireRole(body: ts.Block | undefined): boolean {
  const first = body?.statements[0];
  if (isAwaitCall(first, 'requireRole')) return true;
  if (first && ts.isReturnStatement(first) && first.expression && ts.isCallExpression(first.expression)) {
    const call = first.expression;
    const cb = call.arguments[0];
    if (
      ts.isIdentifier(call.expression) &&
      call.expression.text === 'toActionResult' &&
      cb &&
      (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) &&
      ts.isBlock(cb.body)
    ) {
      return isAwaitCall(cb.body.statements[0], 'requireRole');
    }
  }
  return false;
}

/** 'use server' 파일의 export 가 모두 `export async function` 인지 검사하고 함수 목록을 돌려준다. */
function serverExports(sf: ts.SourceFile): { functions: ts.FunctionDeclaration[]; violations: string[] } {
  const functions: ts.FunctionDeclaration[] = [];
  const violations: string[] = [];
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) {
      if (!hasModifier(stmt, ts.SyntaxKind.AsyncKeyword)) violations.push(`${stmt.name?.text}: async 가 아님`);
      if (hasModifier(stmt, ts.SyntaxKind.DefaultKeyword)) violations.push('default export 금지');
      functions.push(stmt);
    } else if (ts.isExportDeclaration(stmt) || ts.isExportAssignment(stmt)) {
      if (!(ts.isExportDeclaration(stmt) && stmt.isTypeOnly)) violations.push(`재수출·export= 금지: ${stmt.getText(sf).slice(0, 60)}`);
    } else if (hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) {
      const isTypeOnly = ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt);
      if (!isTypeOnly) violations.push(`함수가 아닌 export: ${stmt.getText(sf).slice(0, 60)}`);
    }
  }
  return { functions, violations };
}

/** page·route 의 export 중 허용되지 않은 것(설정 값 외의 값 export, 재수출) */
function extraExports(sf: ts.SourceFile, allowFunction: (fn: ts.FunctionDeclaration) => boolean): string[] {
  const problems: string[] = [];
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && hasModifier(s, ts.SyntaxKind.ExportKeyword)) {
      if (!allowFunction(s)) problems.push(`허용되지 않은 함수 export: ${s.name?.text ?? 'default'}`);
    } else if (ts.isVariableStatement(s) && hasModifier(s, ts.SyntaxKind.ExportKeyword)) {
      for (const d of s.declarationList.declarations) {
        const name = ts.isIdentifier(d.name) ? d.name.text : d.name.getText(sf);
        if (!ROUTE_SEGMENT_CONFIG.has(name)) problems.push(`허용되지 않은 값 export: ${name}`);
      }
    } else if (ts.isExportDeclaration(s) && !s.isTypeOnly) {
      problems.push(`재수출 금지: ${s.getText(sf).slice(0, 60)}`);
    } else if (ts.isExportAssignment(s)) {
      problems.push('export default <식> 금지(함수 선언으로)');
    }
  }
  return problems;
}

function requiresFrom(sf: ts.SourceFile, file: string, name: string, module: string): string[] {
  const from = importedFrom(sf, file).get(name);
  const problems: string[] = [];
  if (from !== module) problems.push(`${name} 을(를) ${module} 에서 import 하지 않음(${from ?? '없음'})`);
  if (declaresLocally(sf, name)) problems.push(`${name} 을(를) 파일 안에서 다시 선언함`);
  return problems;
}

const srcFiles = walk(SRC).filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f));
const actionFiles = srcFiles.filter((f) => rel(f).startsWith(ACTIONS_DIR));

describe('정적 권한 검사', () => {
  it("'use server' 는 src/server/actions/ 의 .ts·.tsx 파일 첫 줄에만 있다(인라인 액션 금지)", () => {
    const problems: string[] = [];
    for (const file of srcFiles) {
      const { fileLevel, inline } = findUseServer(parse(file));
      const inActions = rel(file).startsWith(ACTIONS_DIR) && /\.(ts|tsx)$/.test(file);
      if (fileLevel && !inActions) problems.push(`${rel(file)}: actions 폴더 밖의 'use server' 파일`);
      for (const at of inline) problems.push(`${rel(file)}:${at}: 함수 안의 'use server'`);
    }
    for (const file of actionFiles) {
      if (!findUseServer(parse(file)).fileLevel) problems.push(`${rel(file)}: 'use server' 가 첫 줄이 아님`);
    }
    expect(problems).toEqual([]);
  });

  it('Server Action 은 PUBLIC 예외를 빼고 첫 문장에서 require-role 의 requireRole 을 호출한다', () => {
    expect(actionFiles.length).toBeGreaterThan(0);
    const problems: string[] = [];
    const seenPublic: string[] = [];
    for (const file of actionFiles) {
      const sf = parse(file);
      const { functions, violations } = serverExports(sf);
      problems.push(...violations.map((v) => `${rel(file)}: ${v}`));
      const guarded = functions.filter((fn) => {
        const key = actionKey(rel(file).slice(ACTIONS_DIR.length), fn.name!.text);
        if (PUBLIC_ACTIONS.includes(key)) {
          seenPublic.push(key);
          return false;
        }
        if (!startsWithRequireRole(fn.body)) problems.push(`${rel(file)}: ${fn.name?.text} 첫 문장이 requireRole 이 아님`);
        return true;
      });
      if (guarded.length) {
        problems.push(...requiresFrom(sf, file, 'requireRole', REQUIRE_ROLE_MODULE).map((p) => `${rel(file)}: ${p}`));
        const usesWrapper = guarded.some((fn) => fn.body?.statements[0] && ts.isReturnStatement(fn.body.statements[0]));
        if (usesWrapper) {
          problems.push(...requiresFrom(sf, file, 'toActionResult', ACTION_RESULT_MODULE).map((p) => `${rel(file)}: ${p}`));
        }
      }
    }
    expect(problems).toEqual([]);
    expect(seenPublic.sort()).toEqual([...PUBLIC_ACTIONS].sort());
  });

  it('page 는 첫 문장에서 requirePage 를 호출하고, default 외 함수·값 export 가 없다', () => {
    const pages = srcFiles.filter((f) => /\/page\.(ts|tsx|js|jsx)$/.test(rel(f)));
    expect(pages.length).toBeGreaterThan(0);
    const problems: string[] = [];
    for (const file of pages) {
      const sf = parse(file);
      const isDefault = (fn: ts.FunctionDeclaration) => hasModifier(fn, ts.SyntaxKind.DefaultKeyword);
      problems.push(...extraExports(sf, isDefault).map((p) => `${rel(file)}: ${p}`));
      if (PUBLIC_PAGES.has(rel(file))) continue;
      const fn = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && isDefault(s));
      if (!fn || !isAwaitCall(fn.body?.statements[0], 'requirePage')) problems.push(`${rel(file)}: 첫 문장이 requirePage 가 아님`);
      problems.push(...requiresFrom(sf, file, 'requirePage', REQUIRE_ROLE_MODULE).map((p) => `${rel(file)}: ${p}`));
    }
    expect(problems).toEqual([]);
  });

  it('layout·template·not-found 등 가드 없는 특수 파일은 DB·서비스를 import 하지 않는다', () => {
    const problems: string[] = [];
    for (const file of srcFiles.filter((f) => NON_GUARDED_SPECIAL.test(rel(f)))) {
      for (const mod of new Set(importedFrom(parse(file), file).values())) {
        if (/^src\/server\/(db|services)(\/|$)/.test(mod)) problems.push(`${rel(file)}: ${mod}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('공개 2개를 뺀 route handler 는 모든 handler 첫 문장에서 requireApi 를 호출한다', () => {
    const routes = srcFiles.filter((f) => /\/route\.(ts|tsx|js|jsx|mjs)$/.test(rel(f)));
    const problems: string[] = [];
    for (const file of routes) {
      const sf = parse(file);
      if (PUBLIC_ROUTES.has(rel(file))) continue;
      const handlers = sf.statements.filter(
        (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && hasModifier(s, ts.SyntaxKind.ExportKeyword),
      );
      problems.push(...extraExports(sf, () => true).map((p) => `${rel(file)}: ${p}`));
      for (const fn of handlers) {
        if (!isAwaitCall(fn.body?.statements[0], 'requireApi')) problems.push(`${rel(file)}: ${fn.name?.text} 첫 문장이 requireApi 가 아님`);
      }
      if (handlers.length) problems.push(...requiresFrom(sf, file, 'requireApi', REQUIRE_ROLE_MODULE).map((p) => `${rel(file)}: ${p}`));
    }
    expect(problems).toEqual([]);
    // 공개 route 로 지정한 파일은 실제로 있어야 한다(이름만 남은 예외 금지)
    for (const p of PUBLIC_ROUTES) expect(routes.map(rel)).toContain(p);
  });
});
