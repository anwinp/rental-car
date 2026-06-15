import { cn } from '../lib/utils'

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Preset shape variants */
  variant?: 'text' | 'card' | 'table' | 'avatar' | 'custom'
  /** For 'table' variant: number of skeleton rows */
  rows?: number
}

function Skeleton({ className, variant = 'custom', rows = 3, ...props }: SkeletonProps) {
  if (variant === 'text') {
    return (
      <div className={cn('space-y-2', className)} {...props}>
        <div className="h-4 w-full animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-4/5 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-3/5 animate-pulse rounded-md bg-muted" />
      </div>
    )
  }

  if (variant === 'avatar') {
    return (
      <div className={cn('flex items-center gap-3', className)} {...props}>
        <div className="h-10 w-10 animate-pulse rounded-full bg-muted" />
        <div className="space-y-2">
          <div className="h-4 w-24 animate-pulse rounded-md bg-muted" />
          <div className="h-3 w-32 animate-pulse rounded-md bg-muted" />
        </div>
      </div>
    )
  }

  if (variant === 'card') {
    return (
      <div
        className={cn('rounded-lg border bg-card p-6 shadow-sm', className)}
        {...props}
      >
        <div className="space-y-4">
          <div className="h-6 w-1/3 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-full animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-4/5 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-3/5 animate-pulse rounded-md bg-muted" />
        </div>
      </div>
    )
  }

  if (variant === 'table') {
    return (
      <div className={cn('space-y-2', className)} {...props}>
        {/* Header row */}
        <div className="flex gap-4 border-b pb-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-4 flex-1 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
        {/* Body rows */}
        {[...Array(rows)].map((_, rowIndex) => (
          <div key={rowIndex} className="flex gap-4 py-2">
            {[...Array(4)].map((_, colIndex) => (
              <div
                key={colIndex}
                className="h-4 flex-1 animate-pulse rounded-md bg-muted"
                style={{ opacity: 1 - rowIndex * 0.1 }}
              />
            ))}
          </div>
        ))}
      </div>
    )
  }

  // Default / custom
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  )
}

export { Skeleton }
