# Stage 03 — Realtime Backbone (live connection की रीढ़)

> स्रोत (source): `requirements/realtime-backbone/requirement.md`,
> `requirements/realtime-backbone/planning-tracking.md`, और असली code (`api/src/realtime/`, `api/src/shutdown.ts`,
> `api/src/db/redis.ts`, `api/src/services/readiness.service.ts`, `api/src/server.ts`,
> `shared/src/events/realtime.ts`, `web/src/realtime/`) और `api/tests/realtime/` के tests। जहाँ बात इनमें दर्ज
> नहीं है, वहाँ "(पुष्टि नहीं हुई)" लिखा है।

---

## 1. लक्ष्य — एक लाइन में

Session page खुलते ही हर screen server से **live** जुड़ी रहती है: presenter को "अभी कितने लोग जुड़े हैं" की गिनती
दिखती है, session ख़त्म होते ही हर screen तुरंत ended दिखाती है, connection टूटने पर screen ख़ुद reconnect होकर
ताज़ा state लाती है, और दो backend instances (सर्वर) एक साझा Redis से एक-दूसरे के updates पहुँचाते हैं। यह
roadmap का **Phase 4** है (`docs/08-implementation-plan.md`)।

### Git की स्थिति (commit)

सबसे नया commit `1f6937f foundation and session and join work` है (इसमें Stage 2 का काम आया)। realtime-backbone
का code **अभी commit नहीं हुआ है** — `git status` में `api/src/realtime/`, `api/src/shutdown.ts`,
`api/tests/realtime/`, `shared/src/events/`, `web/src/realtime/`, `requirements/realtime-backbone/` untracked (`??`)
हैं, और कई files modified (`M`) हैं।

---

## 2. Requirement का सार — व्यापार की भाषा में

File: `requirements/realtime-backbone/requirement.md`। ध्यान दें: इस file में Status अभी `in_progress` लिखा है
(line 5) — इसे `completed` करना tracking का बचा काम है।

### कौन इस्तेमाल करता है
- **Presenter** — live गिनती देखता है; अपने dashboard पर session का अंत देखता है।
- **Participant** — session ख़त्म होते ही ended state देखता है; टूटे connection से ख़ुद उबरता है।
- **Operator** (चलाने वाला) — देख सकता है कि साझा message channel (Redis) बंद होने से live updates degraded
  (कमज़ोर) हैं या नहीं।

### Key behaviours (मुख्य व्यवहार) 1–11

| # | व्यवहार (हिंदी में) | Notes |
|---|---|---|
| 1 | Valid session credential वाला presenter/participant जुड़ता है और session के live group में रखा जाता है | Credential = पिछले phase की वही HttpOnly cookies |
| 2 | बिना valid credential वाला connection ठुकराया जाता है | साफ़ पर generic error; session के बारे में कुछ नहीं बताया जाता |
| 3 | Connection सिर्फ़ उसी session के updates पाता है जिसकी अनुमति है | दूसरे session की id का अंदाज़ा लगाने से कुछ नहीं मिलता |
| 4 | Presenter dashboard अभी जुड़े **distinct participants** (अलग-अलग लोग) दिखाता है | एक व्यक्ति के दो tabs = 1; presenter नहीं गिना जाता |
| 5 | Participant का आख़िरी connection बंद होने पर गिनती घटती है | छोटे grace period (छूट का समय) के बाद, ताकि refresh पर गिनती न झपके |
| 6 | Session ख़त्म होते ही हर जुड़ी screen ended दिखाती है | Participants और presenter दोनों |
| 7 | Reconnect के बाद screen server से current state लाती है | Redis छूटे messages दोबारा नहीं भेजता; HTTP fetch screen ठीक करता है |
| 8 | Updates दूसरे server instance से जुड़ी screens तक पहुँचते हैं | दो servers + एक साझा Redis से जाँचा |
| 9 | साझा channel बंद हो तो server degraded live updates बताता है | Durable data पर असर नहीं; `/ready` degraded दिखाता है |
| 10 | Live updates में presenter key, cookies, tokens या DB की अंदरूनी जानकारी नहीं | सिर्फ़ वही data जो उस व्यक्ति को दिखना चाहिए |
| 11 | Server साफ़ बंद होता है: screens को reconnect करने को कहा जाता है, channel बंद होता है | एक समय सीमा के अंदर |

