# 11 — ज्ञात समस्याएँ, जोखिम और बिना पुष्टि वाले हिस्से (Known Issues)

> स्रोत: `requirements/foundation/planning-tracking.md` और `requirements/sessions-and-join/planning-tracking.md`
> के "Issues & updates" sections, और दोनों `requirement.md` के change log। तारीख़: 2026-10-24 तक।
> यहाँ सिर्फ वे items हैं जो **अभी भी खुले** हैं। जो हल हो चुके हैं वे अंत में अलग तालिका में हैं।

**Severity का मतलब:** HIGH = demo या security पर सीधा असर · MEDIUM = ज़रूरी, पर रोकने वाला नहीं · LOW = सफ़ाई/छोटा।

## 1. खुली समस्याएँ और जोखिम

| # | Severity | समस्या | असर | अगला कदम | स्रोत |
|---|---|---|---|---|---|
| 1 | MEDIUM–HIGH | **npm dependency vulnerabilities:** `npm install` ने 9 बताईं (5 moderate, 2 high, 2 critical)। Sessions phase में "3 high/critical advisories remain" लिखा है। | Supply-chain/security जोखिम; CTO review में सवाल उठ सकता है | `npm audit` चलाकर review करें। `npm audit fix --force` major versions बदलता है — developer की मंज़ूरी चाहिए। पहली release से पहले फ़ैसला। | Foundation Issues; Sessions Issues "RISK" |
| 2 | MEDIUM | **असली browser में cookie का व्यवहार (ports 3000 ↔ 4000)** — सिर्फ HTTP client से जाँचा गया। | अगर कोई browser cookie न भेजे तो refresh पर पहचान खो जाएगी (success criterion 3) | Chrome/Firefox/Edge में दो अलग browsers से manual demo flow चलाएँ; DevTools में `Set-Cookie` और भेजी गई cookie देखें | Sessions Issues "NOT VERIFIED"; requirement Risks |
| 3 | MEDIUM | **In-memory rate limiter सिर्फ एक process के लिए** | कई API instances पर हर instance की अलग गिनती → असली limit कई गुना; restart पर reset | Multi-instance demo (Phase 17 "two-instance script") से पहले Redis store पर विचार | Sessions plan decision 7 |
| 4 | MEDIUM | **Presenter key खो जाए** और cookie भी न हो | Session में वापस आने का कोई रास्ता नहीं | UI में साफ़ चेतावनी + copy button पहले से है; clipboard copy (पुष्टि नहीं हुई) | Sessions requirement Risks |
| 5 | LOW | **`TRUST_PROXY` असली proxy के पीछे जाँचा नहीं गया** | गलत setting पर `req.ip` गलत → rate limit सब users पर एक साथ, या bypass | Deploy/proxy setup के समय test करें | Sessions Issues "NOT VERIFIED" |
| 6 | LOW | **Join बनाम end race test की coverage** — शायद हर run में दोनों रास्ते (rejected और accepted) न चलें | Race bug छिप सकता है (code fix पहले से है) | बाद में deterministic ordering वाला test जोड़ें | Sessions Issues |
| 7 | LOW | **एक browser के दो tabs एक साथ join** करें तो दो participants बन सकते हैं | Joined count एक ज़्यादा दिख सकता है | जानबूझकर स्वीकार किया; ज़रूरत हो तो enhancement | Sessions plan Concurrency |
| 8 | LOW | **docs/04 error-code list अधूरी** — `FORBIDDEN_ORIGIN`, `PRESENTER_AUTH_REQUIRED`, `PARTICIPANT_AUTH_REQUIRED`, `INVALID_PRESENTER_KEY`, `SESSION_NOT_OPEN`, `ROOM_CODE_UNAVAILABLE` नहीं हैं | Docs और code में फ़र्क; नए developer को भ्रम | `docs/04-api-contract.md` में codes जोड़ें (सिर्फ docs) | Sessions Issues |
| 9 | LOW | **`REDIS_REQUIRED` अब भी docs में** (`docs/02` §5, `docs/09`) — यह flag code में नहीं है | Docs गुमराह करते हैं | दोनों docs से हटाएँ (D5, doc-only) | Foundation Decisions D5, Issues |
| 10 | LOW | **Next build warning:** "Next.js plugin was not detected in your ESLint configuration" | Build पास है; Next-specific lint rules नहीं चल रहे | ESLint config में Next plugin जोड़ें — नया package हो तो पहले मंज़ूरी | Sessions Issues |
| 11 | LOW | **Prettier ने docs/04 की tables re-align कीं** (सिर्फ whitespace, feature के बाहर के sections भी) | Diff में शोर | न चाहिए तो revert करें | Sessions Issues |
| 12 | LOW | **Root पर एक `dev` script नहीं** — `dev:api` और `dev:web` अलग; दो terminals चाहिए | थोड़ी असुविधा | `concurrently` approved नहीं; जैसा है वैसा ठीक, या package की मंज़ूरी लें | Foundation Issues |
| 13 | LOW | **हर नए database पर `npm run db:migrate` ज़रूरी** — वरना API 500 देता है | Fresh setup पर पहली बार भ्रम | `docs/09` setup steps में साफ़ रखें | Sessions Issues (resolved, पर दोहराने वाला कदम) |
| 14 | LOW (by design) | **Socket.IO adapter का दूसरा Redis client अभी नहीं बना** | अभी कोई असर नहीं | Phase 4 `realtime-backbone` में जोड़ें | Foundation Issues "DEFERRED" |

