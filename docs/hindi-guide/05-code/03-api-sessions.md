# API Code — Sessions and Join (backend, file by file)

> यह document `sessions-and-join` stage का backend code समझाता है। हर file के लिए: **उद्देश्य (purpose)**,
> **मुख्य lines** (line numbers के साथ), **design ऐसा क्यों**, और **test कैसे होता है**।
> Line numbers इस document को लिखते समय की working copy से हैं (code अभी commit नहीं हुआ है)।
> कहानी और फ़ैसलों के लिए देखें: [`../04-stages/stage-02-sessions-and-join.md`](../04-stages/stage-02-sessions-and-join.md)।

## Request का रास्ता (एक नज़र में)

```
Browser ──HTTP──> app.ts (helmet, CORS, json)
                  └─ /api ─> sessions.routes.ts
                              origin-check → rate-limit → validate (Zod) → controller
                                                                          └─> service ──> models ──> PostgreSQL
```

---

## 1. Migration — `api/migrations/20261024034903-create-sessions-and-participants.cjs`

**उद्देश्य:** database में `sessions` और `participants` tables बनाना। Schema बदलने का यही एकमात्र रास्ता है
(`sync` नहीं)। File `.cjs` है क्योंकि `sequelize-cli` CommonJS चलाता है।

### `up` (lines 5–79)
| Lines | क्या करती हैं |
|---|---|
| 6 | पूरा `up` एक **transaction** में — बीच में कुछ fail हो तो सब rollback, आधा schema नहीं बचता। |
| 7–9 | `CREATE TYPE enum_sessions_status AS ENUM ('ACTIVE', 'ENDED')` — enum (तय values की सूची) को ख़ुद, अलग से बनाया। |
| 14–19 | `id` UUID primary key; default `gen_random_uuid()` (Postgres ख़ुद id बनाता है)। |
| 20 | `room_code CHAR(6)`, `NOT NULL`, **`unique`** — दो sessions का एक code नहीं हो सकता। |
| 21–22 | `title VARCHAR(80)` ज़रूरी; `description VARCHAR(500)` optional। |
| 23 | `presenter_key_hash CHAR(64)` unique — SHA-256 hex हमेशा 64 अक्षर का होता है; raw key कभी store नहीं होती। |
| 24–25 | `status` का type raw नाम `'enum_sessions_status'` — क्योंकि enum line 7 पर पहले से बना है (comment line 24)। Default `ACTIVE`। |
| 26 | `ended_at` nullable। |
| 27–28 | `created_at`, `updated_at` (snake_case columns)। |
| 33–39 | **CHECK constraint** `sessions_ended_at_matches_status`: `(status = 'ENDED') = (ended_at IS NOT NULL)`। मतलब: ENDED है तो `ended_at` ज़रूर भरा हो; ACTIVE है तो ख़ाली हो। दोनों हमेशा साथ चलते हैं। |
| 41–47 | **CHECK** `sessions_room_code_format`: regex `^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$` — DB ख़ुद भी गलत code ठुकराएगा, भले app में bug हो। |
| 58–64 | `session_id` FK → `sessions.id`, **`onDelete: 'CASCADE'`** (session मिटे तो उसके participants भी) और `onUpdate: 'CASCADE'`। |
| 65 | `display_name VARCHAR(30)`। Unique **नहीं** — नाम दोहराए जा सकते हैं। |
| 66 | `token_hash CHAR(64)` unique — participant की पहचान का hash। |
| 67 | `last_seen_at` ज़रूरी — आख़िरी बार कब देखा गया। |
| 74–77 | `participants_session_id_idx` index — "इस session के participants गिनो" जैसी queries तेज़। |

### `down` (lines 81–91)
| Lines | क्या करती हैं |
|---|---|
| 81–82 | चेतावनी comment: `down` **सारा data मिटाता है**; असली data पर बिना approval मत चलाओ। |
| 85–86 | पहले `participants` drop (क्योंकि वह `sessions` को refer करती है), फिर `sessions`। |
| 87 | `DROP TYPE IF EXISTS enum_sessions_status` — enum भी हटाओ, वरना अगला `up` line 7 पर fail होगा। |

**ऐसा design क्यों:** नियम (invariants) DB में हैं — unique, CHECK, FK — ताकि app का कोई bug भी गलत data न लिख सके।
Enum को explicit बनाने से `up`/`down` दोनों का नियंत्रण साफ़ रहता है।

**Test:** Task 3 में `livepulse_test` पर up → down → up चलाया गया (tracking)। `api/tests/integration/models.test.ts`:
"rejects a second session with the same room code" (line 48), "rejects an ended-at value on an active session"
(line 54, CHECK constraint), "removes a participant when its session is deleted" (line 67, CASCADE)।

---

## 2. Model — `api/src/models/session.model.ts`

**उद्देश्य:** `sessions` table का typed Sequelize model।

