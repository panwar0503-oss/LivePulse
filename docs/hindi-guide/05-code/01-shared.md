# `shared/` package — code walkthrough

`shared/` वह package है जिसे `api/` और `web/` दोनों use करते हैं। इसमें **Zod schemas** (data की shape जाँचने
वाले नियम) और उनसे निकले TypeScript types रहते हैं, ताकि server और browser एक ही "contract" (अनुबंध) मानें।

Foundation stage में इसमें सिर्फ़ API envelope और health/ready schemas थे। Stage-02 ने `schemas/sessions.ts`
जोड़ा (यहाँ शामिल नहीं)।

Line numbers आज की working copy के हैं।

---

## 1. `shared/package.json`

उद्देश्य: workspace का नाम, entry point, scripts और dependencies।

| Line | Code | क्या करता है | क्यों ज़रूरी |
|---|---|---|---|
| 2 | `"name": "@livepulse/shared"` | Package का नाम | `api` इसे `import ... from '@livepulse/shared'` से लाता है (`api/package.json` line 18 में `"@livepulse/shared": "*"`); npm workspaces इसे local folder से link करते हैं |
| 4 | `"private": true` | npm registry पर publish नहीं होगा | गलती से public publish रोकता है |
| 5 | `"type": "module"` | `.js`/`.ts` files ES Modules मानी जाती हैं | पूरे repo में ESM (`import`/`export`) |
| 6–7 | `"main"` और `"types"` → `src/index.ts` | Entry point सीधे TypeScript source | Plan decision 5: `shared` को TS source की तरह use करते हैं — कोई build step नहीं |
| 8–10 | `"exports": { ".": "./src/index.ts" }` | Package का सिर्फ़ root path बाहर खुला | Modern resolution (`NodeNext`) `exports` पढ़ता है; अंदर की files सीधे import नहीं हो सकतीं |
| 12 | `"test": "vitest run"` | Tests एक बार चलाता है (watch mode नहीं) | `npm test -w shared` से चलता है |
| 13 | `"typecheck": "tsc --noEmit"` | Type errors जाँचता है, कोई JS file नहीं बनाता | Build नहीं चाहिए, सिर्फ़ जाँच |
| 16 | `"zod": "^3.23.8"` | Runtime dependency | Schemas Zod से बनते हैं |
| 18–22 | devDependencies: `@types/node`, `typescript`, `vitest` | सिर्फ़ development/test के लिए | Runtime पर ज़रूरी नहीं |

कैसे verify हुआ: foundation tracking task 2 — `npm test -w shared` 10 passed; root `npm run typecheck` exit 0।

---

## 2. `shared/tsconfig.json`

| Line | Code | मतलब |
|---|---|---|
| 2 | `"extends": "../tsconfig.base.json"` | Root की strict settings लेता है |
| 3 | `"include": ["src"]` | सिर्फ़ `src/` की files type-check होती हैं |

Root `tsconfig.base.json` की मुख्य settings (line numbers उसी file के):

| Line | Setting | क्यों |
|---|---|---|
| 3 | `"strict": true` | सभी strict checks (null safety आदि) |
| 4, 6 | `"module": "NodeNext"`, `"moduleResolution": "NodeNext"` | Node का असली ESM resolution; इसी कारण imports में `.js` extension लिखते हैं (जैसे `./schemas/api.js`) भले ही file `.ts` हो |
| 5 | `"target": "ES2022"` | Modern JS output |
| 9 | `"noUncheckedIndexedAccess": true` | `array[0]` का type `T \| undefined` होता है — बिना जाँच index access पर गलती पकड़ता है |
| 10 | `"exactOptionalPropertyTypes": false` | Optional property में `undefined` देना allowed |

---

## 3. `shared/vitest.config.ts`

| Line | Code | मतलब |
|---|---|---|
| 1 | `import { defineConfig } from 'vitest/config'` | Typed config helper |
| 5 | `environment: 'node'` | Tests Node में चलते हैं, browser (jsdom) नहीं — schemas को DOM नहीं चाहिए |

कोई `include` नहीं दिया, इसलिए Vitest के default pattern (`**/*.test.ts` आदि) से `src/schemas/api.test.ts` मिल जाता
है।

---

## 4. `shared/src/index.ts`

| Line | Code | मतलब |
|---|---|---|
| 1 | `export * from './schemas/api.js'` | Envelope और health/ready schemas बाहर export (foundation) |
| 2 | `export * from './schemas/sessions.js'` | Session schemas (**stage-02 में जोड़ी गई line**) |

