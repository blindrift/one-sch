import 'server-only';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safeMarkdownUrl } from '@/lib/markdown/safe-url';

// 이슈 설명·댓글 마크다운(설계서 5.2, D23). 서버 컴포넌트에서만 렌더한다('server-only': 클라이언트 번들에 파서를
// 싣지 않고, 렌더 규칙을 한 곳에 둔다).
// - raw HTML 은 그리지 않는다(skipHtml). rehype-raw·dangerouslySetInnerHTML 은 쓰지 않는다(정적 검사).
// - 링크는 http·https·mailto 만(urlTransform). 걸러진 링크는 글자만 남긴다. 링크는 새 창 + noopener noreferrer nofollow.
// - 이미지는 그리지 않고 링크로 바꾼다(CSP img-src 가 외부 이미지를 막고, 추적 픽셀도 피한다).

const LINK_REL = 'noopener noreferrer nofollow';

const components: Components = {
  a({ href, children }) {
    const safe = href ? safeMarkdownUrl(href) : '';
    if (!safe) return <span>{children}</span>;
    return (
      <a href={safe} target="_blank" rel={LINK_REL}>
        {children}
      </a>
    );
  },
  img({ src, alt }) {
    const safe = typeof src === 'string' ? safeMarkdownUrl(src) : '';
    const label = alt?.trim() || '이미지';
    if (!safe) return <span>[{label}]</span>;
    return (
      <a href={safe} target="_blank" rel={LINK_REL}>
        [{label}]
      </a>
    );
  },
};

const PLUGINS = [remarkGfm];

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`og-markdown ${className ?? ''}`}>
      <ReactMarkdown remarkPlugins={PLUGINS} skipHtml urlTransform={safeMarkdownUrl} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