| Lines | क्या करती हैं |
|---|---|
| 5 | `Model<InferAttributes<Session>, InferCreationAttributes<Session>>` — TypeScript fields की class से ही types निकालता है। |
| 6, 11, 13–14 | `CreationOptional<...>` — `id`, `status`, timestamps बनाते समय देना ज़रूरी नहीं (default मिलते हैं)। |
| 11 | `status` का type `SessionStatus` shared package से — API और web एक ही type इस्तेमाल करते हैं। |
| 20 | `id` default `DataTypes.UUIDV4` (Sequelize JS में बनाता है; migration का DB default भी है)। |
| 21, 24 | `roomCode`, `presenterKeyHash` पर `unique: true` — migration से मेल। |
| 25 | `DataTypes.ENUM('ACTIVE', 'ENDED')`, default `ACTIVE`। |
| 30 | `tableName: 'sessions'`, **`underscored: true`** — JS में `roomCode`, DB में `room_code`। `timestamps: true`। |

**क्यों:** Model migration से हूबहू मेल खाता है (नियम: migration = model)। `declare` से class fields runtime पर
Sequelize के getters को नहीं ढकते।

**Test:** `models.test.ts` line 39 "saves a session with an active status and a generated id"।

## 3. Model — `api/src/models/participant.model.ts`

| Lines | क्या करती हैं |
|---|---|
| 4–12 | Fields: `id`, `sessionId`, `displayName`, `tokenHash`, `lastSeenAt`, timestamps। |
| 18 | `sessionId` UUID ज़रूरी (FK migration में है; association `index.ts` में)। |
| 20 | `tokenHash` `CHAR(64)` unique। |
| 25 | `tableName: 'participants'`, `underscored: true`। |

**Test:** `models.test.ts` line 81 "saves a participant with a token hash and last-seen time"।

## 4. `api/src/models/index.ts`

**उद्देश्य:** सारे models और associations (रिश्ते) एक जगह register करना।

| Lines | क्या करती हैं |
|---|---|
| 7 | Comment: हर Sequelize instance पर **एक बार** बुलाओ। |
| 8–10 | `initModels(sequelize)` — `{ Session, Participant }` लौटाता है, ताकि app और tests इन्हें dependency की तरह पास करें। |
| 11–12 | दोनों models init। |
| 13 | `Session.hasMany(Participant, { foreignKey: 'sessionId', onDelete: 'CASCADE' })` — एक session के कई participants; Sequelize स्तर पर भी cascade। |
| 14 | `Participant.belongsTo(Session, { foreignKey: 'sessionId' })` — उल्टी दिशा का रिश्ता। |

**क्यों:** असली cascade migration (DB FK) में है; यहाँ का `onDelete` Sequelize को वही बात बताता है ताकि दोनों
मेल खाएँ। Global singleton की जगह function — test हर run में अपना instance बना सकता है
(`tests/helpers/test-app.ts` line 27)।

---

## 5. `api/src/lib/tokens.ts`

**उद्देश्य:** secret tokens बनाना, hash करना, और सुरक्षित तुलना।

| Lines | क्या करती हैं |
|---|---|
| 1 | `node:crypto` से `createHash`, `randomBytes`, `timingSafeEqual` — कोई बाहरी package नहीं। |
| 4–6 | `generateToken()` — `randomBytes(32)` = 256 bits cryptographically secure randomness, `base64url` में (43 अक्षर; URL/cookie-safe)। |
| 8–11 | `hashToken()` — `sha256` hex (64 अक्षर)। Comment line 8: salt/stretching नहीं चाहिए क्योंकि token में 256 bits entropy है — brute force असंभव। |
| 14–19 | `safeEqualHash(a, b)` — Buffers बनाओ; लंबाई अलग हो तो `false` (line 17; लंबाई गुप्त नहीं, comment line 13); फिर `timingSafeEqual`। |

**`timingSafeEqual` क्यों:** साधारण `===` पहले अलग अक्षर पर रुक जाता है, तो जवाब का समय बताता है कि कितने अक्षर
मिले (timing attack)। `timingSafeEqual` हमेशा पूरी तुलना करता है, समय बराबर। लंबाई अलग होने पर
`timingSafeEqual` error फेंकता है — इसलिए line 17 पहले जाँचती है।

**bcrypt क्यों नहीं:** bcrypt कमज़ोर, इंसानी passwords के लिए है। यहाँ token machine-random है; plan decision 4 के
अनुसार bcrypt सिर्फ़ नया package जोड़ता, सुरक्षा नहीं।

**Test:** `api/src/lib/tokens.test.ts` — हर बार अलग token (line 5), कम से कम 43 अक्षर (line 10), hash 64 hex
(line 16), same input → same hash (line 20), बराबर hash स्वीकार/अलग ठुकराना (line 31), अलग लंबाई पर बिना throw
किए `false` (line 37)।

## 6. `api/src/lib/room-code.ts`

