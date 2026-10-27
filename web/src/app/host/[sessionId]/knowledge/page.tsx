'use client'

import { useParams } from 'next/navigation'
import { KnowledgeDocumentList } from '../../../../components/knowledge/KnowledgeDocumentList'
import { KnowledgeResults } from '../../../../components/knowledge/KnowledgeResults'
import { KnowledgeSearch } from '../../../../components/knowledge/KnowledgeSearch'
import { KnowledgeUpload } from '../../../../components/knowledge/KnowledgeUpload'
import { HostNav } from '../../../../components/sessions/HostNav'
import { PresenterKeyNeeded } from '../../../../components/sessions/PresenterKeyNeeded'
import { AppShell } from '../../../../components/ui/AppShell'
import { Card } from '../../../../components/ui/Card'
import { ErrorState } from '../../../../components/ui/ErrorState'
import { LoadingState } from '../../../../components/ui/LoadingState'
import { useKnowledge } from '../../../../hooks/use-knowledge'

export default function KnowledgePage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const knowledge = useKnowledge(sessionId)
  const loadFailed = !knowledge.loading && knowledge.error !== null && knowledge.documents.length === 0

  return (
    <AppShell
      width="wide"
      title={
        <h1 className="min-w-0 truncate text-base font-semibold tracking-tight sm:text-lg">Knowledge base</h1>
      }
      nav={<HostNav sessionId={sessionId} current="knowledge" />}
    >
      {knowledge.authRequired ? (
        <PresenterKeyNeeded sessionId={sessionId} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <Card title="Files" headingLevel={2}>
            <KnowledgeUpload disabled={knowledge.pending} onUpload={knowledge.upload} />
            {knowledge.loading ? (
              <LoadingState label="Loading files…" rows={1} />
            ) : loadFailed ? (
              <ErrorState message={knowledge.error ?? ''} onRetry={knowledge.retry} />
            ) : (
              <>
                {knowledge.error ? <ErrorState message={knowledge.error} /> : null}
                <KnowledgeDocumentList
                  documents={knowledge.documents}
                  pending={knowledge.pending}
                  onRemove={knowledge.remove}
                />
              </>
            )}
          </Card>
          <Card title="Search" headingLevel={2}>
            <KnowledgeSearch pending={knowledge.pending} onSearch={knowledge.search} />
            <KnowledgeResults results={knowledge.results} />
          </Card>
        </div>
      )}
    </AppShell>
  )
}
