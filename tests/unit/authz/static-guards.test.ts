import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { PAGE_POLICY } from './page-policy';
import { actionKey, PUBLIC_ACTIONS } from './policy';
import { ROUTE_POLICY, routeKey } from './route-policy';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SRC = join(ROOT, 'src');
const ACTIONS_DIR = 'src/server/actions/';
const REQUIRE_ROLE_MODULE = 'src/server/auth/require-role';
const ACTION_RESULT_MODULE = 'src/server/action-result';
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * 저장소 전체 검색에서 빼는 **최상위** 폴더(생성물·의존성·데이터). 저장소 루트 바로 아래에서만 건너뛰고,
 * 그보다 깊은 곳(예: src/app/admin/data/)은 이름과 무관하게 모두 검사한다.
 */
const SKIP_TOP_DIRS = new Set(['node_modules', '.next', '.git', 'coverage', 'test-results', 'playwright-report', 'blob-report', 'dist', 'out', 'data', 'backups']);
/** 라우트 파일에서 허용하는 설정 export(값 export) */
const ROUTE_SEGMENT_CONFIG = new Set(['dynamic', 'dynamicParams', 'revalidate', 'fetchCache', 'runtime', 'preferredRegion', 'maxDuration', 'metadata']);
const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
/** 가드 없이 열어 둔 route handler(정확히 이 파일들만) */
const PUBLIC_ROUTES = new Set(['src/app/api/auth/[...nextauth]/route.ts', 'src/app/api/health/route.ts']);
/** requirePage 없이 열어 둔 page(로그인 화면, 리디렉션만 하는 루트, 구글 동의 화면용 소개·개인정보처리방침) */
const PUBLIC_PAGES = new Set([
  'src/app/(auth)/login/page.tsx',
  'src/app/page.tsx',
  'src/app/(public)/about/page.tsx',
  'src/app/(public)/privacy/page.tsx',
]);
/** 데이터 접근을 하면 안 되는 App Router 특수 파일(파일 이름) */
const NON_GUARDED_SPECIAL = /\/(layout|template|default|not-found|error|global-error|loading|forbidden|unauthorized)\.(ts|tsx|js|jsx|mjs)$/;
/** 가드를 붙일 수 없는 메타데이터 라우트 — 필요해지면 그때 규칙을 만든다 */
const METADATA_ROUTE = /\/(opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\d*\.(ts|tsx|js|jsx|mjs)$/;
/** 데이터 접근 모듈(Prisma 클라이언트를 직접 만드는 것 포함) */
const DATA_MODULE = /^(src\/server\/(db|services)(\/|$)|@prisma\/client(\/|$)|\.prisma\/client(\/|$))/;

/** src/app 아래의 라우팅 대상 파일인지(`_` 로 시작하는 private 폴더는 라우팅되지 않으므로 제외) */
function isAppRoutingFile(relPath: string): boolean {
  return relPath.startsWith('src/app/') && !relPath.split('/').some((seg) => seg.startsWith('_'));
}
const isSpecialFile = (r: string) => isAppRoutingFile(r) && NON_GUARDED_SPECIAL.test(r);
const isMetadataRoute = (r: string) => isAppRoutingFile(r) && METADATA_ROUTE.test(r);
/**
 * 특수 파일이 전이적으로 import 해도 되는 모듈(여기서 추적을 멈춘다). 최소로 유지한다.
 * - current-user: 상단바의 로그인 사용자 표시(세션 판정만, 데이터 조회 없음)
 * - actions/auth: 상단바 로그아웃 버튼(Server Action 은 자체 정적·동적 정책 검사를 받는다)
 * - require-role: layout 의 방어용 가드
 */
const LAYOUT_IMPORT_ALLOW = new Set([
  'src/server/auth/current-user.ts',
  'src/server/actions/auth.ts',
  // layout 에 방어용 requirePage 를 두는 것은 허용(가드 자체는 세션만 본다)
  'src/server/auth/require-role.ts',
]);

function walk(dir: string, skipHere = new Set<string>()): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (skipHere.has(name)) return [];
    const p = join(dir, name);
    // 하위 폴더에는 건너뛰기 목록을 넘기지 않는다(최상위에서만 적용).
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const rel = (p: string) => relative(ROOT, p).split(sep).join('/');

const parsed = new Map<string, ts.SourceFile>();
function parse(file: string) {
  let sf = parsed.get(file);
  if (!sf) {
    sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    parsed.set(file, sf);
  }
  return sf;
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

/** import 지정자를 저장소 기준 경로로. 파일이 있으면 그 파일 경로, 외부 패키지면 지정자 그대로. */
function resolveSpecifier(spec: string, fromFile: string): { module: string; file: string | null } {
  let base: string | null = null;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  if (!base) return { module: spec, file: null };
  const candidates = [base, ...RESOLVE_EXTS.map((e) => base + e), ...RESOLVE_EXTS.map((e) => join(base!, 'index' + e))];
  const found = candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
  return { module: rel(found ?? base).replace(CODE_EXT, '').replace(/\/index$/, ''), file: found };
}

type ImportRecord = {
  module: string;
  file: string | null;
  kind: 'named' | 'default' | 'namespace' | 'side-effect' | 're-export' | 'dynamic';
  local?: string;
  imported?: string;
  typeOnly: boolean;
};

/** 모든 import·`export … from` 을 종류와 함께 기록한다. */
function collectImports(sf: ts.SourceFile, file: string): ImportRecord[] {
  const out: ImportRecord[] = [];
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier)) {
      const target = resolveSpecifier(s.moduleSpecifier.text, file);
      const clause = s.importClause;
      if (!clause) {
        out.push({ ...target, kind: 'side-effect', typeOnly: false });
        continue;
      }
      if (clause.name) out.push({ ...target, kind: 'default', local: clause.name.text, imported: 'default', typeOnly: clause.isTypeOnly });
      const nb = clause.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) out.push({ ...target, kind: 'namespace', local: nb.name.text, typeOnly: clause.isTypeOnly });
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) {
          out.push({
            ...target,
            kind: 'named',
            local: el.name.text,
            imported: (el.propertyName ?? el.name).text,
            typeOnly: clause.isTypeOnly || el.isTypeOnly,
          });
        }
      }
    } else if (ts.isExportDeclaration(s) && s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier)) {
      out.push({ ...resolveSpecifier(s.moduleSpecifier.text, file), kind: 're-export', typeOnly: s.isTypeOnly });
    }
  }
  // 동적 import('…')·require('…') 도 의존으로 본다(문자열 리터럴 인자만; 그 외 형태는 아래 검사에서 금지).
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const arg = node.arguments[0];
      if ((isDynamicImport || isRequire) && ts.isStringLiteralLike(arg)) {
        out.push({ ...resolveSpecifier(arg.text, file), kind: 'dynamic', typeOnly: false });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

/** 문자열 리터럴이 아닌 인자로 import()·require() 를 부르면(추적 불가) 그 위치 */
function untraceableDynamicImports(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isDynamicImport || isRequire) && !(node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]))) {
        out.push(`${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}행`);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

/** src 안 import 그래프를 따라가 데이터 모듈에 닿는 경로(없으면 null). 허용 목록에서는 멈춘다. */
function pathToDataModule(file: string, seen = new Set<string>()): string[] | null {
  if (seen.has(file)) return null;
  seen.add(file);
  for (const imp of collectImports(parse(file), file)) {
    if (imp.typeOnly) continue;
    if (DATA_MODULE.test(imp.module)) return [rel(file), imp.module];
    if (!imp.file || !rel(imp.file).startsWith('src/') || LAYOUT_IMPORT_ALLOW.has(rel(imp.file))) continue;
    const rest = pathToDataModule(imp.file, seen);
    if (rest) return [rel(file), ...rest];
  }
  return null;
}

/** 파일 안에서 이 이름을 직접 선언(함수·변수·매개변수)했는지 — import 를 가리는 바꿔치기 탐지 */
function declaresLocally(sf: ts.SourceFile, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
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

/** page 의 export 중 허용되지 않은 것(default 외 함수, 설정 값 외 값 export, 재수출) */
function pageExtraExports(sf: ts.SourceFile): string[] {
  const problems: string[] = [];
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && hasModifier(s, ts.SyntaxKind.ExportKeyword)) {
      if (!hasModifier(s, ts.SyntaxKind.DefaultKeyword)) problems.push(`허용되지 않은 함수 export: ${s.name?.text}`);
    } else if (ts.isVariableStatement(s) && hasModifier(s, ts.SyntaxKind.ExportKeyword)) {
      for (const d of s.declarationList.declarations) {
        const name = ts.isIdentifier(d.name) ? d.name.text : d.name.getText(sf);
        if (!ROUTE_SEGMENT_CONFIG.has(name)) problems.push(`허용되지 않은 값 export: ${name}`);
      }
    } else if (ts.isExportDeclaration(s) && !s.isTypeOnly) {
      problems.push(`재수출 금지: ${s.getText(sf).slice(0, 60)}`);
    } else if (ts.isExportAssignment(s)) {
      problems.push('`export default Page;` 같은 식 export 금지 — `export default async function Page() { await requirePage(...) }` 형태만 허용');
    }
  }
  return problems;
}