**उद्देश्य:** 6 अक्षरों का room code बनाना।

| Lines | क्या करती हैं |
|---|---|
| 1 | `randomInt` `node:crypto` से — `Math.random` नहीं, क्योंकि वह अनुमान लगाने योग्य (predictable) है। |
| 2 | `ROOM_CODE_ALPHABET`, `ROOM_CODE_LENGTH` shared से (`shared/src/schemas/sessions.ts` lines 4–5: `'ABCDEFGHJKMNPQRSTUVWXYZ23456789'`, 6)। |
| 5–6 | Doc: alphabet में 0, O, 1, I, L नहीं; `random(max)` को `[0, max)` का integer लौटाना है; tests के लिए **injectable**। |
| 8 | `generateRoomCode(random = (max) => randomInt(max))` — default असली crypto random; test अपना function दे सकता है। |
| 10–12 | 6 बार alphabet से एक अक्षर चुनो। |

**Alphabet:** 26 + 10 = 36 में से 5 look-alike हटाकर **31** अक्षर। 31^6 ≈ 88.7 करोड़ (~10^9) combinations।
Alphabet shared में है, इसलिए generator, Zod schema और web — तीनों एक ही सूची इस्तेमाल करते हैं (31 बनाम 32 bug
इसी से पकड़ा गया)।

**Injectable random क्यों:** test तय sequence दे सकता है और जाँच सकता है कि `random` को सही `max` (31) मिला।

**Test:** `room-code.test.ts` — कोई look-alike नहीं (line 6), shared schema स्वीकार करता है (line 12), injected
source से 6 अक्षर (line 18), random को alphabet की लंबाई के भीतर index माँगा (line 26)।

## 7. `api/src/lib/cookies.ts`

**उद्देश्य:** `cookie-parser` package के बिना Cookie header पढ़ना और `Set-Cookie` लिखना।

| Lines | क्या करती हैं |
|---|---|
| 1 | `COOKIE_NAME = /^[A-Za-z0-9_-]+$/` — सिर्फ़ सुरक्षित अक्षर। |
| 3–7 | `CookieOptions`: `maxAgeSeconds`, `path`, `secure`। |
| 10–26 | `parseCookies(header)` — `;` पर तोड़ो (line 13), पहले `=` पर नाम/value (line 15); `eq <= 0` यानी नाम नहीं → छोड़ो (line 16); **पहला नाम जीतता है** (line 18, `Object.hasOwn`); value `decodeURIComponent` (line 20); ख़राब encoding पर वह cookie छोड़ दो (lines 21–23)। |
| 29–34 | `serializeCookie(name, value, options)` — नाम regex से न मिले तो throw (line 30); `Max-Age` कम से कम 0 और integer (line 31); value `encodeURIComponent` (line 32); हमेशा **`HttpOnly; SameSite=Lax`**; `Secure` सिर्फ़ option पर (line 33)। |
| 37–39 | `clearCookie` — `Max-Age=0` से cookie हटाना। |

**हर flag क्यों:**
- **`HttpOnly`** — page की JavaScript (`document.cookie`) cookie नहीं पढ़ सकती; XSS से token चोरी कठिन।
- **`SameSite=Lax`** — दूसरी site से आए POST पर browser cookie नहीं भेजता (CSRF बचाव)। `SameSite=None` जानबूझकर support नहीं (comment line 28)।
- **`Path`** — controller `/api` देता है, तो cookie सिर्फ़ API requests पर जाती है।
- **`Secure`** — सिर्फ़ HTTPS पर भेजो; production में on (`app.ts` line 46), localhost HTTP पर off।
- **Name validation** — नाम में `;` या space से कोई extra attribute inject न कर सके। Value encode होने से भी injection रुकता है।

**Test:** `cookies.test.ts` — repeated नाम का पहला value (line 8), ख़राब encoding ignore (line 17), बिना नाम ignore
(line 21), पहले `=` के बाद सब value (line 25), HttpOnly + SameSite Lax (line 31), Secure सिर्फ़ माँगने पर
(line 37), spaces/semicolon वाले नाम ठुकराना (line 42), value injection रोकना (line 48), round-trip (line 52),
clear में Max-Age 0 (line 60)।

---

## 8. `api/src/middleware/validate.ts`

**उद्देश्य:** Zod schema से `req.body` और `req.params` जाँचना।

| Lines | क्या करती हैं |
|---|---|
| 5–6 | `toDetails` — हर Zod issue से सिर्फ़ `field` (path) और `message`। |
| 8 | Comment: details में submitted value **कभी नहीं** — ताकि गलत presenter key error में echo न हो। |
| 9–20 | `parseOrThrow` — `safeParse`; fail पर `AppError(400, 'VALIDATION_ERROR', ...)`। |
| 22–31 | `validateBody` — `req.body` को **parsed** (trimmed, uppercased) value से बदल देता है। |
| 33–42 | `validateParams` — वही `req.params` के लिए (जैसे room code trim + uppercase)। |

