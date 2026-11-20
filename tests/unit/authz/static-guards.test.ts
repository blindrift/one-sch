import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { PUBLIC_ACTIONS } from './policy';

const ROOT = process.cwd();

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

function isUseServerFile(sf: ts.SourceFile) {
  const first = sf.statements[0];
  return (
    !!first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use server'
  );
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
      violations.push(`재수출·export= 금지: ${stmt.getText(sf).slice(0, 60)}`);
    } else if (hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) {
      const isTypeOnly = ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt);
      if (!isTypeOnly) violations.push(`함수가 아닌 export: ${stmt.getText(sf).slice(0, 60)}`);
    }
  }
  return { functions, violations };
}

const srcFiles = walk(join(ROOT, 'src')).filter((f) => /\.(ts|tsx)$/.test(f));
const actionFiles = srcFiles.filter((f) => rel(f).startsWith('src/server/actions/'));

describe('정적 권한 검사', () => {
  it('Server Action 은 PUBLIC 예외를 빼고 첫 문장에서 requireRole 을 호출한다', () => {
    expect(actionFiles.length).toBeGreaterThan(0);
    const problems: string[] = [];
    const seenPublic: string[] = [];
    for (const file of actionFiles) {
      const sf = parse(file);
      if (!isUseServerFile(sf)) problems.push(`${rel(file)}: 'use server' 가 첫 줄이 아님`);
      const base = file.split(sep).pop()!.replace(/\.tsx?$/, '');
      for (const fn of serverExports(sf).functions) {
        const key = `${base}.${fn.name?.text}`;
        if (PUBLIC_ACTIONS.includes(key)) {
          seenPublic.push(key);
          continue;
        }
        if (!startsWithRequireRole(fn.body)) problems.push(`${rel(file)}: ${fn.name?.text} 첫 문장이 requireRole 이 아님`);
      }
    }
    expect(problems).toEqual([]);
    expect(seenPublic.sort()).toEqual([...PUBLIC_ACTIONS].sort());
  });

  it("'use server' 파일은 async 함수만 export 한다", () => {
    const problems: string[] = [];
    for (const file of srcFiles) {
      const sf = parse(file);
      if (!isUseServerFile(sf)) continue;
      for (const v of serverExports(sf).violations) problems.push(`${rel(file)}: ${v}`);
    }
    expect(problems).toEqual([]);
  });

  it('로그인 화면을 뺀 모든 page.tsx 는 첫 문장에서 requirePage 를 호출한다', () => {
    const pages = srcFiles.filter((f) => /\/page\.tsx$/.test(rel(f)) && rel(f) !== 'src/app/(auth)/login/page.tsx');
    const problems: string[] = [];
    for (const file of pages) {
      const sf = parse(file);
      const fn = sf.statements.find(
        (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && hasModifier(s, ts.SyntaxKind.DefaultKeyword),
      );
      // 리디렉션만 하는 루트 페이지는 데이터가 없으므로 예외로 둔다.
      if (rel(file) === 'src/app/page.tsx') continue;
      if (!fn || !isAwaitCall(fn.body?.statements[0], 'requirePage')) problems.push(rel(file));
    }
    expect(problems).toEqual([]);
  });

  it('auth·health 를 뺀 route.ts 는 모든 handler 첫 문장에서 requireRole 을 호출한다', () => {
    const routes = srcFiles.filter(
      (f) =>
        /\/route\.ts$/.test(rel(f)) &&
        !rel(f).startsWith('src/app/api/auth/') &&
        rel(f) !== 'src/app/api/health/route.ts',
    );
    const problems: string[] = [];
    for (const file of routes) {
      const sf = parse(file);
      for (const s of sf.statements) {
        if (ts.isFunctionDeclaration(s) && hasModifier(s, ts.SyntaxKind.ExportKeyword) && !startsWithRequireRole(s.body)) {
          problems.push(`${rel(file)}: ${s.name?.text}`);
        }
        if (ts.isVariableStatement(s) && hasModifier(s, ts.SyntaxKind.ExportKeyword)) {
          problems.push(`${rel(file)}: 함수 선언이 아닌 export(검사 불가)`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