### User flows (उपयोग का क्रम)
1. **Presenter live गिनती देखता है** — dashboard खुला → दूसरे device से participant जुड़ा → गिनती 0 से 1 (बिना
   refresh) → participant page बंद करे → grace period के बाद 0।
2. **देखते-देखते session ख़त्म** — कई participants का page खुला → presenter End करता है → हर screen पर "This session
   has ended" तुरंत → नए join पहले की तरह ठुकराए जाते हैं।
3. **Connection टूटता और लौटता है** — फ़ोन का signal गया → screen पर "Reconnecting…" → signal लौटा → reconnect और
   current state → अगर बीच में session ख़त्म हुआ तो ended state।
4. **साझा channel का outage (बंद होना)** — Redis बंद → screens काम करती रहती हैं; dashboard पर "Live updates may be
   delayed. Refresh if numbers look wrong." → channel लौटने पर live updates फिर शुरू और screen state refetch करती है।

### Scope
- **In:** per-session authorised live connection, live participant count, live "session ended", reconnect पर नया
  snapshot endpoint, Redis से cross-instance delivery, degraded reporting, clean shutdown, client का reconnect state।
- **Out:** polls/Q&A/reactions (बाद के phases इसी backbone पर बनेंगे), live channel पर presenter commands (actions
  HTTP पर ही), छूटे messages का durable replay, accounts, production load balancer / sticky sessions।

### Success criteria (सफलता की कसौटी) 1–9
1. Valid credential वाला participant जुड़ता है, और presenter की गिनती 1 दिखाती है।
2. बिना valid credential वाला connection ठुकराया जाता है और कोई session data नहीं पाता।
3. एक participant के दो tabs = 1; एक tab बंद → 1 ही; दोनों बंद → grace period के बाद 0।
4. Presenter के end करने पर हर जुड़ी participant screen 2 seconds के अंदर ended दिखाती है।
5. टूटे connection के बाद screen reconnect होकर बिना refresh current state दिखाती है।
6. एक साझा channel पर दो instances: एक पर बना event दूसरे से जुड़े client तक पहुँचता है।
7. Channel बंद होने पर `/ready` degraded बताता है; durable actions चलते रहते हैं; channel लौटने पर live updates फिर शुरू।
8. Server रोकने पर connections और channel समय सीमा के अंदर बंद होते हैं।
9. Live messages में presenter key, cookie, token या DB detail नहीं (हर message type जाँचकर)।

---

## 3. स्पष्टीकरण (clarification) के सवाल और जवाब

Requirement का change log (line 145): *"Created and confirmed (Redis outage keeps serving degraded; count = distinct
participants; socket auth = session cookies)"*।

| # | सवाल | जवाब (developer ने चुना) | कारण |
|---|---|---|---|
| 1 | Redis बंद हो तो क्या करें? | Server **चलता रहे**, live updates degraded; sockets नहीं गिराए जाते | Durable data Postgres में है; Redis सिर्फ़ संदेशवाहक है |
| 2 | "Connected" का मतलब? | **Distinct participants**, खुले tabs नहीं | गिनती audience की है, tabs की नहीं |
| 3 | Socket की पहचान (auth) कैसे? | पिछले phase की **session cookies** | Page scripts इन्हें पढ़ नहीं सकते; पिछले phase से मेल |

### Defaults जो बिना पूछे लिए गए (planning-tracking "Decisions resolved")
- **Ack shape** (client event का जवाब): बाद के phases के लिए `{ success, data | error }` (Q4)। इस phase में कोई
  client→server event नहीं, इसलिए अभी इस्तेमाल नहीं हुआ।
