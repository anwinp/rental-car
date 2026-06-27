import { create } from 'zustand'

export type AdminSection =
  | 'fleet'
  | 'reservations'
  | 'customers'
  | 'pricing'
  | 'reports'
  | 'settings'

interface ActiveFilters {
  status?: string[]
  locationId?: string
  dateRange?: { from: string; to: string }
  search?: string
  classCode?: string
}

interface AdminStore {
  // Sidebar
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void

  // Active section + filters (filters reset on section change)
  activeSection: AdminSection
  activeFilters: ActiveFilters
  setSection: (s: AdminSection) => void
  setFilter: (key: string, value: unknown) => void
  clearFilters: () => void

  // Bulk item selection (e.g. bulk status change)
  selectedItems: string[]
  toggleItem: (id: string) => void
  selectAll: (ids: string[]) => void
  clearSelection: () => void

  // Intelligence panel (Wave 5)
  intelligencePanelOpen: boolean
  toggleIntelligencePanel: () => void
  setIntelligencePanelOpen: (v: boolean) => void

  // Command palette (Wave 5)
  commandPaletteOpen: boolean
  toggleCommandPalette: () => void
}

export const useAdminStore = create<AdminStore>()((set) => ({
  // Sidebar
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

  // Section + filters
  activeSection: 'fleet',
  activeFilters: {},
  setSection: (section) =>
    set({ activeSection: section, activeFilters: {}, selectedItems: [] }),
  setFilter: (key, value) =>
    set((s) => ({ activeFilters: { ...s.activeFilters, [key]: value } })),
  clearFilters: () => set({ activeFilters: {} }),

  // Selection
  selectedItems: [],
  toggleItem: (id) =>
    set((s) => ({
      selectedItems: s.selectedItems.includes(id)
        ? s.selectedItems.filter((i) => i !== id)
        : [...s.selectedItems, id],
    })),
  selectAll: (ids) => set({ selectedItems: ids }),
  clearSelection: () => set({ selectedItems: [] }),

  // Intelligence panel
  intelligencePanelOpen: false,
  toggleIntelligencePanel: () => set((s) => ({ intelligencePanelOpen: !s.intelligencePanelOpen })),
  setIntelligencePanelOpen: (v) => set({ intelligencePanelOpen: v }),

  // Command palette
  commandPaletteOpen: false,
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
}))
