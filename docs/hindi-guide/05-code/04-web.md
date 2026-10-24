# 05-04 — Web (`web/`) का कोड, file-दर-file

यह guide `web/` workspace की हर file को आसान हिंदी में समझाती है। Line numbers इस commit की हालत
(branch `feat/mvp-1`, 2026-10-24) के हिसाब से हैं। कोड बदलने पर line numbers खिसक सकते हैं।

> नियम: जहाँ कोई बात कोड पढ़कर पक्की नहीं हुई, वहाँ "(पुष्टि नहीं हुई)" लिखा है।

---

## 0. पहले तीन बुनियादी बातें

### 0.1 Server Component बनाम Client Component

Next.js App Router में हर component पहले से **Server Component** होता है — यानी वह server पर
(या build के समय) HTML बनाता है, और उसका JavaScript browser में नहीं भेजा जाता।

**Client Component** वह है जिसकी file की पहली line `'use client'` हो। उसका JavaScript browser में
जाता है और वहाँ "hydrate" (HTML में जान डालना — click, typing वगैरह चालू करना) होता है।

`'use client'` तभी चाहिए जब component को इनमें से कुछ चाहिए (`.claude/rules/frontend-react.md`):
- **state** — `useState` (जैसे form में typed text, pending flag)
- **effects** — `useEffect` (जैसे page खुलते ही API call)
- **browser APIs** — `navigator.clipboard`, `fetch` with cookies, `useRouter`, `useParams`, `useSearchParams`
- event handlers — `onClick`, `onSubmit`

एक बात ध्यान रखें: जिस component में `'use client'` नहीं है, पर जिसे कोई Client Component import करता है,
वह भी browser में चलता है (client boundary के अंदर आ जाता है)। `StatusMessage.tsx` और
`ParticipantView.tsx` इसी तरह के हैं — उनमें directive नहीं है, क्योंकि उन्हें state नहीं चाहिए।

### 0.2 इस project में कौन क्या है

| File | प्रकार | क्यों |
|---|---|---|
| `src/app/layout.tsx` | Server | सिर्फ़ `<html>`/`<body>` और metadata |
| `src/app/page.tsx` | Server | सिर्फ़ दो `Link` — कोई state नहीं |
| `src/app/join/page.tsx` | Server | सिर्फ़ `Suspense` wrapper; अंदर `JoinClient` client है |
| `src/app/create/page.tsx` | Client | `useState`, API call |
| `src/app/join/JoinClient.tsx` | Client | `useSearchParams`, `useRouter`, `useState` |
| `src/app/presenter/[sessionId]/page.tsx` | Client | `useParams`, `useEffect`, `useState` |
| `src/app/session/[roomCode]/page.tsx` | Client | `useParams` |
| `src/app/session/[roomCode]/ParticipantClient.tsx` | Client | `useEffect`, `useState` |
| `components/sessions/CreateForm.tsx`, `JoinForm.tsx`, `PresenterKeyForm.tsx`, `PresenterDashboard.tsx`, `SessionCreatedPanel.tsx` | Client | form state / clipboard / confirm state |
| `components/sessions/StatusMessage.tsx`, `ParticipantView.tsx` | directive नहीं | सिर्फ़ props दिखाते हैं |

### 0.3 सारा data browser से क्यों आता है?

Login का सबूत **HttpOnly cookies** हैं (`lp_presenter_<id>`, `lp_participant_<id>`), जो API (port 4000) ने
`Path=/api` पर set की हैं (`requirements/sessions-and-join/planning-tracking.md` line 25-26)। ये cookies
browser के पास हैं, Next server के पास नहीं। इसलिए presenter और participant pages browser से
`fetch(..., { credentials: 'include' })` करते हैं, और इसीलिए वे Client Components हैं।

---

## 1. Config files

### 1.1 `web/package.json`

| Line | क्या है | मतलब |
|---|---|---|
| 2 | `"name": "@livepulse/web"` | workspace का नाम; `npm run <x> -w web` से चलता है |
| 6 | `"dev": "next dev --port 3000"` | dev server, port 3000 |
| 7 | `"build": "next build"` | production build (`.next/`) |
| 8 | `"start": "next start --port 3000"` | build किया हुआ app चलाना |
| 9 | `"typecheck": "tsc --noEmit"` | सिर्फ़ type check, कोई output file नहीं |
| 10 | `"test": "vitest run"` | सारे tests एक बार चलाकर ख़त्म |

