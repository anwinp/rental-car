'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRateQuote, useCreateReservation } from '@rcm/api-client'
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
  StepperRoot,
  StepperList,
  StepperItem,
  StepperContent,
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  Badge,
  Skeleton,
} from '@rcm/ui'
import { Input } from '@rcm/ui'
import { Providers } from '../../providers'

// --- Zod schema for driver details ---

const driverSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  email: z.string().email('Please enter a valid email address'),
  phone: z.string().optional(),
  dl_number: z.string().optional(),
  dl_state: z.string().optional(),
  dl_country: z.string().optional(),
})

type DriverFormData = z.infer<typeof driverSchema>

// --- Extras Catalog (stub) ---

const EXTRAS = [
  { code: 'CDW', name: 'Collision Damage Waiver', dailyRate: 19.99 },
  { code: 'GPS', name: 'GPS Navigation', dailyRate: 7.99 },
  { code: 'CSS', name: 'Child Safety Seat', dailyRate: 9.99 },
  { code: 'PAI', name: 'Personal Accident Insurance', dailyRate: 4.99 },
  { code: 'RSN', name: 'Roadside Assistance', dailyRate: 3.99 },
]

interface BookingPageProps {
  params: { id: string }
  searchParams: {
    pickup?: string
    from?: string
    to?: string
  }
}

const STEPS = [
  { label: 'Vehicle & Extras' },
  { label: 'Driver Details' },
  { label: 'Rate Summary' },
  { label: 'Confirmation' },
]