/**
 * route handler 형태 검사: HTTP 메서드는 `export const GET = withApi(...)` 로만. 함수 선언 export·재수출 금지.
 * withApi 가 권한 검사를 통과해야만 handler 를 부르므로 검사 결과를 버리는 코드가 생길 수 없다.
 */
function routeProblems(sf: ts.SourceFile, routeRel: string): string[] {
  const problems: string[] = [];
  const exportedMethods: string[] = [];
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && hasModifier(s, ts.SyntaxKind.ExportKeyword)) {
      problems.push(`함수 선언 export 금지(withApi 로 감싸기): ${s.name?.text ?? 'default'}`);
    } else if (ts.isVariableStatement(s) && hasModifier(s, ts.SyntaxKind.ExportKeyword)) {
      // let·var 로 export 하면 나중에 다른 함수로 바꿔 끼울 수 있으므로 const 만 허용
      if (!(s.declarationList.flags & ts.NodeFlags.Const)) problems.push(`export 는 const 만: ${s.getText(sf).slice(0, 40)}`);
      for (const d of s.declarationList.declarations) {
        const name = ts.isIdentifier(d.name) ? d.name.text : d.name.getText(sf);
        if (ROUTE_SEGMENT_CONFIG.has(name)) continue;
        if (!HTTP_METHODS.has(name)) {
          problems.push(`허용되지 않은 값 export: ${name}`);
          continue;
        }
        const init = d.initializer;
        const wrapped = !!init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'withApi';
        if (!wrapped) {
          problems.push(`${name} 은 withApi(...) 호출 결과여야 함`);
          continue;
        }
        exportedMethods.push(name);
        // H9: 첫 인자는 역할 문자열 리터럴이고, 정책 표의 기대 역할과 같아야 한다.
        const roleArg = init.arguments[0];
        const key = routeKey(routeRel, name);
        if (!roleArg || !ts.isStringLiteral(roleArg)) problems.push(`${name}: withApi 첫 인자는 역할 문자열 리터럴이어야 함`);
        else if (ROUTE_POLICY[key] !== roleArg.text) {
          problems.push(`${name}: 정책 표(route-policy.ts)의 ${key} = ${ROUTE_POLICY[key] ?? '없음'} 과 withApi('${roleArg.text}') 가 다름`);
        }
      }
    } else if (ts.isExportDeclaration(s) && !s.isTypeOnly) {
      problems.push(`재수출 금지: ${s.getText(sf).slice(0, 60)}`);
    } else if (ts.isExportAssignment(s)) {
      problems.push('export default 금지');
    }
  }
  // export 한 메서드 이름에 다시 대입하는 코드 금지(const 라 컴파일 오류지만 JS 파일까지 막는다)
  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      ts.isIdentifier(node.left) &&
      (HTTP_METHODS.has(node.left.text) || exportedMethods.includes(node.left.text))
    ) {
      problems.push(`${node.left.text} 에 다시 대입 금지`);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return problems;
}

