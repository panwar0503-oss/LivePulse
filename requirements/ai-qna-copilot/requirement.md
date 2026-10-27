# Feature: AI Q&A copilot

## Metadata
- **Name**: ai-qna-copilot
- **Status**: in_progress
- **Current phase**: initial
- **Created**: 2026-10-25 · **Last updated**: 2026-10-25
- **Parent** (enhancements only): n/a

## Original request
Phase 12 of the LivePulse roadmap (`docs/08-implementation-plan.md`, `docs/10-ai-architecture.md` section 5.3): a LangGraph
Q&A copilot. Each submitted question is checked, de-duplicated, answered from the presenter's knowledge base with
citations, self-checked, and held for the presenter to approve. Live question clusters are shown to the presenter.
Questions in any language are handled. Roadmap dependencies: Q&A (phase 7) and knowledge base (phase 10).

## What it does
When an audience member asks a question, the system checks it for safety and relevance. A question that is a near
duplicate of an existing one is linked to it, and the asker is told so. Otherwise the system drafts an answer from the
presenter's uploaded documents, with citations, and checks that every claim is supported. If the documents do not
cover the question, the draft says so. The presenter reviews each draft, may edit it, and approves it. Only approved
answers are shown to the room. The presenter also sees the questions grouped by theme.

## Who uses it
- **Participant** — asks questions as today. Sees "Similar question already asked" when a duplicate is found, and sees an
  answer only after the presenter approves it.
- **Presenter** — reviews held questions and AI drafts, edits and approves answers, rejects questions, sees clusters.
- **Operator (developer)** — sets the moderation and similarity thresholds and the AI budget; checks background processing.

## User stories
1. As a participant, I want my question checked for safety so that harmful text does not reach the room.
2. As a participant, I want to be told when my question was already asked so that I can see it was heard.
3. As a presenter, I want a draft answer grounded in my materials so that answers are quick and accurate.
4. As a presenter, I want to see the evidence for a draft so that I can check it.
5. As a presenter, I want to approve or edit each answer before the room sees it so that nothing goes out unchecked.
6. As a presenter, I want to see questions grouped by theme so that I can pick the most common ones.
7. As a participant, I want to ask in my own language so that I am not limited to one language.

## Key behaviours
| # | Behaviour | Notes |
|---|---|---|
| 1 | Each question is classified as OK, toxic, spam, off-topic or personal data | Classified by the AI provider; the presenter already opted in by turning AI on |
| 2 | A question that is not OK is held for the presenter and not shown to the room | The presenter can release it or reject it |
| 3 | A question similar to an existing one is linked to it; its upvote goes to the existing question | The asker sees "Similar question already asked — upvoted it" |
| 4 | A draft answer is written only from the presenter's ready knowledge-base passages, with citations | If the materials do not cover it, the draft says "Not covered in the materials" |
| 5 | Every claim in a draft must be supported by its cited passages; an unsupported draft is retried once, then marked not covered | — |
| 6 | Each draft is held for the presenter as pending review | Nothing from a draft reaches the room until approval |
| 7 | The presenter may edit a draft before approving it | The approved text is the text shown |
| 8 | Approved answers are shown to the whole room under their question | Only approved text is ever shown |
| 9 | Questions are grouped by theme into live clusters, visible to the presenter only | Updated as new questions arrive |
| 10 | Questions in any language are answered in the language of the question | Citations stay the document's own text |
| 11 | Approvals and drafts survive a server restart | Stored in the database, not in memory |
| 12 | If AI is off, unavailable or over budget, questions are still asked, upvoted and answered by hand | Q&A keeps working as before |

## User flows
### Flow 1: Question answered
1. Participant asks a question.
2. The question appears to the presenter as "Checking…", then "Ready for a draft".
3. The presenter asks for a draft (or drafts start automatically — see assumptions).
4. The draft appears with its citations and a confidence note.
5. The presenter edits if needed and approves.
6. The approved answer appears to the room under the question.

### Flow 2: Duplicate question
1. Participant asks a question close to an existing one.
2. The participant sees "Similar question already asked — upvoted it."
3. The existing question gains the upvote; no new draft is made.