Dependencies (line 18-27):
- `@livepulse/shared` (`*`) — monorepo का अपना package; Zod schemas और types यहीं से आते हैं।
- `zod` — runtime validation (data को चलते समय जाँचना)। `config.ts` और API client में।
- `next`, `react`, `react-dom` — framework (Next 15, React 19)।
- `tailwindcss`, `@tailwindcss/postcss`, `postcss` — Tailwind v4 CSS।

DevDependencies (line 12-17): `@types/react`, `@types/react-dom`, `typescript`, `vitest`।
Testing Library या jsdom **नहीं** है — tests `react-dom/server` से HTML string बनाकर जाँचते हैं
(foundation plan decision 8, `requirements/foundation/planning-tracking.md` line 32)।

### 1.2 `web/tsconfig.json`

- line 2: `extends: "../tsconfig.base.json"` — root की strict settings।
- line 4: `jsx: "preserve"` — JSX को Next ख़ुद compile करता है।
- line 7: `moduleResolution: "bundler"` — webpack जैसे bundler वाला import resolution।
- line 8: `noEmit: true` — `tsc` सिर्फ़ जाँचता है।
- line 12-16: `next` plugin — editor में Next-specific type मदद।
- line 19: `include` में `src`, `next.config.ts`, `vitest.config.ts`, `.next/types/**/*.ts`।

### 1.3 `web/next.config.ts`

- line 4: `reactStrictMode: true` — dev में effects दो बार चलाकर गड़बड़ पकड़ता है।
- line 6: `transpilePackages: ['@livepulse/shared']` — **क्यों?** `shared/package.json` का `main`
  सीधा `src/index.ts` है (TypeScript source, कोई build step नहीं)। Next default रूप से `node_modules`
  के packages को compile नहीं करता; यह line उसे बताती है कि `shared` का TS भी compile करो।
  (Tracking task 10: "`next.config.ts` got `transpilePackages` for shared"।)
- line 7-11: `webpack` → `config.resolve.extensionAlias` — **क्यों?** `shared/` NodeNext style में
  sibling files को `'./x.js'` लिखकर import करता है, जबकि disk पर file `x.ts` है। यह alias webpack से
  कहता है: `.js` माँगा जाए तो पहले `.ts`, फिर `.tsx`, फिर `.js` ढूँढो (line 9)। इसके बिना build में
  "module not found" आता (पुष्टि नहीं हुई — बिना alias build चलाकर नहीं देखा)।

### 1.4 `web/postcss.config.mjs`

line 1: सिर्फ़ एक plugin `@tailwindcss/postcss`। Tailwind v4 में अलग `tailwind.config.js` ज़रूरी नहीं।

### 1.5 `web/vitest.config.ts`

- line 4: `esbuild: { jsx: 'automatic' }` — test files में `import React` लिखे बिना JSX चले।
- line 6: `environment: 'node'` — कोई browser/jsdom नहीं। इसलिए tests सिर्फ़ static HTML देखते हैं;
  click, typing, `useEffect` नहीं चलते।
- line 7: `src/**/*.test.ts` और `src/**/*.test.tsx` tests माने जाते हैं।

---

## 2. App shell

### 2.1 `web/src/app/layout.tsx` (Server)

- line 3: `import './globals.css'` — Tailwind CSS हर page पर।
- line 5-7: `metadata.title = 'LivePulse'` — browser tab का title।
- line 9-15: `RootLayout` — `<html lang="en">` और `<body>` पर base classes (line 12)।

### 2.2 `web/src/app/globals.css`

line 1: `@import 'tailwindcss';` — Tailwind v4 का नया तरीका। v3 के तीन `@tailwind base/components/utilities`
directives की जगह अब एक `@import` काफ़ी है।

### 2.3 `web/src/app/page.tsx` — landing (Server)

- line 1: `next/link` का `Link`।
- line 3-4: `linkClass` — दोनों links का एक ही style, साफ़ दिखने वाला focus outline (keyboard users के लिए)।
- line 12-14: `/create` → "Create a session"।
- line 15-17: `/join` → "Join a session"।
- States: कोई data नहीं, इसलिए loading/error/empty state की ज़रूरत नहीं।

Test `page.test.tsx` (2 tests): line 8-11 product name और `<h1>`; line 13-17 दोनों असली `<a href>`
links हैं और कहीं `disabled` नहीं (foundation में ये disabled buttons थे)।