/**
 * H6: page·route 의 최상위 문장은 import·선언·export 만. 모듈을 불러오는 순간(가드보다 먼저) 실행되는
 * 최상위 await·표현식 문장(부수효과)을 막는다. 파일 맨 앞 지시문('use client' 등)은 허용.
 */
const TOP_LEVEL_ALLOWED = new Set([
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.ExportDeclaration,
  ts.SyntaxKind.ExportAssignment,
]);
function topLevelProblems(sf: ts.SourceFile): string[] {
  const problems: string[] = [];
  const prologue = directives(sf.statements).length;
  sf.statements.forEach((s, i) => {
    if (i < prologue) return;
    if (!TOP_LEVEL_ALLOWED.has(s.kind)) problems.push(`최상위 문장 금지(${ts.SyntaxKind[s.kind]}): ${s.getText(sf).slice(0, 50)}`);
  });
  // 함수 밖(모듈 평가 시점)의 await·즉시 실행 함수(IIFE) 금지, class static 블록은 어디서든 금지
  const line = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const visit = (node: ts.Node) => {
    if (ts.isClassStaticBlockDeclaration(node)) {
      problems.push(`class static 블록 금지: ${line(node)}행`);
      return;
    }
    if (ts.isFunctionLike(node)) return;
    if (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier)) {
      problems.push(`최상위 await 금지: ${line(node)}행`);
    }
    if ((ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node)) && isInlineFunction(calleeOf(node))) {
      problems.push(`최상위 즉시 실행 함수(IIFE) 금지: ${line(node)}행`);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  // static 블록은 함수 안의 class 에 있어도 찾는다(위 순회는 함수 안으로 들어가지 않는다).
  const visitStatic = (node: ts.Node) => {
    if (ts.isClassStaticBlockDeclaration(node) && !problems.includes(`class static 블록 금지: ${line(node)}행`)) {
      problems.push(`class static 블록 금지: ${line(node)}행`);
    }
    ts.forEachChild(node, visitStatic);
  };
  ts.forEachChild(sf, visitStatic);
  return problems;
}

