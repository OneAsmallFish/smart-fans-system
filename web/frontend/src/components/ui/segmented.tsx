import { cn } from '../../lib/utils'

/** 小型分段选择器（AUTO/MANUAL、LUT/PID 等两三值场景），无依赖 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = 'sm',
  disabled,
}: {
  value: T
  options: Array<{ value: T; label: React.ReactNode }>
  onChange: (v: T) => void
  className?: string
  size?: 'xs' | 'sm'
  disabled?: boolean
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border border-line bg-surface-2 p-0.5',
        disabled && 'opacity-45 pointer-events-none',
        className,
      )}
    >
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded-full font-medium transition-all cursor-pointer outline-none',
            'focus-visible:ring-2 focus-visible:ring-primary/50',
            size === 'xs' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs',
            value === opt.value
              ? 'bg-primary text-on-primary shadow-[0_1px_8px_-1px_var(--glow)]'
              : 'text-muted hover:text-fg',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
