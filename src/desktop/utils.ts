export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');