function calleeOf(node: ts.CallExpression | ts.NewExpression | ts.TaggedTemplateExpression): ts.Expression {
  return ts.isTaggedTemplateExpression(node) ? node.tag : node.expression;
}

/** 괄호·`void`·`!` 같은 단항·쉼표 식을 벗겨 낸 뒤 함수·화살표·class 식인지(`(() => {})()`, `(0, function(){})()`, `new (class {})()`) */
function isInlineFunction(expr: ts.Expression): boolean {
  let e: ts.Expression = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
    else if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.CommaToken) e = e.right;
    else if (ts.isPropertyAccessExpression(e) && ['call', 'apply', 'bind'].includes(e.name.text)) e = e.expression;
    else break;
  }
  return ts.isFunctionExpression(e) || ts.isArrowFunction(e) || ts.isClassExpression(e);
}

/** page 첫 문장의 requirePage(역할, 옵션) 인자가 PAGE_POLICY 와 같은지 */
function pagePolicyProblems(fn: ts.FunctionDeclaration, pageRel: string): string[] {
  const policy = PAGE_POLICY[pageRel];
  if (!policy) return [`정책 표(page-policy.ts)에 없음`];
  const first = fn.body?.statements[0];
  let expr: ts.Expression | undefined;
  if (first && ts.isExpressionStatement(first)) expr = first.expression;
  else if (first && ts.isVariableStatement(first)) expr = first.declarationList.declarations[0]?.initializer;
  const call = expr && ts.isAwaitExpression(expr) && ts.isCallExpression(expr.expression) ? expr.expression : null;
  if (!call) return ['requirePage 호출을 찾지 못함'];
  const [role, opts, ...rest] = call.arguments;
  const problems: string[] = [];
  if (!role || !ts.isStringLiteral(role)) problems.push('requirePage 첫 인자는 역할 문자열 리터럴이어야 함');
  else if (role.text !== policy.min) problems.push(`정책 표의 ${policy.min} 과 requirePage('${role.text}') 가 다름`);
  if (rest.length) problems.push('requirePage 인자는 2개까지');
  if (policy.allowPasswordChange) {
    const ok =
      !!opts &&
      ts.isObjectLiteralExpression(opts) &&
      opts.properties.length === 1 &&
      ts.isPropertyAssignment(opts.properties[0]) &&
      opts.properties[0].name.getText() === 'allowPasswordChange' &&
      opts.properties[0].initializer.kind === ts.SyntaxKind.TrueKeyword;
    if (!ok) problems.push('정책 표대로 { allowPasswordChange: true } 리터럴이어야 함');
  } else if (opts) {
    problems.push('정책 표에 없는 requirePage 옵션');
  }
  return problems;
}