**क्यों:** Parsed value आगे जाने से controller को साफ़ data मिलता है — जैसे `" abc123 "` → `"ABC123"`। Error
`next(err)` से central error handler तक जाता है।

**Test:** `validate.test.ts` — field details पर value नहीं (line 27), parsed body handler तक (line 35), गलत params
पर 400 (line 41)। Integration: `sessions.test.ts` line 76, `presenter-access.test.ts` line 95 ("without echoing it")।

## 9. `api/src/middleware/rate-limit.ts`

**उद्देश्य:** एक key (IP या session) से तय समय में सीमित requests।

| Lines | क्या करती हैं |
|---|---|
| 4 | हर key का `{ count, resetAt }`। |
| 6 | `PRUNE_THRESHOLD = 10_000`। |
| 8–14 | Options: `name`, `limit`, `windowMs`, `now?` (**injectable clock**), `keyOf?`। |
| 16–17 | Comment: counters सिर्फ़ इस process में; कई instances पर Redis store चाहिए। |
| 20 | `Map` — limiter बनाने पर नया, हर limiter का अपना। |
| 24–28 | **Pruning** (छँटाई) — Map 10,000 से बड़ा हो तो expired entries हटाओ, ताकि memory अनंत न बढ़े। |
| 30 | Key = `name:` + (`keyOf(req)` या `req.ip` या `'unknown'`)। |
| 32–35 | **Fixed window** — entry नहीं या window ख़त्म → `count: 0`, `resetAt: time + windowMs`। |
| 36 | Count बढ़ाओ। |
| 38–42 | Limit पार → `Retry-After` header (सेकंड, कम से कम 1, line 39) और `429 RATE_LIMITED` "Too many attempts, try again shortly."। |

**Fixed window क्या है:** समय को टुकड़ों (जैसे 1 मिनट) में बाँटो; हर टुकड़े में N requests। सरल है; कमी यह कि
window की सीमा पर थोड़ा burst हो सकता है — prototype के लिए स्वीकार्य।

**Injectable clock क्यों:** test `now` बदलकर "1 मिनट बाद" की नक़ल कर सकता है, बिना सचमुच इंतज़ार किए।

**Test:** `rate-limit.test.ts` — limit तक अनुमति (line 24), उसके बाद 429 + Retry-After (line 30), window के बाद फिर
अनुमति (line 41), हर key अलग (line 48), expired key को नई window (line 54)। Integration:
`tests/integration/rate-limit.test.ts` lines 33, 43, 54, 77।

## 10. `api/src/middleware/origin-check.ts`

**उद्देश्य:** CSRF (दूसरी site से छुपा हुआ request) रोकना।

| Lines | क्या करती हैं |
|---|---|
| 4 | `UNSAFE_METHODS` — POST, PUT, PATCH, DELETE। |
| 6–7 | **Trade-off comment:** browsers cross-site unsafe requests पर हमेशा `Origin` भेजते हैं, तो उसकी जाँच CSRF रोकती है। `Origin` **न हो** तो अनुमति — curl और server-to-server clients चलते रहें। |
| 12 | Unsafe method + `Origin` मौजूद + allowed list में नहीं → `403 FORBIDDEN_ORIGIN` (line 13)। |

**Trade-off:** Origin न होने पर अनुमति देने का मतलब — non-browser client (curl) बिना Origin के POST कर सकता है।
यह ठीक है क्योंकि CSRF का ख़तरा browser से है, और browser cross-site POST पर Origin भेजता है। साथ में
`SameSite=Lax` cookie दूसरी परत है।

**Test:** `origin-check.test.ts` — allowed origin (line 18), unlisted POST पर 403 (line 23), unlisted GET की
अनुमति (line 29), बिना Origin की अनुमति (line 34)। Integration: `sessions.test.ts` line 86, `join.test.ts` line 169।

---

## 11. `api/src/services/sessions.service.ts`

**उद्देश्य:** session का business logic — बनाना, presenter जाँच, ख़त्म करना, DTO बनाना।

### Dependencies (lines 9–16)
- `SessionsDeps` (lines 11–14): `models` और वैकल्पिक `generateRoomCode` — test टकराव (collision) की नक़ल कर सकता है।
- `MAX_ROOM_CODE_ATTEMPTS = 5` (line 16)।

### `isRoomCodeCollision` (lines 20–27)
- Comment line 20: सिर्फ़ room-code टकराव पर retry; `presenter_key_hash` जैसा दूसरा unique violation असली error है।
- Line 22: `UniqueConstraintError` नहीं तो `false`।
- Lines 23–24: `error.fields` में `room_code`/`roomCode` हो तो `true`।
- Lines 25–26: fallback — Postgres error के `constraint` नाम में `room_code` हो।

