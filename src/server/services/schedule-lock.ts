import 'server-only';
import type { Tx } from '../db';

// advisory lock 네임스페이스(두 정수 키 형식의 첫 번째 값). user-service 의 ADMIN_CHANGE_LOCK(단일 bigint 키)과는 키 공간이 다르다.
const NS_PROJECT = 74_202_001;
const NS_DEPENDENCY = 74_202_002;

/**
 * 일정 쓰기 트랜잭션 옵션. 같은 프로젝트 쓰기는 잠금으로 줄을 서므로 기본값(연결 대기 2초)보다 조금 넉넉히 기다린다.
 * 트랜잭션 안에는 읽기·계산·쓰기만 두어 짧게 유지한다(연결 풀 5개).
 */
export const SCHEDULE_TX = { maxWait: 5_000, timeout: 10_000 } as const;

/**
 * 같은 프로젝트의 작업 쓰기·보관 처리를 줄 세운다(트랜잭션이 끝나면 풀린다).
 * 상위 요약 재계산과 부모 순환 검사가 동시 쓰기에 지지 않게 하려는 것이다.
 * 잠금 순서: 프로젝트(id 오름차순) → 의존. 여러 프로젝트를 잡을 때는 lockProjects 를 쓴다.
 */
export async function lockProject(tx: Tx, projectId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${NS_PROJECT}::int4, hashtext(${projectId}))`;
}

/** 여러 프로젝트를 교착 없이 잡는다(중복 제거 후 id 오름차순). */
export async function lockProjects(tx: Tx, projectIds: readonly string[]): Promise<void> {
  for (const id of [...new Set(projectIds)].sort()) await lockProject(tx, id);
}

/** 의존 추가의 순환 검사를 전역으로 줄 세운다. 언제나 프로젝트 잠금 다음에 잡는다. */
export async function lockDependencies(tx: Tx): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${NS_DEPENDENCY}::int4, 0)`;
}
