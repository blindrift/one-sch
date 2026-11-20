// 시드(prisma/seed.ts, migrate 이미지)에서도 쓰므로 'server-only' 와 '@/' 경로를 import 하지 않는다.
import { hash, verify } from '@node-rs/argon2';

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

// OWASP 권장 argon2id 최소값(19 MiB, t=2, p=1). Algorithm.Argon2id = 2 (const enum 이라 값으로 쓴다).
const ARGON2_OPTIONS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export async function hashPassword(password: string): Promise<string> {
  if (password.length > PASSWORD_MAX) throw new Error('password too long');
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  if (password.length > PASSWORD_MAX) return false;
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// 계정이 없거나 잠겨 있어도 같은 시간을 쓰도록 임의 해시를 한 번 만들어 검증한다.
let dummyHash: Promise<string> | null = null;

export async function dummyVerify(password: string): Promise<false> {
  dummyHash ??= hash(crypto.randomUUID(), ARGON2_OPTIONS);
  await verifyPassword(await dummyHash, password.slice(0, PASSWORD_MAX));
  return false;
}

/** 새 비밀번호 정책 위반 사유 목록. 비어 있으면 통과. 이전 비밀번호와 같은지는 isSameAsCurrent 로 따로 본다. */
export function passwordPolicyErrors(password: string, username?: string | null): string[] {
  const errors: string[] = [];
  const lower = password.toLowerCase();
  if (password.length < PASSWORD_MIN) errors.push(`${PASSWORD_MIN}자 이상이어야 합니다.`);
  if (password.length > PASSWORD_MAX) errors.push(`${PASSWORD_MAX}자 이하여야 합니다.`);
  if (lower.includes('admin')) errors.push("'admin' 을 포함할 수 없습니다.");
  if (username && lower.includes(username.toLowerCase())) errors.push('아이디를 포함할 수 없습니다.');
  return errors;
}

export async function isSameAsCurrent(currentHash: string | null, password: string): Promise<boolean> {
  return currentHash ? verifyPassword(currentHash, password) : false;
}
