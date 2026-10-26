import type { ReactNode } from 'react';

/* 页面容器：中栏可滚动区 + 居中内容 */
export const Page = ({ children }: { children: ReactNode }) => <div className="center__body"><div className="page">{children}</div></div>;