### `createSession` — retry loop (lines 29–57)
| Lines | क्या करती हैं |
|---|---|
| 33 | Injected generator या default। |
| 34–35 | Presenter key **एक बार** बनाओ और hash करो (loop के बाहर)। |
| 37 | Comment: हर कोशिश transaction के **बाहर** एक अकेला INSERT — Postgres में transaction के अंदर error आए तो transaction "aborted" हो जाता है और अगली query नहीं चलती। |
| 38–51 | 5 बार तक: `Session.create(...)` नए code के साथ; टकराव हो तो फिर कोशिश, कोई और error हो तो throw (line 49)। |
| 47 | सफल → `{ session, presenterKey }` — raw key सिर्फ़ यहीं, response के लिए। |
| 52–56 | 5 टकराव → `500 ROOM_CODE_UNAVAILABLE` सुरक्षित संदेश के साथ। |

**क्यों unique constraint पर भरोसा:** "पहले जाँचो, फिर insert करो" में race होती है (दो requests एक साथ एक ही
code जाँच सकती हैं)। DB का unique index अंतिम फ़ैसला करता है।

### `keyMatches` (lines 59–60)
`safeEqualHash(hashToken(presenterKey), session.presenterKeyHash)` — दिए गए key का hash बनाकर timing-safe तुलना।

### `getPresenterSession` (lines 62–74)
- Line 67–68: session नहीं → 404।
- Lines 69–71: cookie नहीं या key गलत → `401 PRESENTER_AUTH_REQUIRED`।
- Line 72: `Participant.count` — dashboard की गिनती (जुड़े लोग, live नहीं)।

### `checkPresenterKey` (lines 76–88)
दूसरे device से key डालने पर: session नहीं → 404; key गलत → **`401 INVALID_PRESENTER_KEY`** (line 85)। अलग code
इसलिए कि web इसे "That presenter key is not valid." में map कर सके।

### `endSession` — transaction और lock (lines 90–108)
| Lines | क्या करती हैं |
|---|---|
| 94 | Managed transaction (`sequelize.transaction(async ...)`) — error पर अपने-आप rollback। |
| 95–96 | Comment: `FOR UPDATE` in-flight joins (`FOR SHARE`) के commit होने का इंतज़ार करता है; end time lock के **बाद** लिया जाता है। |
| 97–100 | `findByPk(..., { lock: transaction.LOCK.UPDATE, transaction })` = `SELECT ... FOR UPDATE`। |
| 101 | नहीं मिला → 404। |
| 102–105 | **Idempotent** (कितनी बार भी चलाओ, नतीजा एक): ACTIVE हो तभी `status: 'ENDED', endedAt: new Date()`; पहले से ENDED हो तो वैसा ही लौटाओ — पहला end time बचा रहता है। |

### बाक़ी helpers
- `findSessionByCode` (lines 110–114) — code से session या 404।
- `findSessionIdByCode` (lines 116–120) — सिर्फ़ `id` (`attributes: ['id']`)। Comment: code का id कभी नहीं बदलता, इसलिए transaction के बाहर पढ़ना सुरक्षित।
- **DTO mappers:** `toPublicSession` (lines 122–126) सिर्फ़ `title, status, roomCode` — कोई id, hash नहीं (behaviour 10)। `buildJoinUrl` (lines 128–129) `${webOrigin}/join?code=...`। `toPresenterSession` (lines 131–144) — id, title, description, roomCode, joinUrl, status, `endedAt` ISO string या `null` (line 142), participantCount; **`presenterKeyHash` कभी नहीं**।

**Test:** `tests/integration/sessions-service.test.ts` — key plain text में store नहीं (line 49), collision retry
(line 58), 5 टकराव पर safe error (line 70), दो एक साथ creates अलग codes के साथ (line 83), दो बार end पर पहला
समय वही (line 97), गलत key पर कुछ न बताना (line 108)।

---

## 12. `api/src/services/participants.service.ts`

**उद्देश्य:** join और "मैं कौन हूँ" (participant-me)।

### `joinSession` (lines 11–50)
| Lines | क्या करती हैं |
|---|---|
| 16 | पूरा join एक transaction में। |
| 17–22 | `Session.findOne({ where: { roomCode }, lock: transaction.LOCK.SHARE, transaction })` = `SELECT ... FOR SHARE`। Comment: ending (UPDATE, जिसे row lock चाहिए) इस join के commit/rollback तक रुकेगा। |
| 23–26 | Unknown **और** ended दोनों पर एक ही जवाब `404 SESSION_NOT_OPEN` — `session?.status !== 'ACTIVE'` दोनों मामले पकड़ता है (behaviour 7)। |
| 28–36 | **Existing token path:** cookie में token हो → hash से participant खोजो (उसी transaction में); अगर उसी session का है तो पुराना लौटाओ, `token: null`, `created: false` (controller 200 देगा)। दूसरे session का token हो तो चुपचाप नया participant बनता है। |
| 38–47 | नया token, participant create `{ transaction }` के साथ; DB में सिर्फ़ `tokenHash`। |
| 48 | `{ participant, session, token, created: true }` — raw token सिर्फ़ cookie के लिए। |

