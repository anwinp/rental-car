import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface DriverData {
  first_name: string
  last_name: string
  email: string
  phone: string
  dob: string
  dl_number: string
  dl_state: string
  dl_country: string
}

interface BookingDraft {
  classId: string
  pickup: string
  dropoff: string
  from: string
  to: string
  pickup_time: string
  return_time: string
  step: number
  selectedExtras: string[]
  driverData: DriverData | null
  promoCode: string
  // Actions
  setClassId: (id: string) => void
  setSearchParams: (p: {
    pickup: string
    dropoff: string
    from: string
    to: string
    pickup_time: string
    return_time: string
  }) => void
  setStep: (step: number) => void
  setExtras: (extras: string[]) => void
  setDriverData: (data: DriverData) => void
  setPromoCode: (code: string) => void
  reset: () => void
}

const initialState = {
  classId: '',
  pickup: '',
  dropoff: '',
  from: '',
  to: '',
  pickup_time: '10:00',
  return_time: '10:00',
  step: 0,
  selectedExtras: [] as string[],
  driverData: null,
  promoCode: '',
}

export const useBookingDraft = create<BookingDraft>()(
  persist(
    (set) => ({
      ...initialState,
      setClassId: (classId) => set({ classId }),
      setSearchParams: (p) => set(p),
      setStep: (step) => set({ step }),
      setExtras: (selectedExtras) => set({ selectedExtras }),
      setDriverData: (driverData) => set({ driverData }),
      setPromoCode: (promoCode) => set({ promoCode }),
      reset: () => set(initialState),
    }),
    {
      name: 'rcm-booking-draft',
      // Never persist payment data - only safe fields
      partialize: (state) => ({
        classId: state.classId,
        pickup: state.pickup,
        dropoff: state.dropoff,
        from: state.from,
        to: state.to,
        pickup_time: state.pickup_time,
        return_time: state.return_time,
        step: state.step,
        selectedExtras: state.selectedExtras,
        driverData: state.driverData,
        promoCode: state.promoCode,
      }),
    }
  )
)
