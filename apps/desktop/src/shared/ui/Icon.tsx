import { ICON_PATHS, type IconName } from './iconPaths';

/* 图标：路径来自本仓库的常量表（iconPaths.ts），不接受外部输入，所以可以直接写入 SVG 内容 */
export function Icon({ name, className = '' }: { name: IconName | string; className?: string }) {
  const d = ICON_PATHS[name as IconName] ?? ICON_PATHS.info;
  return (
    <svg
      className={`icon ${className}`.trim()}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}

/* 品牌图形（首页的无限符号） */
export function InfinityLogo({ className = 'hero__logo' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 64" fill="none" aria-hidden="true">
      <path d="M57 29C28 9 10 10 10 32s22 23 49 3 48-23 48-3-20 22-39 6" stroke="currentColor" strokeWidth={5} strokeLinecap="round" />
    </svg>
  );
}

export type { IconName };
