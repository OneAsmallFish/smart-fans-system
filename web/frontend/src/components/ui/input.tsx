import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'num h-8 rounded-lg border border-line bg-surface-2 px-2.5 text-sm text-fg outline-none',
        'transition-colors placeholder:text-faint focus:border-primary/60 focus:ring-2 focus:ring-primary/25',
        'disabled:opacity-45',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'
