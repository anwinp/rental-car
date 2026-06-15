import { Providers } from '../../providers'
import { ConfirmationDetails } from './ConfirmationDetails'

interface ConfirmationPageProps {
  params: { confirmationNumber: string }
}

export default function ConfirmationPage({ params }: ConfirmationPageProps) {
  return (
    <Providers>
      <div className="min-h-screen bg-background px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <ConfirmationDetails confirmationNumber={params.confirmationNumber} />
        </div>
      </div>
    </Providers>
  )
}
