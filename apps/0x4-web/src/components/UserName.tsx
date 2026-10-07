// Display a specific user's name.
// 2026-09-27 goat: admins' and support's names no longer get colored (previously yellow text with blue outline) — same color as regular users.
// Staff identity is still shown by the avatar's glow border and StaffTag; the name itself doesn't distinguish.
// address / size params kept — callers don't need to change.
export default function UserName({ name, className }: { address?: string | null; name: string; className?: string; size?: 'sm' | 'lg' }) {
  return className ? <span className={className}>{name}</span> : <>{name}</>
}