## 2. बिना पुष्टि वाले हिस्से (Not Verified)

ये चीज़ें code में हैं, पर किसी ने चलाकर नहीं देखीं। इन्हें "काम करता है" नहीं कहना चाहिए।

| # | क्या | क्यों ज़रूरी | कैसे जाँचें | स्रोत |
|---|---|---|---|---|
| V1 | SIGINT/SIGTERM पर graceful shutdown (सिर्फ `taskkill /F` से test हुआ) | Connections ठीक से बंद हों; 10 s timeout के बाद force exit | Terminal में `Ctrl+C`, logs में "shutting down" देखें | Foundation Issues |
| V2 | `unhandledRejection` / `uncaughtException` handlers | Crash पर साफ़ fatal log + exit | Test या manual trigger | Foundation Issues, task 5 |
| V3 | Hanging dependency पर `/ready` का 1 s timeout | `/ready` अटके नहीं | ऐसी dependency simulate करें जो जवाब न दे | Foundation Issues |
| V4 | Migration revert (foundation criterion 7) — foundation में सिर्फ no-op के रूप में | — | Phase 3 में `up/down/up` test DB पर verify हो चुका है | Foundation requirement change log; Sessions task 3 |
| V5 | Ports 3000/4000 पर असली browser cookies | ऊपर #2 देखें | Manual browser flow | Sessions Issues |
| V6 | `TRUST_PROXY` असली proxy के पीछे | ऊपर #5 | Proxy setup | Sessions Issues |
| V7 | Clipboard copy (presenter key / join link) | Presenter key बचाने में मदद | Browser में copy button | Sessions Issues |
| V8 | End-confirmation click flow browser में | गलती से end न हो | Browser में "End session" → confirm | Sessions Issues |
| V9 | Shared schemas (task 1) — executor ने requirement पढ़े बिना spec से बनाए; "to review" | Schema नियम requirement से मेल खाएँ | Requirement की behaviours तालिका से `shared/src/schemas/sessions.ts` मिलाएँ | Sessions task 1 notes |

## 3. हल हो चुके items (संदर्भ के लिए)

| Severity | क्या था | कैसे हल हुआ |
|---|---|---|
| HIGH | Machine पर Node/npm/Docker नहीं थे | Node 24, Docker 29 install; सारी verification चली |
| HIGH | Join बनाम end race: `ended_at` participant के `created_at` से पहले हो सकता था | `endSession` अब locking transaction में, lock के बाद `ended_at` set |
| MEDIUM | `.env` किसी script से पढ़ा नहीं जाता था | `process.loadEnvFile` (`api/src/server.ts`, `sequelize-cli.cjs`) |
| MEDIUM | Room-code alphabet 32 लिखा था, असल में 31 | Requirement और plan ठीक किए; code `shared` से पढ़ता है |
| MEDIUM | Dev database migrate नहीं था → 500 | `npm run db:migrate` चलाया |
| LOW | Redis connect hang (Windows dual-stack) | Initial connect पर 10 s cap (`api/src/db/redis.ts`) |
| LOW | `pino-http` approved नहीं | छोटा custom request logger |

## 4. Demo से पहले प्राथमिकता (सुझाव)

1. **#1** — `npm audit` review और फ़ैसला (developer की मंज़ूरी)।
2. **#2 / V5, V7, V8** — असली browser में पूरा demo flow एक बार चलाएँ।
3. **V1** — `Ctrl+C` shutdown देखें।
4. **#8, #9** — docs drift ठीक करें (सिर्फ docs, जल्दी)।
