import type { ReactNode } from 'react';
import { Icon } from '@/shared/ui/Icon';
import { Btn } from '@/shared/ui/Button';
export function CatalogItem({name,description,meta,icon,imageUrl,avatar,tone=0,action,onClick}: {name:string;description:string;meta?:ReactNode;icon:string;imageUrl?:string;avatar?:number;tone?:number;action:string;onClick:()=>void}) {
  return <article className="hub-item"><span className={`hub-item__icon hub-item__icon--${tone%3}`}>{avatar !== undefined ? <span className="hub-role-avatar" style={{backgroundPosition: `${(avatar % 4) * 100 / 3}% ${Math.floor(avatar / 4) * 50}%`}}/> : imageUrl ? <img className="hub-connector-logo" src={imageUrl} alt=""/> : <Icon name={icon}/>}</span><div className="hub-item__copy"><h3 title={name}>{name}</h3><p title={description}>{description}</p><div className="hub-item__meta">{meta}</div></div><Btn size="sm" label={action} aria-label={`${action} ${name}`} onClick={onClick}/></article>;
}
export function CategoryBar({items,value,onChange}: {items:string[];value:string;onChange:(s:string)=>void}) {
  return <div className="hub-categories" aria-label="分类">{items.map(item=><button type="button" key={item} className={item===value?'is-active':''} aria-pressed={item===value} onClick={()=>onChange(item)}>{item}</button>)}</div>;
}
