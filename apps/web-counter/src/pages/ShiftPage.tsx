import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@rcm/ui'
import { Input } from '@rcm/ui'

const openShiftSchema = z.object({
  opening_cash: z.string().min(1, 'Opening cash amount is required'),
  notes: z.string().optional(),
})

const closeShiftSchema = z.object({
  closing_cash: z.string().min(1, 'Closing cash count is required'),
  notes: z.string().optional(),
})

type OpenShiftForm = z.infer<typeof openShiftSchema>
type CloseShiftForm = z.infer<typeof closeShiftSchema>

type ShiftStatus = 'none' | 'open' | 'closed'

interface ShiftState {
  shift_id: string
  opened_at: string
  location: string
  agent_name: string
  opening_cash: number
  status: 'open' | 'closed'
  transactions_count?: number
  revenue?: number
}

export function ShiftPage() {
  const [shiftStatus, setShiftStatus] = useState<ShiftStatus>('none')
  const [currentShift, setCurrentShift] = useState<ShiftState | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const openForm = useForm<OpenShiftForm>({
    resolver: zodResolver(openShiftSchema),
    defaultValues: { opening_cash: '', notes: '' },
  })

  const closeForm = useForm<CloseShiftForm>({
    resolver: zodResolver(closeShiftSchema),
    defaultValues: { closing_cash: '', notes: '' },
  })

  async function handleOpenShift(data: OpenShiftForm) {
    setIsSubmitting(true)
    try {
      await new Promise((r) => setTimeout(r, 500)) // stub API call
      setCurrentShift({
        shift_id: `SHF-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
        opened_at: new Date().toISOString(),
        location: 'Main Counter',
        agent_name: 'Current Agent',
        opening_cash: Number(data.opening_cash),
        status: 'open',
        transactions_count: 0,
        revenue: 0,
      })
      setShiftStatus('open')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleCloseShift(data: CloseShiftForm) {
    setIsSubmitting(true)
    try {
      await new Promise((r) => setTimeout(r, 500)) // stub API call
      if (currentShift) {
        setCurrentShift({ ...currentShift, status: 'closed' })
      }
      setShiftStatus('closed')
      void data
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-2xl font-bold">Shift Management</h1>

      {/* Current shift status */}
      {currentShift && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Current Shift</CardTitle>
              <Badge variant={currentShift.status === 'open' ? 'success' : 'outline'}>
                {currentShift.status === 'open' ? 'Open' : 'Closed'}
              </Badge>
            </div>
            <CardDescription>
              ID: {currentShift.shift_id} · {currentShift.location}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Opened</dt>
                <dd className="font-medium">{new Date(currentShift.opened_at).toLocaleTimeString()}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Opening Cash</dt>
                <dd className="font-medium">${currentShift.opening_cash.toFixed(2)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Transactions</dt>
                <dd className="font-medium">{currentShift.transactions_count ?? 0}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Revenue</dt>
                <dd className="font-medium">${(currentShift.revenue ?? 0).toFixed(2)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Open Shift Form */}
      {shiftStatus === 'none' && (
        <Card>
          <CardHeader>
            <CardTitle>Open Shift</CardTitle>
            <CardDescription>
              Start your shift by entering the opening cash amount.
            </CardDescription>
          </CardHeader>
          <form onSubmit={openForm.handleSubmit(handleOpenShift)} noValidate>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="opening-cash" className="text-sm font-medium">
                  Opening Cash Amount ($) <span aria-hidden>*</span>
                </label>
                <Input
                  id="opening-cash"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  {...openForm.register('opening_cash')}
                  aria-describedby={
                    openForm.formState.errors.opening_cash ? 'opening-cash-error' : undefined
                  }
                  aria-invalid={!!openForm.formState.errors.opening_cash}
                />
                {openForm.formState.errors.opening_cash && (
                  <p id="opening-cash-error" role="alert" aria-live="polite" className="text-xs text-destructive">
                    {openForm.formState.errors.opening_cash.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label htmlFor="open-notes" className="text-sm font-medium">
                  Notes (optional)
                </label>
                <Input
                  id="open-notes"
                  type="text"
                  placeholder="Any handover notes..."
                  {...openForm.register('notes')}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full" disabled={isSubmitting} aria-busy={isSubmitting}>
                {isSubmitting ? 'Opening shift…' : 'Open Shift'}
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      {/* Close Shift Form */}
      {shiftStatus === 'open' && (
        <Card>
          <CardHeader>
            <CardTitle>Close Shift</CardTitle>
            <CardDescription>
              Count your cash drawer and submit to close the shift.
            </CardDescription>
          </CardHeader>
          <form onSubmit={closeForm.handleSubmit(handleCloseShift)} noValidate>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="closing-cash" className="text-sm font-medium">
                  Closing Cash Count ($) <span aria-hidden>*</span>
                </label>
                <Input
                  id="closing-cash"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  {...closeForm.register('closing_cash')}
                  aria-describedby={
                    closeForm.formState.errors.closing_cash ? 'closing-cash-error' : undefined
                  }
                  aria-invalid={!!closeForm.formState.errors.closing_cash}
                />
                {closeForm.formState.errors.closing_cash && (
                  <p id="closing-cash-error" role="alert" aria-live="polite" className="text-xs text-destructive">
                    {closeForm.formState.errors.closing_cash.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label htmlFor="close-notes" className="text-sm font-medium">
                  Notes (optional)
                </label>
                <Input
                  id="close-notes"
                  type="text"
                  placeholder="End of shift notes..."
                  {...closeForm.register('notes')}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button
                type="submit"
                variant="destructive"
                className="w-full"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
              >
                {isSubmitting ? 'Closing shift…' : 'Close Shift'}
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      {shiftStatus === 'closed' && (
        <Card>
          <CardHeader>
            <CardTitle>Shift Closed</CardTitle>
            <CardDescription>Your shift has been successfully closed.</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button onClick={() => {
              setShiftStatus('none')
              setCurrentShift(null)
              openForm.reset()
              closeForm.reset()
            }}>
              Start New Shift
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  )
}
