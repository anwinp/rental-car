'use client'

import type { AgentCard } from '@rcm/shared-types'
import { ReservationDetailCard } from './ReservationDetailCard'
import { CancellationPreviewCard } from './CancellationPreviewCard'
import { DateModificationCard } from './DateModificationCard'
import { BookingSearchForm } from './BookingSearchForm'
import { VehicleClassListCard } from './VehicleClassListCard'
import { QuoteSummaryCard } from './QuoteSummaryCard'
import { GuestDetailsForm } from './GuestDetailsForm'
import { BookingConfirmedCard } from './BookingConfirmedCard'
import { DamageComparisonCard } from './DamageComparisonCard'
import { ReceiptBreakdownCard } from './ReceiptBreakdownCard'

interface Props {
  card: AgentCard
  onChipClick?: (chip: string) => void
}

export function AgentCardRenderer({ card, onChipClick }: Props) {
  switch (card.kind) {
    case 'reservation_detail':
      return <ReservationDetailCard data={card.data} onAction={onChipClick} />
    case 'cancellation_preview':
      return <CancellationPreviewCard data={card.data} onAction={onChipClick} />
    case 'date_modification':
      return <DateModificationCard data={card.data} onAction={onChipClick} />
    case 'booking_search_form':
      return <BookingSearchForm data={card.data} onAction={onChipClick} />
    case 'vehicle_class_list':
      return <VehicleClassListCard data={card.data} onAction={onChipClick} />
    case 'quote_summary':
      return <QuoteSummaryCard data={card.data} onAction={onChipClick} />
    case 'guest_details_form':
      return <GuestDetailsForm data={card.data} onAction={onChipClick} />
    case 'booking_confirmed':
      return <BookingConfirmedCard data={card.data} onAction={onChipClick} />
    case 'damage_comparison':
      return <DamageComparisonCard data={card.data} onAction={onChipClick} />
    case 'receipt_breakdown':
      return <ReceiptBreakdownCard data={card.data} onAction={onChipClick} />
    default:
      return (
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid var(--agent-chip-border)',
          borderRadius: 8,
          padding: '12px 14px',
          fontSize: 13,
          color: 'var(--p-text-2)',
        }}>
          {JSON.stringify(card.data, null, 2)}
        </div>
      )
  }
}