---

## 3. `web/src/lib/config.ts` — API का address

- line 3-7: `apiUrlSchema` — Zod से जाँच: valid URL हो (line 5), `http://` या `https://` से शुरू हो
  (line 6), आख़िर में `/` न हो (line 7; वरना `//api/...` बनता)।
- line 10-20: `resolveApiBaseUrl(raw, nodeEnv)`:
  - line 11-12: value ख़ाली/undefined हो तो — production में `undefined` (यानी error), बाक़ी हर env में
    **dev default** `http://localhost:4000`।
  - line 13-18: जाँच fail हो तो `Error` — message में सिर्फ़ variable का नाम और उदाहरण, असली value नहीं।
  - Export सिर्फ़ tests के लिए है (comment line 9)।
- line 22: **क्यों `process.env.NEXT_PUBLIC_API_URL` सीधा लिखा है?** Next build के समय
  `NEXT_PUBLIC_*` values को code में "inline" (सीधा text से बदलना) तभी करता है जब property सीधे
  लिखी हो। `process.env[name]` जैसा dynamic access browser में `undefined` देगा।
- line 23-27: `next build` के दौरान (`NEXT_PHASE === 'phase-production-build'`) env को `'development'`
  मान लिया जाता है, ताकि **build को API env की ज़रूरत न पड़े** (foundation edge case, tracking line 72)।
  Trade-off: अगर production build में `NEXT_PUBLIC_API_URL` भूल गए, तो bundle में localhost default
  चला जाएगा, build fail नहीं होगा (पुष्टि नहीं हुई — production bundle की जाँच नहीं की)।
- `NEXT_PUBLIC_*` browser तक पहुँचता है, इसलिए यह **public** है — इसमें कभी secret न रखें।

Test `config.test.ts` (5 tests): dev default (line 5-7), दी गई URL (line 9-11), `ftp://` और
"not a url" मना (line 13-16), trailing slash मना (line 18-20), production में value ज़रूरी (line 22-24)।

---

## 4. `web/src/lib/api/sessions.ts` — typed API client

यह file पूरे web का अकेला रास्ता है API तक। **कभी throw नहीं करती** — हर नतीजा एक object लौटाती है।

### 4.1 Result का type — discriminated union

line 17-19:
```ts
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string; fields?: Record<string, string> }
```
"Discriminated union" का मतलब: `ok` field देखकर TypeScript ख़ुद समझ जाता है कि कौन सी shape है।
`if (result.ok)` के अंदर `result.data` मिलता है, `else` में `status/code/message`। Pages को
`try/catch` नहीं लिखना पड़ता।

### 4.2 `request()` का बहाव (line 58-101)

1. **fetch** (line 65-70): `credentials: 'include'` (line 67) — cross-origin (3000 → 4000) request में भी
   cookies भेजो और `Set-Cookie` मानो। इसके बिना presenter/participant cookie काम नहीं करती।
   Headers में `Content-Type: application/json` (line 68)। Body सिर्फ़ तब जब दी गई हो (line 69)।
2. **Network error** (line 71-74): fetch ही fail (server बंद, internet नहीं) → `status: 0`,
   `code: 'NETWORK_ERROR'`, सादा message (line 21)। Error का cause (URL, headers) जानबूझकर log नहीं होता।
3. **204 No Content** (line 76): `presenterAccess` के लिए schema `null` है; 204 → `{ ok: true, data: undefined }`।
4. **JSON पढ़ना** (line 78-83): body JSON न हो (जैसे proxy का HTML 502) → `INTERNAL_ERROR`, throw नहीं।
5. **Envelope parsing** (line 85-99):
   - Success (`2xx`): `successEnvelope(schema)` से `{ success: true, data }` जाँचा जाता है (line 86)।
     Shape ग़लत → नीचे line 100 पर `INTERNAL_ERROR`। यानी server ने कुछ अजीब भेजा तो UI उस पर भरोसा नहीं करता।
   - Error (non-2xx): `errorEnvelope` से `{ success: false, error: { code, message, details } }` (line 89-91)।
     `code` और `message` सीधे आगे जाते हैं। `fields` सिर्फ़ `VALIDATION_ERROR` पर (line 96)।
6. **Fallback** (line 100): बाक़ी हर अनजानी हालत → `INTERNAL_ERROR`, "Something went wrong..."।

