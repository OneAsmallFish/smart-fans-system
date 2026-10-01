import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-medium transition-all outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-primary/60 disabled:pointer-events-none disabled:opacity-45 ' +
    'active:scale-[0.98] cursor-pointer select-none',
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-on-primary shadow-[0_2px_12px_-2px_var(--glow)] hover:brightness-110',
        secondary: 'bg-surface-2 text-fg border border-line hover:border-line-strong',
        ghost: 'text-muted hover:text-fg hover:bg-surface-2',
        outline: 'border border-line-strong text-fg hover:bg-surface-2',
        danger: 'bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25',
        success: 'bg-ok/15 text-ok border border-ok/40 hover:bg-ok/25',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-9 px-4',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
)
Button.displayName = 'Button'