- **Docs update:** `docs/05` को असली design के अनुसार बदलना (Q3)।
- **Caps (सीमा):** 20 connections प्रति IP, और 500 प्रति session **प्रति instance** (Q5)।
- **Q2:** सिर्फ़ websocket transport। **Q1:** degraded/restored के लिए `session:error` ही, codes
  `REALTIME_DEGRADED` / `REALTIME_RESTORED` के साथ।
- **A3:** optional env vars `PRESENCE_GRACE_MS` (5000), `SOCKET_MAX_PER_IP` (20), `SOCKET_MAX_PER_SESSION` (500) —
  इन defaults के साथ approved माने गए।

### Approvals
- **A1 — `socket.io-client`** (web की dependency, api की devDependency, tests के लिए): approved; ^4.8.0, installed
  4.8.4। कारण: raw WebSocket Socket.IO protocol (rooms, reconnect, packets) नहीं बोलता।
- **A2 — `/ready` contract बदलाव:** Redis बंद होने पर 503 की जगह **200 `degraded`**; Postgres बंद तो अब भी 503 —
  approved।

---

## 4. Plan v1 का सार

### Architecture (ढाँचा)
- **DB: कोई बदलाव नहीं, कोई migration नहीं।** Status, `endedAt` और joined count का source of truth Postgres ही।
- **API:** नया `GET /api/sessions/:id/state` (presenter cookie) → service + `countConnected`। मौजूदा
  `POST /api/sessions/:id/end` commit के **बाद** `emitSessionEnded` बुलाता है।
- **Realtime:** उसी HTTP server पर Socket.IO, path `/api/socket.io`, सिर्फ़ websocket, Redis adapter (pub/sub =
  command client के `.duplicate()`)। Handshake `io.use` का क्रम: origin → per-IP / per-session cap → Zod auth →
  cookie check → rooms join।
- **Rooms:** `session:<id>` (सब), `presenter:<id>` (सिर्फ़ presenter sockets)।
- **Web:** `web/src/realtime/use-session-socket.ts` (एक page = एक socket) → `PresenterDashboard` / `ParticipantClient`।

### मुख्य फ़ैसले और उनके कारण
1. **गिनती `fetchSockets` से, कुछ store नहीं होता।** `io.in('session:<id>').fetchSockets()` Redis के ज़रिए **हर
   instance** से पूछता है; फिर participant sockets के distinct `socket.data.participantId` गिने जाते हैं। कोई counter
   नहीं जो बिगड़े; crash हुए instance के sockets अपने-आप गिनती से हट जाते हैं। Timeout 2000 ms
   (`PRESENCE_COUNT_TIMEOUT_MS`); fail होने पर कुछ emit नहीं होता और `/state` `connectedCount: null` लौटाता है।
2. **Grace period server पर।** Connect पर तुरंत recount (~250 ms में coalesce, यानी इकट्ठा); disconnect पर
   `PRESENCE_GRACE_MS` बाद recount (debounced)। Payload में `countedAt`, ताकि client पुरानी (out-of-order) गिनती
   छोड़ दे। ज्ञात कमी (plan में लिखी): किसी और के grace window में connect होने पर गिनती थोड़ी देर एक कम दिख सकती है।
3. **Path `/api/socket.io` क्यों:** मौजूदा cookies `Path=/api` पर हैं। Default `/socket.io` path पर browser कोई
   cookie नहीं भेजता — तब auth हो ही नहीं पाता। (`api/src/realtime/index.ts` line 12–13)
4. **सिर्फ़ websocket क्यों:** दो instances पर polling transport को sticky sessions चाहिए (scope से बाहर)। Trade-off:
   जिन networks में websocket बंद है वहाँ fallback नहीं।