### 4.3 `extractFields` (line 32-56)

Validation errors के `details` दो shapes में आ सकते हैं — array `[{ path | field, message }]` (line 39-45)
या object `{ field: message }` / `{ fields: {...} }` / `{ fieldErrors: {...} }` (line 46-54)। हर field का
सिर्फ़ पहला message रखा जाता है (line 37)। कुछ न मिले तो `undefined` (line 55)।

### 4.4 Public functions (line 103-130)

| Function | Method + path | Success data |
|---|---|---|
| `createSession` (105) | `POST /api/sessions` | `CreatedSession` (key सहित) |
| `getPublicSession` (108) | `GET /api/sessions/by-code/:code` | `PublicSession` |
| `joinSession` (111) | `POST /api/sessions/by-code/:code/join` | `ParticipantMe` |
| `getParticipantMe` (117) | `GET /api/sessions/by-code/:code/participant-me` | `ParticipantMe` |
| `getPresenterSession` (120) | `GET /api/sessions/:id` | `PresenterSession` |
| `presenterAccess` (123) | `POST /api/sessions/:id/presenter-access` | `undefined` (204) |
| `endSession` (129) | `POST /api/sessions/:id/end` | `PresenterSession` |

Room code और session id हमेशा `encodeURIComponent` से (line 103, 121) — URL में कुछ भी अजीब न घुसे।
Presenter key सिर्फ़ POST body में जाती है (line 126), URL में कभी नहीं।
नोट: `getPublicSession` अभी किसी page में इस्तेमाल नहीं होता (Grep से `web/src` में दूसरी जगह नहीं मिला)।

### 4.5 Test `sessions.test.ts` (8 tests)

`fetch` को `vi.stubGlobal` से नकली बनाया गया (line 7-11), हर test के बाद हटाया (line 21)।
- line 24-30: हर request में `credentials: 'include'` और JSON header।
- line 32-36: create का success, key सहित।
- line 38-57: `VALIDATION_ERROR` → `fields.title`।
- line 59-72: `SESSION_NOT_OPEN` code आगे जाता है।
- line 74-85: fetch throw करे → `NETWORK_ERROR`, status 0, सादा message।
- line 87-91: HTML body वाला 502 → `INTERNAL_ERROR`, throw नहीं।
- line 93-97: success पर ग़लत shape → `INTERNAL_ERROR`।
- line 99-104: 204 presenter access → `{ ok: true, data: undefined }` और सही URL।

---

## 5. Components (`web/src/components/sessions/`)

सारे components "presentational" हैं — data props से लेते हैं, API ख़ुद नहीं बुलाते
(सिवाय clipboard के)। API calls pages करते हैं। इसीलिए इन्हें static HTML से test करना आसान है।

### 5.1 `StatusMessage.tsx` (directive नहीं)

- line 4: `kind: 'error' | 'success' | 'info'`।
- line 14: text prefix "Error: ", "Success: ", "Note: " — **रंग पर निर्भर नहीं** (accessibility; comment line 16)।
- line 20-21: error पर `role="alert"` + `aria-live="assertive"` (screen reader तुरंत बोले);
  बाक़ी पर `role="status"` + `polite`।

### 5.2 `CreateForm.tsx` (Client — line 1)

- line 7-13 props: `pending`, `error` (ऊपर वाला message), `fieldErrors` (server से), `onSubmit`।
- line 19-21 state: title, description, client-side errors।
- line 22: `errors = { ...fieldErrors, ...clientErrors }` — client error, server error पर भारी।
- line 24-41 submit: shared `createSessionBodySchema` से जाँच (line 26); ख़ाली description → `undefined`
  (line 28); हर field का पहला issue (line 32-35, `??=`)। सही हो तो `onSubmit(parsed.data)`।
  यह जाँच सिर्फ़ UX है; असली जाँच API करता है।
- line 44: `noValidate` — browser के अपने popups बंद, हमारे messages दिखें।
- line 47-66: label `for="title"`, `maxLength={80}`, `aria-invalid` और `aria-describedby="title-error"`।
- line 68-88: description, `maxLength={500}`।
- line 89-95: `pending` में button disabled और text "Creating…"।

### 5.3 `SessionCreatedPanel.tsx` (Client — line 1)

