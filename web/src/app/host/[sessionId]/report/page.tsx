'use client'

import { useParams } from 'next/navigation'
import { ReportChat } from '../../../../components/report/ReportChat'
import { SessionReport } from '../../../../components/report/SessionReport'
import { HostNav } from '../../../../components/sessions/HostNav'
import { PresenterKeyNeeded } from '../../../../components/sessions/PresenterKeyNeeded'
import { AppShell } from '../../../../components/ui/AppShell'
import { useSessionReport } from '../../../../hooks/use-session-report'

export default function SessionReportPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const report = useSessionReport(sessionId)
  const authRequired = report.report === null && report.error?.code === 'PRESENTER_AUTH_REQUIRED'

  return (
    <AppShell
      width="wide"
      title={
        <h1 className="min-w-0 truncate text-base font-semibold tracking-tight sm:text-lg">Session report</h1>
      }
      nav={<HostNav sessionId={sessionId} current="report" />}
    >
      {authRequired ? (
        <PresenterKeyNeeded sessionId={sessionId} />
      ) : (
        /* Below lg the chat stacks under the report; on lg it sits beside it. */
        <div className="flex flex-col gap-6 sm:gap-8 lg:flex-row lg:items-start">
          <div className="min-w-0 lg:w-2/3">
            <SessionReport
              sessionId={sessionId}
              report={report.report}
              status={report.status}
              error={report.error}
              onRetry={report.reload}
            />
          </div>
          <div className="min-w-0 lg:w-1/3">
            <ReportChat sessionId={sessionId} />
          </div>
        </div>
      )}
    </AppShell>
  )
}