export default function BookingPage({ params, searchParams }: BookingPageProps) {
  const classId = params.id
  const { pickup = '', from = '', to = '' } = searchParams

  const [activeStep, setActiveStep] = useState(0)
  const [selectedExtras, setSelectedExtras] = useState<string[]>([])
  const [confirmationNumber, setConfirmationNumber] = useState<string | null>(null)
  const [driverData, setDriverData] = useState<DriverFormData | null>(null)

  // Rate quote query
  const daysCount = from && to
    ? Math.max(1, Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000))
    : 1

  const { data: quote, isLoading: quoteLoading } = useRateQuote({
    pickup_location_id: pickup,
    pickup_date: from,
    dropoff_date: to,
    class_code: classId,
    extras: selectedExtras,
  })

  const createReservation = useCreateReservation()

  // Driver form
  const form = useForm<DriverFormData>({
    resolver: zodResolver(driverSchema),
    defaultValues: {
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      dl_number: '',
      dl_state: '',
      dl_country: 'US',
    },
  })

  // Extra running total (local calc while quote loads)
  const extrasTotal = selectedExtras.reduce((sum, code) => {
    const extra = EXTRAS.find((e) => e.code === code)
    return sum + (extra?.dailyRate ?? 0) * daysCount
  }, 0)

  function toggleExtra(code: string) {
    setSelectedExtras((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    )
  }

  async function handleDriverSubmit(data: DriverFormData) {
    setDriverData(data)
    setActiveStep(2)
  }

  async function handleConfirmBooking() {
    if (!driverData) return
    try {
      const result = await createReservation.mutateAsync({
        pickup_location_id: pickup,
        pickup_date: from,
        dropoff_date: to,
        class_code: classId,
        extras: selectedExtras,
        customer: driverData,
      })
      setConfirmationNumber(result.confirmation_number)
      setActiveStep(3)
    } catch (err) {
      console.error('Booking failed', err)
    }
  }

  return (
    <Providers>
      <div className="min-h-screen bg-background px-4 py-8">
        <div className="mx-auto max-w-3xl">
          <h1 className="mb-8 text-2xl font-bold">Complete Your Booking</h1>

          <StepperRoot
            activeStep={activeStep}
            totalSteps={STEPS.length}
            onStepChange={setActiveStep}
          >
            <StepperList aria-label="Booking steps">
              {STEPS.map((step, i) => (
                <StepperItem
                  key={i}
                  step={i}
                  label={step.label}
                  disabled={i > activeStep && activeStep < 3}
                />
              ))}
            </StepperList>

            {/* Step 0: Vehicle & Extras */}
            <StepperContent step={0}>
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Select Extras</CardTitle>
                  <CardDescription>
                    Customize your rental with additional options.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <fieldset>
                    <legend className="sr-only">Optional extras</legend>
                    <div className="space-y-3">
                      {EXTRAS.map((extra) => {
                        const checked = selectedExtras.includes(extra.code)
                        return (
                          <label
                            key={extra.code}
                            className="flex cursor-pointer items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleExtra(extra.code)}
                                className="h-4 w-4 rounded border-input accent-primary"
                                aria-label={extra.name}
                              />
                              <div>
                                <p className="font-medium">{extra.name}</p>
                                <p className="text-sm text-muted-foreground">{extra.code}</p>
                              </div>
                            </div>
                            <p className="font-semibold">
                              ${extra.dailyRate.toFixed(2)}<span className="text-xs font-normal text-muted-foreground">/day</span>
                            </p>
                          </label>
                        )
                      })}
                    </div>
                  </fieldset>

                  {selectedExtras.length > 0 && (
                    <div className="mt-4 rounded-lg bg-muted/50 p-3 text-sm">
                      <div className="flex justify-between">
                        <span>Extras subtotal ({daysCount} day{daysCount !== 1 ? 's' : ''})</span>
                        <span className="font-semibold">${extrasTotal.toFixed(2)}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
                <CardFooter className="justify-end">
                  <Button onClick={() => setActiveStep(1)}>
                    Continue to Driver Details
                  </Button>
                </CardFooter>
              </Card>
            </StepperContent>

            {/* Step 1: Driver Details */}
            <StepperContent step={1}>
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Driver Details</CardTitle>
                  <CardDescription>
                    Enter the primary driver information.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...form}>
                    <form
                      id="driver-form"
                      onSubmit={form.handleSubmit(handleDriverSubmit)}
                      noValidate
                      className="space-y-4"
                    >
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="first_name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>First Name <span aria-hidden>*</span></FormLabel>
                              <FormControl>
                                <div>
                                  <Input placeholder="Jane" {...field} />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="last_name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Last Name <span aria-hidden>*</span></FormLabel>
                              <FormControl>
                                <div>
                                  <Input placeholder="Smith" {...field} />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email Address <span aria-hidden>*</span></FormLabel>
                            <FormControl>
                              <div>
                                <Input type="email" placeholder="jane@example.com" {...field} />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone Number</FormLabel>
                            <FormControl>
                              <div>
                                <Input type="tel" placeholder="+1 (555) 000-0000" {...field} />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="grid grid-cols-3 gap-4">
                        <FormField
                          control={form.control}
                          name="dl_number"
                          render={({ field }) => (
                            <FormItem className="col-span-2">
                              <FormLabel>Driver License Number</FormLabel>
                              <FormControl>
                                <div>
                                  <Input placeholder="D12345678" {...field} />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="dl_state"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>State</FormLabel>
                              <FormControl>
                                <div>
                                  <Input placeholder="CA" maxLength={2} {...field} />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </form>
                  </Form>
                </CardContent>
                <CardFooter className="justify-between">
                  <Button variant="outline" onClick={() => setActiveStep(0)}>
                    Back
                  </Button>
                  <Button type="submit" form="driver-form">
                    Continue to Rate Summary
                  </Button>
                </CardFooter>
              </Card>
            </StepperContent>

            {/* Step 2: Rate Summary */}
            <StepperContent step={2}>
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Rate Summary</CardTitle>
                  <CardDescription>
                    Review pricing before confirming your booking.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {quoteLoading ? (
                    <div className="space-y-3" aria-busy="true" aria-label="Loading rate summary">
                      {[...Array(5)].map((_, i) => (
                        <Skeleton key={i} className="h-6 w-full" />
                      ))}
                    </div>
                  ) : quote ? (
                    <div className="space-y-2">
                      {quote.line_items.map((item, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span
                            className={
                              item.type === 'tax' || item.type === 'fee'
                                ? 'text-muted-foreground'
                                : undefined
                            }
                          >
                            {item.description}
                          </span>
                          <span
                            className={
                              item.type === 'discount' ? 'text-green-600' : undefined
                            }
                          >
                            {item.type === 'discount' ? '-' : ''}
                            {new Intl.NumberFormat('en-US', {
                              style: 'currency',
                              currency: item.currency_code,
                            }).format(Math.abs(item.amount))}
                          </span>
                        </div>
                      ))}
                      <div className="mt-4 flex justify-between border-t pt-4 text-base font-bold">
                        <span>Total</span>
                        <span>
                          {new Intl.NumberFormat('en-US', {
                            style: 'currency',
                            currency: quote.currency_code,
                          }).format(quote.total)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      Rate information unavailable. You can still complete your booking.
                    </p>
                  )}

                  {/* Stripe placeholder */}
                  <div
                    className="mt-6 rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/20 p-8 text-center"
                    role="region"
                    aria-label="Payment form — coming soon"
                  >
                    <p className="text-sm font-medium text-muted-foreground">
                      Stripe Payment Element
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Payment integration coming in the next sprint
                    </p>
                  </div>
                </CardContent>
                <CardFooter className="justify-between">
                  <Button variant="outline" onClick={() => setActiveStep(1)}>
                    Back
                  </Button>
                  <Button
                    onClick={handleConfirmBooking}
                    disabled={createReservation.isPending}
                    aria-busy={createReservation.isPending}
                  >
                    {createReservation.isPending ? 'Booking...' : 'Confirm Booking'}
                  </Button>
                </CardFooter>
              </Card>

              {createReservation.isError && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
                >
                  {createReservation.error instanceof Error
                    ? createReservation.error.message
                    : 'Booking failed. Please try again.'}
                </div>
              )}
            </StepperContent>

            {/* Step 3: Confirmation */}
            <StepperContent step={3}>
              <Card className="mt-6">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-green-700"
                        aria-hidden="true"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                    <div>
                      <CardTitle>Booking Confirmed!</CardTitle>
                      <CardDescription>
                        A confirmation has been sent to {driverData?.email}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {confirmationNumber && (
                    <div className="rounded-lg bg-muted p-4 text-center">
                      <p className="text-sm text-muted-foreground">Confirmation Number</p>
                      <p className="mt-1 text-3xl font-bold tracking-wider">
                        {confirmationNumber}
                      </p>
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground">
                    Please keep this confirmation number handy when you pick up your vehicle.
                    You can also manage your booking online.
                  </p>
                </CardContent>
                <CardFooter className="justify-between">
                  <a
                    href={`/manage/${confirmationNumber}`}
                    className="text-sm text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Manage My Booking
                  </a>
                  <Button asChild>
                    <a href="/">Book Another Car</a>
                  </Button>
                </CardFooter>
              </Card>
            </StepperContent>
          </StepperRoot>
        </div>
      </div>
    </Providers>
  )
}