5. **Rooms handshake पर क्यों:** कोई `session:join` event नहीं। Rooms middleware में CONNECT से **पहले** join होते
   हैं, इसलिए client जब `connect` पर HTTP refetch करता है, तब तक वह room में है — join और refetch के बीच कोई event
   छूट नहीं सकता। (यह docs/05 से अलग है।)
6. **Role:** presenter `auth: { role: 'presenter', sessionId }` भेजता है, server `lp_presenter_<id>` पढ़ता है।
   Participant `auth: { role: 'participant', roomCode }`; server id खोजकर `lp_participant_<id>` पढ़ता है। Zod
   discriminated union (`handshakeAuthSchema`)।
7. **Participant snapshot** मौजूदा `GET /api/sessions/by-code/:code/participant-me` से; counts सिर्फ़ presenter के लिए।
8. **Redis outage:** `/ready` 200 `status: 'degraded'`, `redis: 'down'`; sockets कभी नहीं गिराए जाते; pub client पर
   `disableOfflineQueue` (बंद Redis के समय पुराने broadcasts queue में जमा होकर बाद में न जाएँ)। Startup पर Redis न मिले
   तो अब भी fail fast।
9. **Emit कभी HTTP request fail नहीं करता** — try/catch में, commit के बाद।
10. **Shutdown का क्रम:** grace timers साफ़ → local `session:error {code:'SERVER_RESTARTING'}` → `io.close()` →
    Redis (command, pub, sub) और Sequelize बंद, 10 s सीमा में।

### Redis publish failure का असली मामला
Plan के edge case में लिखा था: *"Publish rejection while Redis is down — must not crash the process (test it)"*।
असल में पता चला कि Redis adapter broadcast को fire-and-forget से publish करता है (**बिना `.catch`**), और `io.emit`
publish पूरा होने से पहले लौट आता है — इसलिए हमारा try/catch उसे पकड़ ही नहीं सकता। Redis बंद होने पर हर broadcast
एक unhandled rejection बनता, और `server.ts` का handler unhandled rejection को fatal मानकर process बंद कर देता। हल
नीचे section 6 में (`logPublishFailures`)।

### Contracts (socket events)

| Event | दिशा | Room | Payload |
|---|---|---|---|
| `presence:count` | Server→Client | `presenter:<id>` | `{ sessionId, connected, countedAt }` |
| `session:ended` | S→C | `session:<id>` | `{ sessionId, endedAt: ISO }` |
| `session:error` | S→C | एक socket, या इस instance के सभी sockets | `{ code: 'SERVER_RESTARTING' \| 'REALTIME_DEGRADED' \| 'REALTIME_RESTORED', message }` |
| handshake refused | `connect_error` | – | `err.message` = `UNAUTHORIZED` / `FORBIDDEN_ORIGIN` / `TOO_MANY_CONNECTIONS`; unknown session, ग़लत cookie और दूसरा session — तीनों में एक जैसा `UNAUTHORIZED` |

Client→Server events: कोई नहीं (`ClientToServerEvents = Record<string, never>`)।
HTTP: `GET /api/sessions/:id/state` → 200 `{ id, title, roomCode, status, endedAt, joinedCount, connectedCount: number | null }`;
401 `PRESENTER_AUTH_REQUIRED`; 404; 400 ग़लत id।

### Impact analysis
- **Breaking:** Redis बंद पर `/ready` 503 → 200 degraded; `createApp` को `realtime` dependency चाहिए (test-app में
  noop); cookie-name helpers `lib/cookies.ts` में गए।
- **Migration:** कोई नहीं; rollback = code revert।
- **Security:** handshake पर origin **ज़रूरी** और `WEB_ORIGIN` में होना चाहिए — HTTP से सख़्त, क्योंकि cookie वाले
  sockets पर cross-site websocket hijacking का ख़तरा है; rooms सिर्फ़ verified cookie से; per-IP cap
  `handshake.address` पर (X-Forwarded-For सिर्फ़ `TRUST_PROXY` के साथ); Redis errors बिना URL के log।

