import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useId,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { cn } from '../lib/utils'

// --- Context ---

interface StepperContextValue {
  activeStep: number
  totalSteps: number
  onStepChange?: (step: number) => void
  orientation: 'horizontal' | 'vertical'
  panelIdPrefix: string
  tabIdPrefix: string
}

const StepperContext = createContext<StepperContextValue>({
  activeStep: 0,
  totalSteps: 0,
  orientation: 'horizontal',
  panelIdPrefix: 'step-panel',
  tabIdPrefix: 'step-tab',
})

// --- StepperRoot ---

interface StepperRootProps extends HTMLAttributes<HTMLDivElement> {
  activeStep: number
  totalSteps: number
  onStepChange?: (step: number) => void
  orientation?: 'horizontal' | 'vertical'
  children: ReactNode
}

function StepperRoot({
  activeStep,
  totalSteps,
  onStepChange,
  orientation = 'horizontal',
  className,
  children,
  ...props
}: StepperRootProps) {
  const id = useId()
  const panelIdPrefix = `${id}-panel`
  const tabIdPrefix = `${id}-tab`

  return (
    <StepperContext.Provider
      value={{ activeStep, totalSteps, onStepChange, orientation, panelIdPrefix, tabIdPrefix }}
    >
      <div
        className={cn('w-full', orientation === 'vertical' ? 'flex flex-row gap-4' : 'flex flex-col gap-4', className)}
        {...props}
      >
        {children}
      </div>
    </StepperContext.Provider>
  )
}

// --- StepperList (the tablist) ---

const StepperList = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    const { orientation, activeStep, totalSteps, onStepChange } = useContext(StepperContext)
    const listRef = useRef<HTMLDivElement>(null)

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLDivElement>) => {
        const isHoriz = orientation === 'horizontal'
        const prevKey = isHoriz ? 'ArrowLeft' : 'ArrowUp'
        const nextKey = isHoriz ? 'ArrowRight' : 'ArrowDown'

        if (e.key === prevKey && activeStep > 0) {
          e.preventDefault()
          onStepChange?.(activeStep - 1)
          // Focus the previous tab
          const tabs = listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')
          tabs?.[activeStep - 1]?.focus()
        } else if (e.key === nextKey && activeStep < totalSteps - 1) {
          e.preventDefault()
          onStepChange?.(activeStep + 1)
          const tabs = listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')
          tabs?.[activeStep + 1]?.focus()
        }
      },
      [activeStep, totalSteps, onStepChange, orientation]
    )

    return (
      <div
        ref={(node) => {
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
          ;(listRef as React.MutableRefObject<HTMLDivElement | null>).current = node
        }}
        role="tablist"
        aria-orientation={orientation}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex gap-2',
          orientation === 'horizontal' ? 'flex-row items-center' : 'flex-col',
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }
)
StepperList.displayName = 'StepperList'

// --- StepperItem (a single step tab) ---

interface StepperItemProps extends HTMLAttributes<HTMLButtonElement> {
  step: number
  label: string
  disabled?: boolean
}

const StepperItem = forwardRef<HTMLButtonElement, StepperItemProps>(
  ({ step, label, disabled, className, children, ...props }, ref) => {
    const { activeStep, onStepChange, panelIdPrefix, tabIdPrefix } = useContext(StepperContext)
    const isActive = step === activeStep
    const isCompleted = step < activeStep

    return (
      <button
        ref={ref}
        role="tab"
        id={`${tabIdPrefix}-${step}`}
        aria-selected={isActive}
        aria-controls={`${panelIdPrefix}-${step}`}
        aria-disabled={disabled}
        tabIndex={isActive ? 0 : -1}
        disabled={disabled}
        onClick={() => !disabled && onStepChange?.(step)}
        className={cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          'min-h-[44px] min-w-[44px]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          isActive && 'bg-primary text-primary-foreground',
          isCompleted && !isActive && 'text-primary',
          !isActive && !isCompleted && 'text-muted-foreground',
          disabled && 'cursor-not-allowed opacity-50',
          className
        )}
        {...props}
      >
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold',
            isActive && 'border-primary-foreground bg-primary-foreground text-primary',
            isCompleted && !isActive && 'border-primary bg-primary text-primary-foreground',
            !isActive && !isCompleted && 'border-muted-foreground'
          )}
          aria-hidden="true"
        >
          {isCompleted ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            step + 1
          )}
        </span>
        <span>{label}</span>
        {children}
      </button>
    )
  }
)
StepperItem.displayName = 'StepperItem'

// --- StepperContent (panel for a step) ---

interface StepperContentProps extends HTMLAttributes<HTMLDivElement> {
  step: number
}

const StepperContent = forwardRef<HTMLDivElement, StepperContentProps>(
  ({ step, className, children, ...props }, ref) => {
    const { activeStep, panelIdPrefix, tabIdPrefix } = useContext(StepperContext)
    const isActive = step === activeStep

    if (!isActive) return null

    return (
      <div
        ref={ref}
        role="tabpanel"
        id={`${panelIdPrefix}-${step}`}
        aria-labelledby={`${tabIdPrefix}-${step}`}
        tabIndex={0}
        className={cn('outline-none', className)}
        {...props}
      >
        {children}
      </div>
    )
  }
)
StepperContent.displayName = 'StepperContent'

export { StepperRoot, StepperList, StepperItem, StepperContent }
