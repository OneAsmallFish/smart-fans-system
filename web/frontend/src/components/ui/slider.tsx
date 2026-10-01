import * as SliderPrimitive from '@radix-ui/react-slider'
import { cn } from '../../lib/utils'

/** Radix Slider，token 化样式；onValueChange 实时回调（拖动即触发） */
export function Slider({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      className={cn('relative flex w-full touch-none select-none items-center', className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-surface-2 border border-line">
        <SliderPrimitive.Range className="absolute h-full bg-primary rounded-full" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className={cn(
          'block h-4 w-4 rounded-full border-2 border-primary bg-bg shadow-[0_0_10px_-1px_var(--glow)]',
          'transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          'disabled:pointer-events-none disabled:opacity-45 cursor-grab active:cursor-grabbing',
        )}
      />
    </SliderPrimitive.Root>
  )
}
