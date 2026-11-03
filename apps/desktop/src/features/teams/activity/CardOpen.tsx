import type { CardNavigation } from './cardNavigation';

/** UI-AUDIT-04：卡片里明确的「打开会话」按钮：Tab 可达、Enter / 空格激活，名称带上要打开的会话。 */
export function CardOpen({ navigation }: { navigation?: CardNavigation }) {
  if (!navigation) return null;
  const name = `打开会话：${navigation.target}`;
  return <button type="button" className="act-card__open" aria-label={name} title={name} onClick={navigation.open}>打开会话</button>;
}
