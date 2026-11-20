import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Tx } from './db';
import { maskSensitive } from './log';
import type { RequestMeta } from './request-meta';

type JsonRecord = Record<string, unknown>;

export type AuditInput = {
  actorId?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  before?: JsonRecord | null;
  after?: JsonRecord | null;
  meta?: RequestMeta | null;
};

function toJson(value: JsonRecord | null | undefined): Prisma.InputJsonValue | undefined {
  if (!value) return undefined;
  // Date 는 ISO 문자열로, 민감 키는 마스킹해서 저장한다.
  return maskSensitive(value) as Prisma.InputJsonValue;
}

/** 데이터 변경과 같은 트랜잭션(tx)으로 호출한다. */
export async function writeAudit(db: Tx | PrismaClient, input: AuditInput): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
      before: toJson(input.before),
      after: toJson(input.after),
      ip: input.meta?.ip ?? null,
      userAgent: input.meta?.userAgent ?? null,
    },
  });
}

function normalize(v: unknown): unknown {
  return v instanceof Date ? v.toISOString() : v;
}

/** 바뀐 필드만 before/after 로 돌려준다. 바뀐 것이 없으면 null. */
export function diffFields<T extends JsonRecord>(
  before: T,
  after: Partial<T>,
  fields: readonly (keyof T & string)[] = Object.keys(after) as (keyof T & string)[],
): { before: JsonRecord; after: JsonRecord } | null {
  const b: JsonRecord = {};
  const a: JsonRecord = {};
  for (const f of fields) {
    if (!(f in after)) continue;
    const bv = normalize(before[f]);
    const av = normalize(after[f]);
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      b[f] = bv;
      a[f] = av;
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}