### Flow 3: Not covered
1. A draft cannot be grounded in the materials.
2. The presenter sees "Not covered in the materials" and can reject the question or write an answer by hand.

### Flow 4: Held question
1. A question is classified as toxic or personal data.
2. The presenter sees it marked for review and can release or reject it. The room never sees it unless released.

### Edge cases
- Two identical questions in the same moment → one question, one draft.
- The presenter edits a draft while the session ends → the session end cancels pending drafts; approved answers remain.
- Restart while a draft is being written → the draft is retried once, not duplicated.

## Real-time behaviour
- Room: approved answers and question status changes (including duplicate upvotes) reach everyone.
- Presenter only: moderation holds, draft status, drafts, and clusters.
- On reconnect or reload, the presenter's panel loads held questions, drafts and clusters from the server.

## Scope
**In scope**
- Moderation of each question by the AI provider, with held questions.
- Duplicate detection by meaning, linked to the existing question.
- Grounded draft answers from the knowledge base, with citations, a self-check, and one retry.
- Presenter review: edit, approve, reject, release.
- Approved answers shown to the whole room.
- Live question clusters for the presenter.
- Multilingual questions answered in their own language.

**Out of scope**
- Clusters visible to participants.
- Answers from outside the knowledge base (no general web or model knowledge).
- Automatic publishing of any draft without approval.
- Ask-your-session chat and session reports (phase 14).
- MCP actions (phase 15).

## Assumptions
1. Drafts are created automatically for each question that passes moderation and is not a duplicate. Reason: keeps the presenter's queue ready; each draft still needs approval. Proposed; the developer may prefer on-request.
2. A question with no ready knowledge base is answered "Not covered in the materials" without a model call. Reason: nothing to ground on. Proposed.
3. Moderation and drafting use the existing AI budget and the session's AI switch. Reason: consistent with the other AI features. Proposed.
4. Clusters are recomputed as questions arrive, using the local embeddings model; no new model. Reason: no new provider. Proposed.
5. Approved answers are plain text with citations; formatting is not supported. Reason: keeps the room view simple and safe. Proposed.

## Risks
- **HIGH**: An unsupported claim is shown to the room. Impact: the audience is misinformed. Mitigation: grounded drafts, a self-check, the presenter approves every answer; approved text is the only text shown.
- **HIGH**: A question's text reaches a provider without the presenter's consent. Impact: privacy. Mitigation: AI off by default per session; the switch is checked on the server before any call.
- **MEDIUM**: Moderation misses a harmful question or holds a harmless one. Impact: a wrong question reaches the room, or a good one is held. Mitigation: held questions stay visible to the presenter, who can release them.
- **MEDIUM**: A duplicate threshold merges two different questions. Impact: a question loses its own upvote path. Mitigation: a conservative threshold; the presenter can see the link.
- **MEDIUM**: Drafts increase AI cost with many questions. Impact: budget used quickly. Mitigation: the session budget; drafts are created only for questions that pass moderation and are not duplicates.
- **LOW**: Clusters are noisy with few questions. Impact: confusing labels. Mitigation: clusters shown only once there are enough questions; presenter-only.

## Non-functional requirements (user-facing)
- A question is checked and shown as ready within 10 seconds on this machine.
- An approved answer appears to the room within 2 seconds of approval.
- Nothing about moderation, drafts or clusters slows polls, word cloud or question asking for participants.

## Success criteria
1. A safe question with knowledge-base coverage gets a draft with citations, visible only to the presenter.
2. A toxic or personal-data question is held and not shown to the room; the presenter can release or reject it.
3. A near-duplicate question is linked and upvoted; no second draft is made.
4. A draft not covered by the materials says so.
5. The room sees only approved text; an edited approval shows the edited text.
6. Clusters are visible to the presenter only.
7. A question in another language gets an answer in that language.
8. With AI off or over budget, questions are still asked, upvoted and answered by hand.
9. After a restart, a held draft is kept and a pending draft is retried once.
10. Tests run with the fake provider and make no network call.

## Enhancements
| Name | Summary | Status |
|---|---|---|

## Change log
| Date | Change |
|---|---|
| 2026-10-25 | Created from the developer's answers: approved answers to the room; Claude moderation of every question; clusters presenter-only |
