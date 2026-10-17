export function Activity({ label }: { label: string }) {
  return <span className="activity" role="status"><span className="spinner" aria-hidden="true" />{label}</span>;
}