/** name 이 정해진 모듈에서 **같은 이름으로**(별칭 없이) import 됐고, 파일 안에서 다시 선언되지 않았는지 */
function requiresFrom(sf: ts.SourceFile, file: string, name: string, module: string): string[] {
  const problems: string[] = [];
  const imps = collectImports(sf, file).filter((i) => i.local === name);
  const ok = imps.length === 1 && imps[0].kind === 'named' && imps[0].imported === name && imps[0].module === module && !imps[0].typeOnly;
  if (!ok) {
    const got = imps.map((i) => `${i.module}#${i.imported ?? i.kind}`).join(', ') || '없음';
    problems.push(`${name} 을(를) ${module} 에서 같은 이름으로 import 하지 않음(${got})`);
  }
  if (declaresLocally(sf, name)) problems.push(`${name} 을(를) 파일 안에서 다시 선언함`);
  return problems;
}

const repoFiles = walk(ROOT, SKIP_TOP_DIRS).filter((f) => CODE_EXT.test(f));
const srcFiles = repoFiles.filter((f) => rel(f).startsWith('src/'));
const actionFiles = srcFiles.filter((f) => rel(f).startsWith(ACTIONS_DIR));

describe('정적 권한 검사', () => {
  it("'use server' 는 저장소 전체에서 src/server/actions/ 의 .ts·.tsx 파일 첫 줄에만 있다(인라인 액션 금지)", () => {
    const problems: string[] = [];
    for (const file of repoFiles) {
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

  it('Pages Router·루트 app 폴더처럼 가드 규칙 밖의 라우팅 진입점이 없다', () => {
    // 루트에 app/·pages/ 가 있으면 Next 는 src/ 를 무시하고, src/pages 는 App Router 와 별도로 라우팅된다.
    for (const dir of ['pages', 'app', 'src/pages']) expect(existsSync(join(ROOT, dir)), dir).toBe(false);
  });

  it('메타데이터 라우트(opengraph-image·icon·sitemap·robots·manifest 등) 코드 파일을 두지 않는다', () => {
    const found = srcFiles.filter((f) => isMetadataRoute(rel(f))).map(rel);
    expect(found).toEqual([]);
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
    const pages = srcFiles.filter((f) => /\/page\.(ts|tsx|js|jsx|mjs)$/.test(rel(f)));
    expect(pages.length).toBeGreaterThan(0);
    const problems: string[] = [];
    for (const file of pages) {
      const sf = parse(file);
      problems.push(...pageExtraExports(sf).map((p) => `${rel(file)}: ${p}`));
      problems.push(...topLevelProblems(sf).map((p) => `${rel(file)}: ${p}`));
      if (PUBLIC_PAGES.has(rel(file))) continue;
      const fn = sf.statements.find(
        (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && hasModifier(s, ts.SyntaxKind.DefaultKeyword),
      );
      if (!fn || !isAwaitCall(fn.body?.statements[0], 'requirePage')) problems.push(`${rel(file)}: 첫 문장이 requirePage 가 아님`);
      else problems.push(...pagePolicyProblems(fn, rel(file)).map((p) => `${rel(file)}: ${p}`));
      problems.push(...requiresFrom(sf, file, 'requirePage', REQUIRE_ROLE_MODULE).map((p) => `${rel(file)}: ${p}`));
    }
    expect(problems).toEqual([]);
    // 정책 표에만 있고 실제 page 가 없는 항목 금지(이름만 남은 정책), 공개 page 를 표에 넣지 않는다
    const pageRels = new Set(pages.map(rel));
    expect(Object.keys(PAGE_POLICY).filter((k) => !pageRels.has(k) || PUBLIC_PAGES.has(k))).toEqual([]);
  });

  it('layout·template·not-found 등 가드 없는 특수 파일은 DB·서비스에 직접·간접으로 닿지 않는다', () => {
    const targets = srcFiles.filter((f) => isSpecialFile(rel(f)) || isMetadataRoute(rel(f)));
    expect(targets.length).toBeGreaterThan(0);
    const problems = targets
      .map((f) => pathToDataModule(f))
      .filter((p): p is string[] => p !== null)
      .map((p) => p.join(' → '));
    for (const f of targets) {
      for (const at of untraceableDynamicImports(parse(f))) problems.push(`${rel(f)}:${at}: 추적할 수 없는 동적 import/require`);
    }
    expect(problems).toEqual([]);
  });

  it('공개 2개를 뺀 route handler 는 모든 HTTP 메서드를 withApi(...) 로만 export 한다', () => {
    const routes = srcFiles.filter((f) => /\/route\.(ts|tsx|js|jsx|mjs)$/.test(rel(f)));
    const problems: string[] = [];
    for (const file of routes) {
      if (PUBLIC_ROUTES.has(rel(file))) continue;
      const sf = parse(file);
      problems.push(...routeProblems(sf, rel(file)).map((p) => `${rel(file)}: ${p}`));
      problems.push(...topLevelProblems(sf).map((p) => `${rel(file)}: ${p}`));
      problems.push(...requiresFrom(sf, file, 'withApi', REQUIRE_ROLE_MODULE).map((p) => `${rel(file)}: ${p}`));
    }
    expect(problems).toEqual([]);
    // 정책 표에만 있고 실제 export 가 없는 항목 금지(이름만 남은 정책)
    const exported = new Set(
      routes
        .filter((f) => !PUBLIC_ROUTES.has(rel(f)))
        .flatMap((f) =>
          parse(f)
            .statements.filter((st): st is ts.VariableStatement => ts.isVariableStatement(st) && hasModifier(st, ts.SyntaxKind.ExportKeyword))
            .flatMap((st) => st.declarationList.declarations.map((d) => routeKey(rel(f), d.name.getText())))
            .filter((k) => k.split('#')[1] && HTTP_METHODS.has(k.split('#')[1])),
        ),
    );
    expect(Object.keys(ROUTE_POLICY).filter((k) => !exported.has(k))).toEqual([]);
    // 공개 route 로 지정한 파일은 실제로 있어야 한다(이름만 남은 예외 금지)
    for (const p of PUBLIC_ROUTES) expect(routes.map(rel)).toContain(p);
  });
});

/** 위 검사 함수들이 우회 코드를 실제로 잡는지(음성 검증) */
describe('정적 검사 자체의 음성 검증', () => {
  const src = (code: string) => ts.createSourceFile('x.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  it.each([
    ['화살표 IIFE', 'const x = (() => { leak(); })();'],
    ['function IIFE', 'const x = (function () { leak(); })();'],
    ['쉼표 IIFE', 'const x = (0, () => leak())();'],
    ['call IIFE', 'const x = (function () { leak(); }).call(null);'],
    ['new class', 'const x = new (class { constructor() { leak(); } })();'],
    ['export 안 IIFE', 'export const metadata = (() => ({ title: leak() }))();'],
    ['class static 블록', 'class A { static { leak(); } }'],
    ['함수 안 class static 블록', 'function f() { class B { static { leak(); } } }'],
    ['최상위 await', 'const x = await leak();'],
    ['표현식 문장', 'leak();'],
  ])('%s → 문제로 잡는다', (_label, code) => {
    expect(topLevelProblems(src(code)).length).toBeGreaterThan(0);
  });

  it('정상 page 형태는 통과', () => {
    const ok = src(`import { requirePage } from '@/server/auth/require-role';
export default async function Page() { await requirePage('VIEWER'); const run = () => (() => 1)(); return run(); }`);
    expect(topLevelProblems(ok)).toEqual([]);
  });

  const pageFn = (code: string) => src(code).statements.find(ts.isFunctionDeclaration)!;
  it('requirePage 역할·옵션이 정책 표와 다르면 잡는다', () => {
    expect(pagePolicyProblems(pageFn(`export default async function P() { await requirePage('VIEWER'); }`), 'src/app/admin/users/page.tsx')).not.toEqual([]);
    expect(pagePolicyProblems(pageFn(`export default async function P() { await requirePage('ADMIN', { allowPasswordChange: true }); }`), 'src/app/admin/users/page.tsx')).not.toEqual([]);
    expect(pagePolicyProblems(pageFn(`export default async function P() { const r = 'ADMIN'; await requirePage(r); }`), 'src/app/admin/users/page.tsx')).not.toEqual([]);
    expect(pagePolicyProblems(pageFn(`export default async function P() { await requirePage('VIEWER'); }`), 'src/app/(auth)/change-password/page.tsx')).not.toEqual([]);
    expect(pagePolicyProblems(pageFn(`export default async function P() { await requirePage('VIEWER'); }`), 'src/app/new/page.tsx')).not.toEqual([]);
    expect(pagePolicyProblems(pageFn(`export default async function P() { const me = await requirePage('ADMIN'); }`), 'src/app/admin/users/page.tsx')).toEqual([]);
  });
});