**`FOR SHARE` क्यों, `FOR UPDATE` क्यों नहीं:** कई joins एक साथ `FOR SHARE` पकड़ सकते हैं (एक-दूसरे को नहीं रोकते),
लेकिन `FOR UPDATE` (end) उन सब के ख़त्म होने तक रुकता है।

### `getParticipantMe` (lines 52–68)
- Lines 58–59: session नहीं → 404।
- Line 60: token नहीं → `401 PARTICIPANT_AUTH_REQUIRED`।
- Lines 62–63: hash से participant; उसका `sessionId` इस session से न मिले → 401 (दूसरे session की cookie नहीं चलेगी, behaviour 8)।
- Lines 65–66: `lastSeenAt` अपडेट, सिर्फ़ वही field save।
- Ended session पर भी participant-me काम करता है और status `ENDED` दिखाता है (plan edge case)।

`toPublicParticipant` (lines 70–72) — सिर्फ़ `displayName`।

### Join बनाम End race — एक आसान timeline

मान लो session ACTIVE है। Asha join कर रही है और उसी पल presenter "End" दबाता है।

**सही design के साथ (अभी का code):**
```
समय   Join transaction (Asha)                 End transaction (Presenter)
t1    BEGIN; SELECT ... FOR SHARE  → ACTIVE
t2                                            BEGIN; SELECT ... FOR UPDATE  → रुको (Asha का lock)
t3    INSERT participant (created_at = t3)
t4    COMMIT  → lock छूटा
t5                                            lock मिला; status = ACTIVE
t6                                            endedAt = new Date() = t6;  UPDATE; COMMIT
```
नतीजा: Asha जुड़ गई, और `ended_at (t6) >= created_at (t3)` — रिकॉर्ड सही कहानी बताता है।

**उल्टा क्रम:** अगर End पहले lock ले (t1 पर `FOR UPDATE`), तो Asha का `FOR SHARE` रुकेगा; End commit होने के बाद
Asha को status `ENDED` दिखेगा → `404 SESSION_NOT_OPEN`, कोई participant नहीं बनेगा।

**पुराना bug (जो race test ने पकड़ा):** पहले end का समय lock मिलने से **पहले** तय हो जाता था — जैसे t2 पर।
तब `ended_at = t2` लेकिन participant का `created_at = t3` — session "ख़त्म" होने के **बाद** कोई जुड़ा दिखता था।
Fix: end time lock के बाद (t6) लिया जाता है (`sessions.service.ts` lines 96, 104)।

**Test:** `tests/integration/participants-service.test.ts` — token plain text में नहीं (line 47), ended पर वही संदेश
(line 64), existing token पर वही participant (line 85), दूसरे session का token ठुकराया (line 105), refresh पर
पहचान (line 130), दो browsers एक साथ (line 148), **race test** (lines 161–183): 10 बार join और end एक साथ
(`Promise.all`); join ठुकराया गया तो count 0 होना चाहिए, स्वीकार हुआ तो `endedAt >= participant.createdAt`।
सीमा: हर run में दोनों रास्ते छूए जाते हैं — इसकी पुष्टि नहीं हुई (tracking issue)।

---

## 13. `api/src/controllers/sessions.controller.ts`

**उद्देश्य:** HTTP ↔ service — cookies पढ़ना/लिखना, status codes, response envelope `{ success: true, data }`।

| Lines | क्या करती हैं |
|---|---|
| 19–24 | Deps: `sequelize`, `models`, `webOrigin`, `secureCookies`। |
| 26 | `COOKIE_MAX_AGE_SECONDS = 7 * 24 * 3600` (7 दिन)। |
| 27 | `COOKIE_PATH = '/api'`। |
| 29–30 | Cookie नाम: `lp_presenter_<sessionId>`, `lp_participant_<sessionId>` — **per-session**, तो एक browser कई sessions में अलग पहचान रख सकता है। UUID में सिर्फ़ hex और `-` हैं, जो `COOKIE_NAME` regex पास करते हैं। |
| 32–33 | `readCookie` — comment: cookie values secrets हैं, कभी log नहीं होते। |
| 36 | `param()` — params पहले ही `validateParams` से जाँचे जा चुके। |
| 44–53 | `setCookie` — `res.append('Set-Cookie', serializeCookie(...))` 7 दिन, `/api`, `secure` के साथ। |
| 55–63 | `presenterView` — presenter cookie से `getPresenterSession`, फिर presenter DTO। |
| 65–76 | `create` — session बनाओ, presenter cookie में **raw key** (line 68), response में `presenterKey` एक बार; **`201`** (line 75)। |
| 78–81 | `getByCode` — public DTO, `200`। |
| 83–98 | `join` — पहले `findSessionIdByCode` (cookie नाम के लिए id चाहिए, line 86–87); cookie हो तो `existingToken`; नया token हो तभी cookie लिखो (line 90); **`201` अगर बना, वरना `200`** (line 91)। |
| 100–112 | `participantMe` — code से session (404 अगर नहीं), फिर उसकी cookie से `getParticipantMe`। (Session दो बार पढ़ा जाता है — एक यहाँ, एक service में।) |
| 116–122 | `presenterAccess` — key जाँचो, presenter cookie लिखो, **`204`** (कोई body नहीं — key वापस नहीं भेजी जाती)। |
| 124–130 | `end` — पहले authorise (line 127, presenter cookie), फिर `endSession` (line 128), फिर ताज़ा presenter view (`200`)। |