---

## 5. Tasks (v1) — tracking table की असली स्थिति

**महत्वपूर्ण:** `planning-tracking.md` की Tasks table में सिर्फ़ 1–3 `verified` लिखे हैं; 4–17 अब भी `pending` दर्ज
हैं। Code और tests असल में मौजूद हैं, और इस run का verification (section 7) उन्हें छूता है — पर tracking table अपडेट
नहीं हुई। नीचे "Tracking status" वही है जो file में लिखा है।

| # | Task | Complexity | Executor | Tracking status | क्या बना (code में) |
|---|---|---|---|---|---|
| 1 | `socket.io-client` approve + install; `npm ls` | LOW | inline | verified | socket.io 4.8.4, socket.io-client 4.8.4, redis-adapter 8.3.0, redis 4.7.1 |
| 2 | Shared event contracts, handshake schema, state schema, ready `degraded` | LOW | executor-low | verified | `shared/src/events/realtime.ts`; shared 43 tests |
| 3 | Cookie-name helpers `lib/cookies.ts` में | LOW | inline | verified | typecheck 0, lint 0, unit 49 |
| 4 | Redis: pub/sub duplicates, connect/disconnect, degraded/restored hooks, pub पर offline queue बंद | HIGH | executor-high | pending | `api/src/db/redis.ts` (`adapterClients`, `onStatusChange`, `isHealthy`) |
| 5 | Readiness: Redis down → 200 degraded, Postgres down → 503 | MEDIUM | executor-medium | pending | `readiness.service.ts`, `health.routes.ts` |
| 6 | Socket auth middleware | HIGH | executor-high | pending | `api/src/realtime/socket-auth.ts` |
| 7 | Presence (fetchSockets, recount, grace timer, presenter-room emit) | HIGH | executor-high | pending | `api/src/realtime/presence.ts` |
| 8 | `createRealtime` + `emitSessionEnded` + wiring | HIGH | executor-high | pending | `api/src/realtime/index.ts`, controller |
| 9 | `GET /api/sessions/:id/state` | MEDIUM | executor-medium | pending | controller/routes/service |
| 10 | `server.ts` startup क्रम और graceful shutdown | HIGH | executor-high | pending | `server.ts`, नया `shutdown.ts` |
| 11 | Two-instance integration test | HIGH | executor-high | pending | `two-instances.test.ts` |
| 12 | Redis-outage test | HIGH | executor-high | pending | `redis-outage.test.ts` |
| 13 | हर event type पर payload secrecy test | MEDIUM | executor-medium | pending | `payload-secrecy.test.ts` |
| 14 | Web socket factory और `useSessionSocket` hook | HIGH | executor-high | pending | `web/src/realtime/*` |
| 15 | Presenter dashboard: live count, Reconnecting…, degraded banner, ended | MEDIUM | executor-medium | pending | `PresenterDashboard.tsx`, presenter page |
| 16 | Participant: ended तुरंत, Reconnecting…, refetch | MEDIUM | executor-medium | pending | `ParticipantClient.tsx`, `ParticipantView.tsx` |
| 17 | Docs (05, 02) और tracking | LOW | executor-low | pending | (docs/05, docs/02 का बदलाव `git status` में नहीं दिखता — पुष्टि नहीं हुई) |

---

## 6. Execution groups और हर group में क्या बना

