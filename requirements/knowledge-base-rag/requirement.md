# Feature: Knowledge base and retrieval (RAG)

## Metadata
- **Name**: knowledge-base-rag
- **Status**: in_progress
- **Current phase**: initial
- **Created**: 2026-10-25 · **Last updated**: 2026-10-25
- **Parent** (enhancements only): n/a

## Original request
Phase 10 of the LivePulse roadmap (`docs/08-implementation-plan.md`): upload, chunk, embed, hybrid keyword and vector
retrieval with reranking, citations, and a knowledge page. Roadmap dependency: PDF text extraction library.

## What it does
The presenter adds documents to a session's knowledge base: PDF and plain-text files. The system extracts the text,
splits it into passages, and makes them searchable by meaning and by keyword. When the presenter asks a question, the
system returns the most relevant passages, ranked, each with its source document and location. A knowledge page lets the
presenter browse the uploaded documents and search them. Nothing from the knowledge base reaches the audience in this
phase.

## Who uses it
- **Presenter** — uploads documents, searches the knowledge base, sees results with citations, deletes documents.
- **Participant** — no access. Nothing from this feature is visible to participants.
- **Operator (developer)** — chooses the local models and limits; checks background processing.

## User stories
1. As a presenter, I want to upload my slides and notes so that the session has my material to search.
2. As a presenter, I want to search the uploaded material by question so that I find the relevant passage quickly.
3. As a presenter, I want each result to show where it came from so that I can check it before using it.
4. As a presenter, I want to see the status of each upload so that I know when it is ready to search.
5. As a presenter, I want to remove a document so that its text is no longer searchable.
6. As an operator, I want uploads limited in size and count so that processing time and storage stay bounded.

## Key behaviours
| # | Behaviour | Notes |
|---|---|---|
| 1 | The presenter can upload PDF and plain-text files | Other file types are refused with a clear message |
| 2 | Each file is limited to 10 MB and each session to 20 files | Over-limit uploads are refused before processing |
| 3 | A file's type is checked by its content, not only its name | A renamed file of another type is refused |
| 4 | Each upload shows a status: processing, ready, or failed with a plain reason | A failed upload can be removed and uploaded again |
| 5 | Text is split into passages, each with a document name and a location (page for PDF, section number for text) | Location is shown with every result |
| 6 | Search combines keyword matching and meaning matching, then reranks the combined results | The top results are shown in rank order |
| 7 | Each result shows its source document, location and passage text | Passage text is shown to the presenter only |
| 8 | A search with no relevant passage says so clearly | No result is invented |
| 9 | The knowledge page lists documents with status, size and upload time, and can search them | Presenter only |
| 10 | Deleting a document removes its passages from search at once | Deleting the session removes all its documents |
| 11 | Document text is never shown to participants, and never appears in logs | — |
| 12 | Processing runs in the background; a slow or large file does not slow polls, word cloud or Q&A | Same background runner as AI features |
| 13 | If the knowledge base or its models are unavailable, the rest of the app keeps working | Search shows a clear message |

## User flows
### Flow 1: Upload and search
1. Presenter opens the knowledge page and chooses a PDF or text file.
2. The file appears with status "Processing".
3. When the file is ready, its status changes to "Ready" without a page reload.
4. Presenter types a question in the search box.
5. The results appear in rank order, each with its document name, location and passage.

### Flow 2: Upload fails
1. Presenter uploads a file that is a scanned PDF with no text, or is corrupt.
2. The file shows "Failed" with the reason "No readable text was found" or "The file could not be read".
3. Presenter removes the file.

### Flow 3: Limit reached
1. Presenter uploads a 21st file, or a file over 10 MB.
2. The upload is refused with the limit that was exceeded; nothing is stored.

### Edge cases
- Two uploads of the same file in the same session → the second is refused as a duplicate.
- Removing a document while it is processing → processing stops and nothing is stored.
- Session ends → the knowledge base is removed and can no longer be searched.

## Real-time behaviour
- Upload status and search availability change live for the presenter only.
- On reconnect or reload, the knowledge page loads the current documents and their statuses from the server.

## Scope
**In scope**
- PDF and plain-text upload, extraction, chunking, and background processing.
- Keyword and meaning search, reranking with a local model, citations.
- Knowledge page for the presenter: list, status, search, remove.
- Per-session storage and deletion.

**Out of scope**
- Audience-facing answers or citations (later phases).
- Word, spreadsheet, image or scanned-document text (OCR).
- Question answering that writes a reply with Claude (phase 12, `ai-qna-copilot`).
- Shared knowledge bases across sessions.

## Assumptions
1. The knowledge base belongs to one session and is removed with it — reason: keeps uploaded material private to the presenter. Proposed; confirmed by the developer's answers on audience and scope.
2. The local reranker model runs on this machine like the embeddings model, one-time download — reason: no per-call cost and no document text sent to a provider. Developer chose this.
3. Embeddings reuse the ai-foundation local model and 384 dimensions — reason: one embedding space, no second model. Proposed.
4. Upload size 10 MB per file, 20 files per session — developer chose this.
5. PDF and plain text only — developer chose this.
6. Ai-foundation is complete before this feature ships; its opt-in live checks may run then — reason: this feature depends on its background runner and embeddings. Proposed.

## Risks
- **HIGH**: A malicious or oversized PDF exhausts memory or time. Impact: slow server or crash. Mitigation: size cap, page cap, extraction time limit, extraction in the background job only.
- **HIGH**: Document text carries instructions aimed at the model (prompt injection). Impact: wrong or misleading answers. Mitigation: retrieved text is data, never instructions; no action is taken from document text in this phase.
- **MEDIUM**: The PDF extraction library needs approval and may have known vulnerabilities. Impact: security exposure from parsing untrusted files. Mitigation: developer approves the package after `npm audit` review; parsing isolated to the background job.
- **MEDIUM**: The reranker model download is large. Impact: slow first use. Mitigation: download once, status shown, tests use the fake.
- **LOW**: Scanned PDFs have no text. Impact: a failed upload. Mitigation: clear "No readable text" reason; OCR is out of scope.

## Non-functional requirements (user-facing)
- A 10 MB text-heavy PDF becomes searchable within 60 seconds on this machine.
- Search returns results within 2 seconds for a session with 20 files.
- Upload status changes reach the presenter within 2 seconds.
- Nothing about document processing slows the audience's polls, word cloud or Q&A.

## Success criteria
1. A presenter uploads a PDF and a text file; both show "Ready" and are searchable.
2. A file over 10 MB, a 21st file, or a file of another type is refused with the matching message; nothing is stored.
3. A renamed non-PDF file is refused.
4. A search returns passages in rank order, each with document name, location and text.
5. A search with no relevant passage says so and invents no result.
6. Removing a document removes its results from search immediately.
7. A participant cannot see or search the knowledge base; a presenter of another session cannot either.
8. Document text does not appear in logs or in any participant event.
9. Polls, word cloud and Q&A keep working during a large upload.
10. Tests run without network and without the real reranker model (fake used).

## Enhancements
| Name | Summary | Status |
|---|---|---|

## Change log
| Date | Change |
|---|---|
| 2026-10-25 | Created from the developer's answers (PDF and text; presenter only; local reranker; 10 MB and 20 files). Developer said "continue" after the clarification report. PDF library not yet approved. |
