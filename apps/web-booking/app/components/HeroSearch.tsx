'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@rcm/ui'
import { Input } from '@rcm/ui'

interface SearchForm {
  pickup: string
  from: string
  to: string
}

export function HeroSearch() {
  const router = useRouter()
  const [form, setForm] = useState<SearchForm>({
    pickup: '',
    from: '',
    to: '',
  })
  const [errors, setErrors] = useState<Partial<SearchForm>>({})

  function validate(): boolean {
    const newErrors: Partial<SearchForm> = {}
    if (!form.pickup.trim()) newErrors.pickup = 'Please enter a pickup location.'
    if (!form.from) newErrors.from = 'Please select a pickup date.'
    if (!form.to) newErrors.to = 'Please select a return date.'
    if (form.from && form.to && form.from >= form.to) {
      newErrors.to = 'Return date must be after pickup date.'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    const params = new URLSearchParams({
      pickup: form.pickup,
      dropoff: form.pickup, // same location by default
      from: form.from,
      to: form.to,
    })
    router.push(`/search?${params.toString()}`)
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Search for rental cars">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Location */}
        <div className="space-y-1">
          <label htmlFor="pickup-location" className="text-sm font-medium">
            Pickup Location
          </label>
          <Input
            id="pickup-location"
            type="text"
            placeholder="City, airport, or address"
            value={form.pickup}
            onChange={(e) => {
              setForm((f) => ({ ...f, pickup: e.target.value }))
              if (errors.pickup) setErrors((e) => ({ ...e, pickup: undefined }))
            }}
            aria-describedby={errors.pickup ? 'pickup-error' : undefined}
            aria-invalid={!!errors.pickup}
          />
          {errors.pickup && (
            <p id="pickup-error" role="alert" aria-live="polite" className="text-xs text-destructive">
              {errors.pickup}
            </p>
          )}
        </div>

        {/* Pickup Date */}
        <div className="space-y-1">
          <label htmlFor="pickup-date" className="text-sm font-medium">
            Pickup Date
          </label>
          <Input
            id="pickup-date"
            type="date"
            value={form.from}
            min={new Date().toISOString().split('T')[0]}
            onChange={(e) => {
              setForm((f) => ({ ...f, from: e.target.value }))
              if (errors.from) setErrors((e) => ({ ...e, from: undefined }))
            }}
            aria-describedby={errors.from ? 'from-error' : undefined}
            aria-invalid={!!errors.from}
          />
          {errors.from && (
            <p id="from-error" role="alert" aria-live="polite" className="text-xs text-destructive">
              {errors.from}
            </p>
          )}
        </div>

        {/* Return Date */}
        <div className="space-y-1">
          <label htmlFor="return-date" className="text-sm font-medium">
            Return Date
          </label>
          <Input
            id="return-date"
            type="date"
            value={form.to}
            min={form.from || new Date().toISOString().split('T')[0]}
            onChange={(e) => {
              setForm((f) => ({ ...f, to: e.target.value }))
              if (errors.to) setErrors((e) => ({ ...e, to: undefined }))
            }}
            aria-describedby={errors.to ? 'to-error' : undefined}
            aria-invalid={!!errors.to}
          />
          {errors.to && (
            <p id="to-error" role="alert" aria-live="polite" className="text-xs text-destructive">
              {errors.to}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button type="submit" size="lg" className="w-full sm:w-auto">
          Search Available Cars
        </Button>
      </div>
    </form>
  )
}
