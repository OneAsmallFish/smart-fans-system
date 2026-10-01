import type { HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 border',
  {
    variants: {
      variant: {
        neutral: 'bg-surface-2 text-muted border-line',
        primary: 'bg-primary-soft text-primary border-primary/30',
        ok: 'bg-ok/12 text-ok border-ok/30',
        warn: 'bg-warn/12 text-warn border-warn/30',
        danger: 'bg-danger/12 text-danger border-danger/30',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
)

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