**क्यों:** Key सिर्फ़ POST body या cookie में — कभी URL में नहीं (success criterion 10)। Authorisation हमेशा loaded
record (session) के hash से।

**Test:** `tests/integration/sessions.test.ts`, `join.test.ts`, `presenter-access.test.ts`,
`presenter-key-secrecy.test.ts` (line 42: key कभी URL, log line या error response में नहीं)।

## 14. `api/src/routes/sessions.routes.ts`

**उद्देश्य:** routes, middleware का क्रम, और limiters।

| Lines | क्या करती हैं |
|---|---|
| 16 | `codeParams` — `roomCodeSchema` (trim, uppercase, 6 अक्षर, alphabet)। |
| 17 | `idParams` — `z.string().uuid(...)`। |
| 25 | Comment: limiters हर router पर नए बनते हैं — हर app instance (और हर test) के अपने counters। |
| 26 | `createLimiter`: 10 / घंटा / IP। |
| 27–28 | `joinLimiter`: 20 / मिनट / IP — lookup और join **एक ही bucket** साझा करते हैं, ताकि किसी भी route से codes टटोलना एक ही limit में गिने। |
| 29–35 | `presenterKeyLimiter`: 10 / 15 मिनट, `keyOf: req.params.id` — **session के हिसाब से**, IP के नहीं; हमलावर कितने भी IP बदले, एक session की key पर 10 कोशिशें। |
| 37–38 | `createOriginCheck` सब routes पर; सिर्फ़ unsafe methods जाँचे जाते हैं। |

### हर route और middleware क्रम
| Line | Route | क्रम |
|---|---|---|
| 40 | `POST /sessions` | originCheck → createLimiter → validateBody → create |
| 43 | `GET /sessions/by-code/:code` | joinLimiter → validateParams → getByCode |
| 44–50 | `POST /sessions/by-code/:code/join` | originCheck → joinLimiter → validateParams → validateBody → join |
| 51 | `GET /sessions/by-code/:code/participant-me` | validateParams → participantMe (**कोई limiter नहीं**) |
| 53 | `GET /sessions/:id` | validateParams → getPresenter |
| 54–60 | `POST /sessions/:id/presenter-access` | originCheck → validateParams → presenterKeyLimiter → validateBody → presenterAccess |
| 61 | `POST /sessions/:id/end` | originCheck → validateParams → end |

**Limiter validation से पहले क्यों:** Comment line 42: limiter पहले चलता है ताकि **malformed** (ग़लत रूप वाले) codes
भी limit में गिने जाएँ — वरना हमलावर कचरा भेजकर बिना गिनती के 400 पाता रहता। Presenter-access में भी
`presenterKeyLimiter` body validation (line 58) से **पहले** है — तो ग़लत रूप वाली keys भी गिनी जाती हैं; और
integration test (line 54) दिखाता है कि limit पार होने पर **सही key भी** 429 पाती है।

**Presenter-access में `validateParams` limiter से पहले क्यों:** limiter की key `req.params.id` है; पहले uuid जाँचने
से bucket सिर्फ़ वैध session ids के लिए बनते हैं। यह कारण code comment में लिखा नहीं है (पुष्टि नहीं हुई — अनुमान)।

**Test:** `tests/integration/rate-limit.test.ts` — 429 + Retry-After (line 33), lookup और join एक limit साझा
(line 43), presenter key पर 429 सही key के साथ भी (line 54), creations पर 429 (line 77)।

## 15. `api/src/app.ts` में बदलाव

`git diff api/src/app.ts` (21 insertions, 3 deletions):