क्यों: package का एक ही दरवाज़ा (`exports` में `"."`)। `.js` extension `NodeNext` resolution के कारण।

---

## 5. `shared/src/schemas/api.ts` — envelope schemas

"Envelope" (लिफ़ाफ़ा) = हर API response का बाहरी ढाँचा। Success पर `{ success: true, data }`, error पर
`{ success: false, error: {...} }` (decision D1)।

| Line | Code | क्या करता है | क्यों ज़रूरी |
|---|---|---|---|
| 1 | `import { z } from 'zod'` | Zod library | Schema बनाने के लिए |
| 3 | `export const successEnvelope = <T extends z.ZodType>(data: T) => z.object({ success: z.literal(true), data })` | एक **generic function**: कोई भी data schema दो, यह उसे `{ success: true, data }` में लपेटकर नया schema लौटाता है | हर endpoint का data अलग है, पर बाहरी shape एक। `z.literal(true)` का मतलब `success` बिल्कुल `true` ही हो |
| 5–13 | `export const errorEnvelope = z.object({...})` | Error response की shape | D1 envelope का schema |
| 6 | `success: z.literal(false)` | Error में `success` हमेशा `false` | Client एक field देखकर success/error पहचान सके |
| 8 | `code: z.string()` | Machine-readable code, जैसे `NOT_FOUND`, `NOT_READY` | Client code पर logic लिखे, message पर नहीं |
| 9 | `message: z.string()` | इंसान के पढ़ने लायक संदेश | UI में दिखाने के लिए |
| 10 | `details: z.unknown().optional()` | अतिरिक्त जानकारी, optional; type पहले से तय नहीं | जैसे `/ready` 503 में `{ postgres, redis }`। `unknown` इसलिए कि हर error का details अलग हो सकता है |
| 11 | `requestId: z.string()` | **ज़रूरी** request ID | Requirement behaviour 6: हर error में request ID, ताकि log से मिलान हो सके |
| 15 | `healthDataSchema = z.object({ status: z.literal('ok') })` | `/health` का data: सिर्फ़ `{ status: 'ok' }` | Behaviour 4: कोई version/host नहीं — schema में और कोई field ही नहीं |
| 17–20 | `readyDataSchema` | `/ready` 200 का data: `status: 'ready'` और `checks: { postgres: 'up', redis: 'up' }` | दोनों checks `z.literal('up')` हैं — यानी "ready" response में कोई dependency `down` हो ही नहीं सकती (schema स्तर पर गारंटी) |
| 22–25 | `notReadyDetailsSchema` | 503 के `details`: `postgres` और `redis` दोनों `z.enum(['up', 'down'])` | Operator जान सके कौन सी dependency गिरी है, पर कोई host/error text नहीं |
| 27–30 | `export type ErrorEnvelope = z.infer<...>` आदि | Schema से TypeScript type निकालता है | Type और runtime नियम एक ही जगह से — दो बार लिखना नहीं पड़ता। `api/src/routes/health.routes.ts` line 2 में `HealthData`, `NotReadyDetails`, `ReadyData` types use होते हैं |

### कैसे test/verify हुआ — `shared/src/schemas/api.test.ts`

कुल 10 tests (5 + 5), foundation में `npm test -w shared` → 10 passed (tracking task 2)।

| Lines | Test | क्या साबित करता है |
|---|---|---|
| 11–14 | success envelope + health data स्वीकार | सही shape pass |
| 16–19 | `success: false` वाला success envelope reject | `z.literal(true)` काम करता है |
| 21–27 | request id वाला error envelope स्वीकार | — |
| 29–35 | request id के बिना error envelope reject | `requestId` ज़रूरी है (behaviour 6) |
| 37–43 | optional `details` के साथ स्वीकार | `details` optional है |
| 47–49 | health में `status: 'degraded'` reject | सिर्फ़ `ok` |
| 51–57 | दोनों `up` वाला ready स्वीकार | — |
| 59–65 | ready में `redis: 'down'` reject | ready response में कोई dependency down नहीं हो सकती |
| 67–70 | not-ready details में `postgres: 'down'` स्वीकार | कौन सी dependency गिरी, यह बता सकते हैं |
| 72–74 | unknown state `'maybe'` reject | सिर्फ़ `up`/`down` |