- **Key सिर्फ़ एक बार**: line 52 चेतावनी "This presenter key is shown once. Save it now."; key सिर्फ़
  `<code>` text में (line 71)। Comment line 45: key कभी link, URL या browser storage में नहीं।
  **कोई `localStorage`/`sessionStorage` नहीं** — page refresh पर key गायब, और यही चाहा गया है।
- line 76-81: इकलौता link `/presenter/<sessionId>` — उसमें key नहीं। Presenter cookie create के समय ही
  set हो चुकी है, इसलिए dashboard सीधा खुलना चाहिए।
- `CopyButton` (line 13-43) — **copy fallback**:
  - line 17-19: `navigator.clipboard` न हो (पुराना browser, या non-HTTPS non-localhost) → "Copy is not available...
    Select the text and copy it manually."
  - line 21-26: `writeText` fail हो → "Could not copy..."।
  - line 38: नतीजा `role="status"` `aria-live="polite"` में।

### 5.4 `JoinForm.tsx` (Client — line 1)

- line 16-27 `joinErrorText`: `SESSION_NOT_OPEN` → "This session is not open for joining...",
  `RATE_LIMITED` → "Too many attempts...", `NETWORK_ERROR` → client का message, बाक़ी → server message।
- line 33: room code की शुरुआती value `initialRoomCode` (link से आई)।
- line 38-55: `roomCodeSchema` (trim + uppercase + 31-अक्षर alphabet + 6 लंबाई) और `displayNameSchema`
  (trim, 1-30) से जाँच।
- line 73: typing करते ही uppercase।
- line 69-71: `maxLength={6}`, `autoComplete="off"`, `autoCapitalize="characters"`।
- line 107-113: pending में disabled, "Joining…"।
- यही form participant page पर भी reuse होता है (§6.5)।

### 5.5 `PresenterKeyForm.tsx` (Client — line 1)

- line 46: `type="password"` — key screen पर छिपी रहे (पास बैठे लोग या screen-share में न दिखे)।
- line 48-49: `autoComplete="off"`, `spellCheck={false}` — browser key याद न करे/spell-check service को न भेजे।
- line 32: submit पर `trim()` — paste में आए spaces हटें।
- line 12-25 `presenterKeyErrorText` — **`INVALID_PRESENTER_KEY` mapping**: line 18-21 पर
  `INVALID_PRESENTER_KEY`, `UNAUTHORIZED` और `VALIDATION_ERROR` तीनों का एक ही message
  "That presenter key is not valid."। इससे यह पता नहीं चलता कि key छोटी थी या ग़लत।
  (Tracking task 12: "`INVALID_PRESENTER_KEY` now mapped explicitly (main session)"।)
  `RATE_LIMITED` → "Too many attempts..." (line 14-15)।
- Client-side length जाँच नहीं है; server `presenterKeySchema` (20-100) से जाँचता है।

### 5.6 `PresenterDashboard.tsx` (Client — line 1)

- line 20: `ended = session.status === 'ENDED'`।
- line 34-37: title और badge "Live"/"Ended" — शब्द में, सिर्फ़ रंग से नहीं।
- line 39: description `whitespace-pre-wrap` में **text** की तरह — React escape करता है, HTML नहीं चलता।
- line 44: room code बड़ा, `select-all`।
- line 22-29 + 51-63: join link copy; fail पर "Could not copy automatically. Select the link and copy it."
  (`navigator.clipboard` न हो तो `TypeError` भी इसी `catch` में जाता है।)
- line 66-68: **joined count wording** — "N people have joined"। "online" नहीं लिखा, क्योंकि यह
  आज तक join करने वालों की गिनती है, अभी जुड़े लोगों की नहीं (realtime presence अगली phase में)।
  छोटी बात: 1 होने पर भी "1 people have joined" दिखेगा।
  यह गिनती अपने-आप update नहीं होती; page reload पर नई आती है।
- line 72-103: **end confirm** — पहले सिर्फ़ "End session" (line 94-102)। Click पर `confirming = true`,
  फिर "End this session? Nobody will be able to join afterwards." + "Confirm"/"Cancel" (line 73-92)।
  Ended होने पर कोई control नहीं (line 72)। Pending में Confirm disabled, "Ending…" (line 78-82)।
- Key यहाँ कहीं नहीं दिखती (test line 49-52)।

### 5.7 `ParticipantView.tsx` (directive नहीं)

- line 9: `ended`।
- line 13-16: title और badge — "Live" या "This session has ended"।
- line 18-20: "Joined as <name>" — name React text है, escape होता है।
- line 21-28: ended → info message; वरना "You are in this session." और "Live polls and questions will appear
  here in a later release."।

