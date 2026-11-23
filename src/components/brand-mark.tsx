import { cn } from 'cn';

/** 워크스페이스 표시용 보라 사각 아이콘(앱 머리글자). 장식이므로 읽지 않는다. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white shadow-sm select-none',
        className,
      )}
    >
      O
    </span>
  );
}