| Group | Tasks | Executor | क्या बना |
|---|---|---|---|
| G1 | 1 | inline | Packages install |
| G2 | 2 | executor-low | `shared/src/events/realtime.ts`: `presenceCountSchema`, `sessionEndedSchema`, `sessionErrorSchema`, `handshakeAuthSchema`, `ServerToClientEvents`; ready status `'ready' \| 'degraded'` |
| G3 | 3 | inline | `participantCookieName` / `presenterCookieName` → `api/src/lib/cookies.ts` |
| G4 | 4 | executor-high | `createRedisClients`: command + `pub` (`disableOfflineQueue: true`) + `sub`; तीनों ready हों तभी healthy; बदलाव पर listeners को सूचना; startup पर 3 कोशिशें / 10 s timeout; `closeAll` जो ready न होने पर `quit` की जगह `disconnect` करता है (वरना shutdown अटकता) |
| G5 | 5 | executor-medium | Readiness: Redis down = degraded, transition पर एक बार log |
| G6 | 6, 7, 8 | executor-high | Socket auth, presence, `createRealtime`, `/end` के बाद emit |
| G7 | 9 | executor-medium | `/state` endpoint |
| G8 | 10, 11, 12 | executor-high | `server.ts` क्रम, `shutdown.ts`, two-instance और outage tests, `realtime-harness.ts` |
| G9 | 13 | executor-medium | Payload secrecy tests |
| G10 | 14 | executor-high | `socket.ts`, `session-socket-state.ts` (pure reducer), `use-session-socket.ts` |
| G11 | 15, 16 | executor-medium | Presenter और participant UI |
| G12 | 17 | executor-low | Docs और tracking (देखें task 17 note) |

### बीच में हुए फ़ैसले (plan से आगे)

1. **`api/src/shutdown.ts` का बनना।** Plan में shutdown `server.ts` में था। इसे अलग file `createShutdown` में निकाला
   गया ताकि test हो सके (`exit` और `timeoutMs` injectable)। क्रम: presence timers → हर local socket को
   `SERVER_RESTARTING` notice (adapter से नहीं, सीधे — ताकि Redis बंद होने पर भी जाए और दूसरे instances की screens तक
   न पहुँचे) → `realtime.close()` → Redis → database। Idempotent (दूसरी बार बुलाने पर वही promise); 10 s
   (`SHUTDOWN_TIMEOUT_MS`) से ज़्यादा लगे तो exit code 1।
2. **`logPublishFailures`** (`api/src/realtime/index.ts` line 52–70)। Adapter का `publish` बिना catch के चलता है,
   इसलिए pub client का `publish` लपेटा गया: हर rejection पर `logger.warn('live update publish failed')`। Promise वही
   लौटता है, तो जो caller await करे उसे rejection दिखता रहता है। `server.ts` (line 35) में comment है कि publish
   failures fatal handler तक नहीं पहुँचते।
3. **`REALTIME_DEGRADED` / `REALTIME_RESTORED` notice production code में।** `redis.onStatusChange` पर
   `io.local.emit('session:error', …)` — सिर्फ़ local, क्योंकि साझा channel ही तो बंद है। Restore पर client refetch
   करता है, क्योंकि outage में छूटे broadcasts Redis दोबारा नहीं भेजता। Dashboard का संदेश: "Live updates may be
   delayed. Refresh if numbers look wrong."
4. **`io.close()` HTTP server भी बंद करता है।** इसलिए shutdown में अलग `server.close()` नहीं है — वह खुले websockets
   का इंतज़ार करता रहता (`shutdown.ts` line 58)।
5. **`emit` हर successful end पर।** Controller (line 144–147) दोबारा end करने पर भी `session:ended` भेजता है — वही
   `sessionId` और **पहला** `endedAt`। Client का reducer पहले से ended होने पर इसे ignore करता है (`'ended'` case)। Test:
   "ending an ended session again repeats the same notice with the original end time"।

### Web की बातें (code से)
- `socket.ts`: path `/api/socket.io`, `transports: ['websocket']`, `withCredentials: true`, `reconnectionDelayMax: 5000`।
- Reducer: `connect` पर refetch; `io server disconnect` पर ख़ुद reconnect (Socket.IO इस case में नहीं करता); refusal
  codes पर `refused` (अंतिम, आगे retry नहीं); पुरानी `countedAt` वाली गिनती छोड़ी जाती है; server का error text कभी
  नहीं दिखाया जाता। हर incoming payload Zod से जाँचा जाता है।

---

