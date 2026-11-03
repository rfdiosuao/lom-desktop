import type { HTMLAttributes } from 'react';

/** target：要打开的会话（成员名或手机会话标题），用作「打开会话」按钮的名称。 */
export interface CardNavigation { open: () => void; target: string; }

/** UI-AUDIT-04：整张卡只保留鼠标点击的快捷方式，不再充当链接——读屏按卡片内容朗读，卡片里的按钮也不再嵌在链接里。
 *  键盘和读屏用卡片底部的「打开会话」按钮（CardOpen）。点卡片里的按钮或选中文字时不跳转。 */
export function cardNavigation(navigation?: CardNavigation): HTMLAttributes<HTMLElement> {
  if (!navigation) return {};
  return {
    onClick: e => {
      if (e.defaultPrevented || e.button !== 0 || (e.target as Element).closest('button,a,input,select,textarea,[role="button"]')) return;
      if (window.getSelection()?.toString()) return;
      navigation.open();
    },
  };
}