### 5.8 Component tests

**`sessions-components.test.tsx` (10 tests)**
- CreateForm: labelled inputs (line 10-15), pending में disabled (17-20), field error का `aria-describedby`
  और `role="alert"` (22-34)।
- SessionCreatedPanel: key HTML में ठीक एक बार (line 47 — `split` से 2 टुकड़े), किसी `href` में key नहीं,
  इकलौता href presenter page (51-54), room code और join link दिखते हैं (56-59)।
- JoinForm: room code prefill (63-66), `SESSION_NOT_OPEN` text (68-78), network message (80-91),
  pending में disabled (93-96)।

**`presenter-components.test.tsx` (8 tests)**
- Dashboard: "people have joined", कहीं "online" नहीं (line 21-26); description `<b>` escape होकर
  `&lt;b&gt;` (28-32); ended पर message और "End session" गायब (34-40); confirm शुरू में छिपा (42-47);
  `presenterKey` कहीं नहीं (49-52)।
- KeyForm: label, `autocomplete="off"`, कोई पहले से भरी value नहीं (56-61); `UNAUTHORIZED` → "That
  presenter key is not valid." (63-68); `RATE_LIMITED` + pending → message और disabled (70-76)।
  नोट: `INVALID_PRESENTER_KEY` code वाला अलग test नहीं है — mapping उसी `case` group में है जिसे
  `UNAUTHORIZED` test छूता है।

**`participant-view.test.tsx` (2 tests)** — name/title/"You are in this session." (line 12-17);
ended पर message और "You are in this session." नहीं (19-25)।

Web tests का कुल जोड़: 2 + 5 + 8 + 10 + 8 + 2 = **35** (tracking line 189 में दर्ज "web 35 pass" से मेल)।

---

## 6. Pages और उनके states

हर data view को loading / error / empty / success संभालना है (`.claude/rules/frontend-react.md`)।
इस feature में "empty" का मतलब ज़्यादातर "session नहीं मिला" या "अभी join नहीं किया" है — कोई list नहीं है।

### 6.1 `/create` — `web/src/app/create/page.tsx` (Client — line 1)

- line 10-14 state: `pending`, `error`, `fieldErrors`, `created`।
- line 13-14: बनी हुई session (key सहित) **सिर्फ़ memory में** — URL या storage में नहीं।
- line 16-32 submit: `createSession` → success पर `created` set; failure पर `fields` और message।
  `RATE_LIMITED` पर अपना message "Too many sessions created..." (line 28-29)।

| State | कैसे दिखता है |
|---|---|
| Loading | पहले से कोई data load नहीं होता; submit के दौरान button "Creating…" और disabled |
| Error | form के ऊपर `StatusMessage` error; field errors inputs के नीचे |
| Empty | ख़ाली form (शुरुआती हालत) |
| Success | form की जगह `SessionCreatedPanel` (line 37-38) |

### 6.2 `/join` — `join/page.tsx` (Server) + `JoinClient.tsx` (Client)