## 7. Verification — इस run में असल में क्या चला

| Check | नतीजा |
|---|---|
| lint | 0 |
| typecheck | 0 |
| unit tests | shared 43 + api 52 + web 64 pass |
| web build | 0 (सफल) |
| prettier | 0 |
| integration (असली Postgres `livepulse_test` + असली Redis) | **110/110 pass, 21 files** |

(ये नंबर इस stage के final run से दिए गए हैं; यह document लिखते समय commands दोबारा नहीं चलाए गए।)

### Realtime tests — कौन सी file क्या साबित करती है

`api/tests/realtime/` (असली server ephemeral port पर, `socket.io-client`, असली Redis):

| File | Tests | क्या साबित करता है |
|---|---|---|
| `socket-auth.test.ts` | 6 | Presenter cookie से जुड़ना + presenter room; बिना cookie `UNAUTHORIZED`; foreign origin `FORBIDDEN_ORIGIN`; दूसरे session की cookie को unknown session जैसा ही `UNAUTHORIZED`; malformed payload echo नहीं होता; per-IP सीमा पर `TOO_MANY_CONNECTIONS` |
| `presence.test.ts` | 6 | Join के बाद 1; दो tabs = 1; एक tab बंद → 1; आख़िरी tab बंद → grace के बाद ही 0; presenter कभी नहीं गिना; count सिर्फ़ presenter room को |
| `ended-live.test.ts` | 2 | `emitSessionEnded` हर participant और presenter तक; fail emit throw नहीं करता |
| `end-emits.test.ts` | 3 | HTTP end के 2 s में दोनों को ended; failed notification end को error नहीं बनाता; दोबारा end पर वही पहला `endedAt` |
| `two-instances.test.ts` | 4 | A पर join → B वाले presenter की गिनती बदलती है; A पर end → B वाले participant तक 2 s में; B वाला presenter `/state` में A का participant गिनता है; B पर दूसरे session के socket को कुछ नहीं मिलता |
| `redis-outage.test.ts` | 4 | Channel गिरने पर screen जुड़ी रहती है; `/ready` 200 degraded और Postgres up; outage में publish fail पर crash नहीं; restore पर live updates फिर और screen refetch |
| `shutdown.test.ts` | 6 | Restarting notice बंद करने से पहले; Redis और DB समय सीमा में बंद; दूसरी बार shutdown कुछ नहीं करता; अटका step → exit 1; publish fail log होता है, process नहीं मरता; असली broadcast (pub connection बंद) unhandled नहीं रहता |
| `payload-secrecy.test.ts` | 6 | कोई live message presenter key/cookie नहीं रखता; हर documented event देखा गया; हर payload में सिर्फ़ documented fields; snapshot में hash/token नहीं; key सिर्फ़ create response में एक बार; restarting notice में सिर्फ़ documented fields |

अन्य नई integration files: `integration/readiness-states.test.ts` (4 — ready, Redis down = 200 degraded, Postgres down
= 503, URL कभी नहीं), `integration/redis-clients.test.ts` (5 — अलग pub/sub, connect के बाद ही healthy, बंद Redis पर
queue नहीं, सिर्फ़ transition पर सूचना, तीनों का disconnect), `integration/session-state.test.ts` (6 — counts, live
count न मिले तो `null` न कि 0, 401, 400, 404, key/hash नहीं)।

Unit: `shared/src/events/realtime.test.ts` (8), `web/src/realtime/use-session-socket.test.ts` (reducer — connect/refetch,
पुरानी गिनती छोड़ना, ended दो बार, restarting, server disconnect पर reconnect, refused अंतिम, degraded/restored)।

### TCP proxy से असली Redis outage
`redis-outage.test.ts` Redis container **बंद नहीं करता**। Test असली Redis के आगे एक छोटा TCP proxy
(`startRedisProxy`) खड़ा करता है और server को proxy के URL से जोड़ता है। `proxy.cut()` connections काट देता है (असली
outage जैसा — client errors, reconnecting, publish failures), और `proxy.restore()` फिर जोड़ देता है। इससे साझा Docker
Redis दूसरे tests के लिए चलता रहता है।

