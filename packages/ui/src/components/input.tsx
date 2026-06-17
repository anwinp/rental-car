import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/utils'

const inputVariants = cva(
  'flex w-full rounded-md border bg-background px-3 py-2 ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'border-input text-foreground',
        error: 'border-destructive text-foreground focus-visible:ring-destructive',
      },
      size: {
        sm: 'h-9 text-sm',
        md: 'h-11 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
)

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {
  /** Error message to display (sets variant=error and aria-invalid) */
  error?: string
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant, size, error, 'aria-describedby': ariaDescribedBy, ...props }, ref) => {
    const hasError = Boolean(error) || variant === 'error'
    const errorId = error ? `${props.id ?? 'input'}-error` : undefined

    return (
      <div className="flex flex-col gap-1">
        <input
          className={cn(
            inputVariants({ variant: hasError ? 'error' : variant, size, className })
          )}
          ref={ref}
          aria-invalid={hasError ? 'true' : undefined}
          aria-describedby={
            [ariaDescribedBy, errorId].filter(Boolean).join(' ') || undefined
          }
          {...props}
        />
        {error && (
          <p id={errorId} role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    )
  }
)
Input.displayName = 'Input'

export { Input, inputVariants }
