import { describe, expect, it } from 'vitest';
import { safeMarkdownUrl } from '@/lib/markdown/safe-url';

describe('safeMarkdownUrl', () => {
  it.each([
    ['https://example.com/a?b=1#c', 'https://example.com/a?b=1#c'],
    ['http://example.com', 'http://example.com/'],
    ['HTTPS://EXAMPLE.com/x', 'https://example.com/x'],
    ['mailto:a@example.com', 'mailto:a@example.com'],
  ])('%s 허용', (input, out) => {
    expect(safeMarkdownUrl(input)).toBe(out);
  });

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    '\u0001javascript:alert(1)',
    'javascript&#58;alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'DATA:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    'VbScRiPt:msgbox(1)',
    'file:///etc/passwd',
    'ftp://example.com',
    '//evil.example/x',
    '/relative',
    '#anchor',
    '',
  ])('%j 제거', (input) => {
    expect(safeMarkdownUrl(input)).toBe('');
  });
});