---

## 8. नहीं जाँचा गया (NOT VERIFIED)

1. **असली browser में live व्यवहार** — web को सिर्फ़ build और unit tests (reducer) से जाँचा; दो असली browsers में
   गिनती, ended, Reconnecting… और degraded banner नहीं देखे।
2. **Multi-instance shutdown** — एक instance बंद होने पर दूसरे की screens पर असर नहीं जाँचा।
3. **Realtime का prod-style load** — बहुत सारे connections पर व्यवहार नहीं मापा।
4. **`fetchSockets` का failure path पूरा** — `/state` में `null` का test है, पर असली adapter timeout (कोई instance न
   जवाब दे) और उस समय "कुछ emit नहीं होता" पूरा नहीं जाँचा।
5. **Per-session cap (`SOCKET_MAX_PER_SESSION`)** का कोई test नहीं।
6. **`TRUST_PROXY` / X-Forwarded-For** — socket पर कोई test नहीं।
7. **Per-IP cap का race** — एक साथ आने वाले handshakes गिने नहीं जाते (code comment, `socket-auth.ts` line 76–77), तो
   burst में cap थोड़ी देर पार हो सकता है; test नहीं।
8. **Redis startup के पहले मिलीसेकंड की adapter errors** — connect से पहले adapter का व्यवहार नहीं जाँचा।

---

## 9. Issues और जोखिम

`planning-tracking.md` का "Issues & updates" section **ख़ाली** है — वहाँ कुछ दर्ज नहीं हुआ। नीचे की बातें code, tests
और executors की रिपोर्ट (इस run के निर्देश) से हैं:

- **HIGH (सुलझा) — adapter publish बिना catch:** Redis बंद होने पर हर broadcast unhandled rejection → fatal handler से
  process बंद हो सकता था। हल: `logPublishFailures`; `shutdown.test.ts` और `redis-outage.test.ts` में जाँचा।
- **MEDIUM (सुलझा) — Redis quit पर shutdown अटकना:** ready न होने पर `QUIT` offline queue में हमेशा बैठा रहता; अब
  `disconnect` (`redis.ts` line 80–82)।
- **MEDIUM (सुलझा) — connect का अटकना:** TCP listener जो handshake का जवाब न दे, `connect()` को हमेशा रोक देता; अब
  10 s timeout (`redis.ts` line 98)।
- **MEDIUM (खुला) — tracking पीछे:** tasks 4–17 `pending` दर्ज, requirement Status `in_progress`; change log में सिर्फ़
  `plan_created`। अपडेट करना बाक़ी।
- **LOW (खुला) — docs/05 और docs/02:** task 17 इन्हें बदलना था; `git status` में इनका बदलाव नहीं दिखता (पुष्टि नहीं हुई)।
- **LOW (ज्ञात कमी) — grace window:** किसी और के grace window में connect पर गिनती थोड़ी देर एक कम।
- **LOW (trade-off) — websocket-only:** websocket रोकने वाले networks पर कोई fallback नहीं।
- **RISK — caps per instance:** per-session 500 और per-IP 20 हर instance के अपने हैं, cluster-wide नहीं।
- **RISK — पुराने npm advisories** (foundation phase से) अब भी बाक़ी।

---

## 10. अगले कदम

1. `planning-tracking.md` में tasks 4–17 की स्थिति, change log और requirement Status अपडेट करना।
2. docs/05 और docs/02 का बदलाव जाँचना/करना (task 17)।
3. दो असली browsers में flows 1–4 हाथ से देखना।
4. Commit — **आप** करेंगे (Claude नहीं)।
5. अगला stage `live-polls` (Phase 5) — शुरू करने के लिए आपकी स्पष्ट approval चाहिए; वह इसी backbone पर बनेगा।