| Lines | बदलाव |
|---|---|
| 16–22 | `AppDeps` — `env` अब `Pick<Env, 'NODE_ENV' \| 'WEB_ORIGIN' \| 'TRUST_PROXY'>` (पहले पूरा `Env`); नए `sequelize` और `models`। |
| 27–28 | `app.set('trust proxy', env.TRUST_PROXY)` — सिर्फ़ reverse proxy के पीछे; तब `req.ip` (rate limiter की key) `X-Forwarded-For` से आता है। Default `false` — वरना कोई भी header बदलकर अपना IP नक़ली बना सकता। |
| 33–34 | `cors({ origin: env.WEB_ORIGIN, credentials: true })` — पहले `credentials: false`। Cookies पहचान ढोती हैं, इसलिए credentials चाहिए; सिर्फ़ explicit origin list, कभी `*` नहीं। |
| 39–48 | `/api` पर `createSessionsRouter(...)` — `allowedOrigins`, `webOrigin: env.WEB_ORIGIN[0] ?? ''`, `secureCookies: env.NODE_ENV === 'production'`। |

**क्यों deps:** `createApp` कोई global नहीं पढ़ता — test अपना Sequelize और models दे सकता है।

**Test:** `tests/integration/app.test.ts` (नई dependency पास करने के लिए बदला गया)। Proxy के पीछे `TRUST_PROXY` —
पुष्टि नहीं हुई।

---

## 16. Test helpers

### `api/tests/helpers/test-db.ts` — test DB guard
| Lines | क्या करती हैं |
|---|---|
| 1–2 | Comment: integration tests tables truncate करते हैं, तो सिर्फ़ dedicated test DB; error में setting का नाम, **value नहीं** (URL में password)। |
| 4–6 | `NODE_ENV !== 'test'` → मना। |
| 7–9 | `TEST_DATABASE_URL` नहीं → मना (`DATABASE_URL` पर कोई fallback नहीं)। |
| 10–13 | Query string हटाकर DB नाम निकालो; `_test` पर ख़त्म नहीं → मना। |

**Test:** `tests/helpers/test-db.test.ts` — lines 16, 21, 26 (dev DB ठुकराना), 32, 37 (URL/password error में नहीं)।

### `api/tests/helpers/test-app.ts`
| Lines | क्या करती हैं |
|---|---|
| 9 | `WEB_ORIGIN = 'http://localhost:3000'`। |
| 11–16 | `createTestSequelize` — guard से पास हुआ URL; `logging: false`; `underscored: true`। |
| 18 | Fake readiness (postgres/redis 'up')। |
| 20–28 | `buildTestApp` — हर call पर नया app = **नए rate-limit counters**; `TRUST_PROXY: false`; `initModels(sequelize)`। Logger default `silent`, पर test अपना logger दे सकता है (secrecy test log lines जाँचता है)। |

### `api/tests/helpers/truncate.ts`
| Lines | क्या करती हैं |
|---|---|
| 5 | `TRUNCATE TABLE participants, sessions RESTART IDENTITY CASCADE` — तय नाम, user input नहीं। |
| 9 | Call के समय फिर से guard। |
| 11–14 | **दूसरी जाँच:** connection से `SELECT current_database()`; नाम `_test` पर ख़त्म नहीं → मना। यानी गलत Sequelize instance भी असली DB नहीं मिटा सकता। |
| 16 | Truncate। |

### `api/tests/global-setup.ts`
| Lines | क्या करती हैं |
|---|---|
| 10–11 | Repo root की env file मौजूद हो तो `process.loadEnvFile` से load (पहले से set variables जीतते हैं, comment line 9)। |
| 13 | Guard — `TEST_DATABASE_URL` जाँचा। |
| 18–23 | `spawnSync('npm', ['run', 'db:migrate', '--silent'])` — `DATABASE_URL` को **test URL से बदलकर**, ताकि migration सिर्फ़ test DB पर चले; Windows पर `shell: true` (`npm.cmd` के लिए); arguments constants हैं (comment lines 16–17)। |
| 25–30 | Start न हो या exit code 0 न हो → error (सिर्फ़ exit code, कोई URL नहीं)। |
| 33–34 | `teardown` कुछ नहीं करता — schema अगले run के लिए रहता है; data हर test में truncate होता है। |

`api/vitest.integration.config.ts` इसे `globalSetup` (line 8) में लगाता है और `fileParallelism: false` (line 10) —
सब test files एक DB साझा करती हैं, तो truncation आपस में न टकराए। Script: `npm run test:integration -w api`
(`api/package.json` line 11)।

---

## 17. सार — कौन सा नियम कहाँ लागू है

| नियम | कहाँ |
|---|---|
| Unique room code | migration line 20 + retry `sessions.service.ts` 38–51 |
| ENDED ⇔ ended_at | migration CHECK lines 33–39 |
| Ended पर join नहीं | `FOR SHARE` (participants.service 17–26) + `FOR UPDATE` (sessions.service 97–105) |
| Secrets plain text में नहीं | `tokens.ts` + `*_hash` columns |
| Generic not-found | participants.service lines 23–26 |
| CSRF | `SameSite=Lax` (cookies.ts 32) + origin-check |
| Brute force | rate-limit + routes lines 26–35 |
| Public DTO में कुछ गुप्त नहीं | `toPublicSession` lines 122–126 |
