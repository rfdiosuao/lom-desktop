import type { ButtonHTMLAttributes } from 'react';
import { Icon } from './Icon';
export function Button({ icon, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: string }) {
  return <button type="button" {...props}>{icon && <Icon name={icon} />}{children}</button>;
}
