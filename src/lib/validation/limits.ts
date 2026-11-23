// 클라이언트·서버 공용 입력 한도. server/auth/password.ts 와 같은 값이어야 한다.
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
export const NAME_MAX = 100;
export const EMAIL_MAX = 254;
export const TITLE_MAX = 200;
export const PROJECT_NAME_MAX = 100;
export const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
