import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type ModalState = 'idle' | 'checkout' | 'checkin' | 'swap'

export interface OfflineQueueItem {
  id: string
  url: string
  body: string
  timestamp: number
}

interface CounterStore {
  // Modal state
  modalState: ModalState
  setModal: (state: ModalState) => void

  // Multi-step wizard position
  currentStep: number
  totalSteps: number
  nextStep: () => void
  prevStep: () => void
  resetFlow: () => void

  // Offline queue (persisted to localStorage)
  offlineQueue: OfflineQueueItem[]
  addToQueue: (item: Omit<OfflineQueueItem, 'id'>) => void
  removeFromQueue: (id: string) => void
  clearQueue: () => void
}

export const useCounterStore = create<CounterStore>()(
  persist(
    (set) => ({
      // Modal
      modalState: 'idle',
      setModal: (state) => set({ modalState: state }),

      // Stepper
      currentStep: 0,
      totalSteps: 6,
      nextStep: () =>
        set((s) => ({ currentStep: Math.min(s.currentStep + 1, s.totalSteps - 1) })),
      prevStep: () =>
        set((s) => ({ currentStep: Math.max(s.currentStep - 1, 0) })),
      resetFlow: () => set({ currentStep: 0, modalState: 'idle' }),

      // Offline queue
      offlineQueue: [],
      addToQueue: (item) =>
        set((s) => ({
          offlineQueue: [
            ...s.offlineQueue,
            { ...item, id: crypto.randomUUID() },
          ],
        })),
      removeFromQueue: (id) =>
        set((s) => ({
          offlineQueue: s.offlineQueue.filter((i) => i.id !== id),
        })),
      clearQueue: () => set({ offlineQueue: [] }),
    }),
    {
      name: 'rcm-counter-store',
      storage: createJSONStorage(() => localStorage),
      // Only persist the offline queue — wizard state is ephemeral
      partialize: (s) => ({ offlineQueue: s.offlineQueue }),
    }
  )
)

// Selectors for convenience
export const selectOfflineQueueCount = (s: CounterStore) => s.offlineQueue.length
export const selectCurrentStep = (s: CounterStore) => s.currentStep
export const selectModalState = (s: CounterStore) => s.modalState
