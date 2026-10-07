import type { ButtonHTMLAttributes } from 'react'
import { LoaderCircle } from 'lucide-react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'up' | 'down'

const styles: Record<Variant, string> = {
  // 液态玻璃改版：主按钮珍珠渐变，次按钮半透明玻璃
  primary: 'pearl-button hover:brightness-105',
  secondary: 'glass-lite text-fg hover:bg-card2',
  ghost: 'bg-transparent text-muted hover:text-fg',
  danger: 'bg-down/15 text-down hover:bg-down/25',
  up: 'bg-up text-bg hover:brightness-95',
  down: 'bg-down text-bg hover:brightness-95',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  loading,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  const sz = size === 'sm' ? 'min-h-11 px-3 py-2 text-sm' : size === 'lg' ? 'min-h-13 px-5 py-3 text-base' : 'min-h-12 px-4 py-2.5 text-[15px]'
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`ui-button ${sz} ${styles[variant]} ${className}`}
      {...rest}
    >
      {/* 保留标签尺寸，加载图标不挤动按钮及相邻控件。 */}
      <span className={`ui-button-content ${loading ? 'opacity-0' : ''}`}>{children}</span>
      {loading && <LoaderCircle size={18} className="absolute animate-spin" aria-hidden="true" />}
    </button>
  )
}
