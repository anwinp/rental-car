import { ConfirmationDetails } from './ConfirmationDetails'

interface ConfirmationPageProps {
  params: { confirmationNumber: string }
}

export default function ConfirmationPage({ params }: ConfirmationPageProps) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--p-surface)', paddingTop: 48, paddingBottom: 64 }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 20px' }}>
        <ConfirmationDetails confirmationNumber={params.confirmationNumber} />
      </div>
    </div>
  )
}
