import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '../../lib/utils'

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-5.5 w-10 shrink-0 cursor-pointer items-center rounded-full border border-line',
        'transition-colors data-[state=checked]:bg-ok/80 data-[state=unchecked]:bg-surface-2',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-45',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-white shadow',
          'translate-x-0.5 transition-transform data-[state=checked]:translate-x-[calc(100%+2px)]',
        )}
      />
    </SwitchPrimitive.Root>
  )
}