- `page.tsx` line 8-10: `<Suspense fallback={<p role="status">Loading…</p>}>` में `JoinClient`।
  **क्यों Suspense?** Next 15 में `useSearchParams()` वाला client component static pre-render के समय
  query string नहीं जानता; बिना Suspense boundary के `next build` error देता है ("useSearchParams() should
  be wrapped in a suspense boundary")। Suspense से page का बाक़ी हिस्सा static बनता है और form browser में
  भरता है। (Build इस बनावट के साथ pass हुआ — tracking task 11; बिना Suspense वाला error ख़ुद नहीं देखा,
  पुष्टि नहीं हुई।)
- `JoinClient.tsx` line 10-13 `sanitiseCode`: `?code=` को `roomCodeSchema` से जाँचो; ग़लत हो तो चुपचाप `''`
  (comment line 9) — ग़लत code कभी दिखाया नहीं जाता।
- line 17: `useSearchParams().get('code')`।
- line 22-34: `joinSession` → success पर `router.push('/session/<roomCode>')` (line 28)। Success पर
  `pending` वापस false नहीं होता, ताकि navigation तक button disabled रहे। Failure पर error + fields।

| State | कैसे दिखता है |
|---|---|
| Loading | Suspense fallback "Loading…"; submit पर "Joining…" |
| Error | `joinErrorText` से message (not open, rate limit, network, validation) |
| Empty | ख़ाली form, या link से prefilled room code |
| Success | `/session/<code>` पर redirect |

### 6.3 `/presenter/[sessionId]` — `presenter/[sessionId]/page.tsx` (Client — line 1)

- line 11-16: `View` discriminated union — `loading | needsKey | notFound | error | ready`।
- line 19: `useParams` से `sessionId`।
- line 25-32 `load()`: `getPresenterSession` →
  - ok → `ready` (dashboard)
  - **401 → `needsKey`** (cookie नहीं या ग़लत → key form)
  - 404 → `notFound`
  - बाक़ी → `error`
- line 34-36: page खुलते ही `load()`।
- line 38-49 `handleKey`: comment line 38 — **key state में नहीं रखी जाती**; सीधे `presenterAccess` को।
  204 पर API presenter cookie set करता है, फिर `load()` दोबारा → dashboard। Fail पर `keyError`
  (सिर्फ़ code + message, key नहीं)। Key का text सिर्फ़ `PresenterKeyForm` के input state में रहता है।
- line 51-58 `handleEnd`: `endSession` → नया session data (`ENDED`) से dashboard; fail पर `endError`।

बहाव: **401 → key form → (204 + cookie) → dashboard**।

| State | कैसे दिखता है |
|---|---|
| Loading | "Loading…" `role="status"` (line 62) |
| Needs key (एक तरह का empty) | "Presenter access" + `PresenterKeyForm` (line 63-68) |
| Not found | "This session does not exist." (line 69-71) |
| Error | message + "Try again" button जो `load()` दोबारा चलाता है (line 72-85) |
| Success | `PresenterDashboard` (line 86-93); ended session भी यहीं, "Ended" के साथ |

### 6.4 `/session/[roomCode]` — `session/[roomCode]/page.tsx` (Client — line 1)

- line 7: `useParams` से `roomCode`; line 10: `.toUpperCase()` करके `ParticipantClient` को।
- यह page Server Component भी हो सकता था (params prop से); इसे client रखा गया है (पुष्टि नहीं हुई कि क्यों —
  कोड में कारण का comment नहीं है)।

### 6.5 `ParticipantClient.tsx` (Client — line 1)

- line 10-15: `View` — `loading | joined | needsJoin | notFound | error`।
- line 25-32 `load()`: `getParticipantMe(roomCode)` — cookie से पहचान वापस (refresh/नया tab) →
  ok → `joined`; 401 → `needsJoin`; 404 → `notFound`; बाक़ी → `error`।
- line 38-50 `handleJoin`: `JoinForm` से join; success पर सीधे `joined` (redirect नहीं)।
- line 52-91: `switch` से हर state का अलग UI।

| State | कैसे दिखता है |
|---|---|
| Loading | "Loading…" (line 54) |
| Needs join (empty) | "Join this session" + `JoinForm`, code prefilled (line 57-69) |
| Not found | "We could not find that session. Check the code with the presenter." (line 70-75) |
| Error | message + "Try again" (line 76-90) |
| Success | `ParticipantView` (line 56); ended session पर ended message |

---

## 7. सुरक्षा से जुड़ी बातें, एक जगह

- Presenter key: सिर्फ़ create के जवाब में एक बार, text में; कोई storage नहीं; input `type="password"`;
  URL में कभी नहीं; error messages में कभी नहीं।
- Cookies HttpOnly हैं — JavaScript उन्हें पढ़ नहीं सकता; web बस `credentials: 'include'` भेजता है।
- User का text (title, description, name) React text की तरह render होता है; `dangerouslySetInnerHTML`
  कहीं नहीं (Grep: `web/src` में नहीं मिला)।
- Client-side Zod जाँच सिर्फ़ UX है; असली authorization और validation API पर।
- `NEXT_PUBLIC_API_URL` public है।

## 8. जो इस हिस्से में verify नहीं हुआ

- असली browser में ports 3000 और 4000 के बीच cookies, clipboard copy, और end-confirm click flow
  (tracking line 176-177)। Tests सिर्फ़ static HTML जाँचते हैं; click/typing/effects नहीं।
- Pages (`create`, `join`, `presenter`, `session`) के अपने कोई tests नहीं हैं — सिर्फ़ components और
  API client के।
- Next build में "Next.js plugin was not detected in your ESLint configuration" चेतावनी (tracking line 174)।
