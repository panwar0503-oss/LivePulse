# 06 — अगला फ़ीचर (stage) कैसे जोड़ें

यह गाइड step-by-step बताती है कि LivePulse में नया फ़ीचर (stage / phase) कैसे जोड़ा जाता है।
असली उदाहरण दो पूरे हो चुके फ़ीचर से लिए गए हैं:

- `requirements/foundation/` — Phase 2, प्रोजेक्ट का ढाँचा (status `completed`)
- `requirements/sessions-and-join/` — Phase 3, session बनाना और join करना (status `completed`)

Phase की सूची `docs/08-implementation-plan.md` में है, और हर phase की copy-paste prompt लाइन `docs/11-phase-prompts.md` में।

> नियम: `CLAUDE.md` के अनुसार नया phase **आपकी साफ़ approval** के बिना शुरू नहीं होता।

---

## पूरा flow एक नज़र में

```
/requirement <name>   →  requirement.md (business भाषा)   →  आप confirm करें
/execute <name>       →  planner → planning-tracking.md    →  APPROVAL GATE (आप approve करें)
                      →  executor groups → हर group के बाद verify → tracking + change log
                      →  final checks → status completed
docs/hindi-guide/     →  stage-NN-<name>.md (code walkthrough)
/pre-commit-check     →  आप (human) commit करें
```

Requirement status का क्रम (`requirements/README.md`):
`clarifying → planning → approved → in_progress → completed | failed`

---

## Step 1 — `/requirement <name>`

```
/requirement live-polls <फ़ीचर का raw विवरण>
```

`.claude/commands/requirement.md` के अनुसार क्या होता है:

1. **Name:** पहला argument kebab-case नाम है। न दिया हो तो Claude पूछेगा, खुद नाम नहीं बनाएगा।
   अगर `requirements/<name>/` पहले से है, तो वह रुककर `/enhance <name>` सुझाएगा।
2. **Raw request:** बाकी arguments जैसे के तैसे (verbatim) लिए जाते हैं; खाली हों तो विवरण माँगा जाएगा।
3. **Clarify:** `requirement-clarifier` skill लोड होती है। Claude सिर्फ़ सच में अस्पष्ट सवाल पूछता है, सब एक ही
   message में। सवाल इन बातों पर होते हैं:
   - **Roles** — host, participant, anonymous?
   - **Scope** — कौन से pages/endpoints, MVP बनाम बाद में
   - **UX** — happy path, empty state, errors, mobile browser
   - **Data & state** — क्या store होगा, कितने समय, कौन देख सकता है
   - **Real-time** — क्या live update होगा, देर से आने वाला या reconnect करने वाला क्या देखेगा
   - **Integrity** — duplicate submissions, limits, closing/expiry नियम
   - **Constraints** — नए dependencies/services (approval चाहिए), accessibility, privacy
   साथ में assumptions (मान्यताएँ), in/out scope, risks, success criteria प्रस्तावित होते हैं।
4. **Confirm:** Claude रिपोर्ट दिखाकर **रुकता है**, जब तक आप confirm या बदलाव न करें।
5. **Write:** `requirements/_templates/requirement.md` से `requirements/<name>/requirement.md` बनता है —
   status `planning`, आज की तारीख का change-log entry। सिर्फ़ business भाषा: कोई code, file path या component नहीं।
6. **Report:** फ़ाइल का path और अगला कदम `/execute <name>`।

यह command code नहीं बदल सकता — इसमें `disallowed-tools: Edit, NotebookEdit` है।

### `requirement.md` का structure (template से)

| Section | क्या लिखते हैं |
|---|---|
| Metadata | Name, Status, Current phase, Created / Last updated, Parent (सिर्फ़ enhancements) |
| Original request | developer के शब्द, verbatim |
| What it does | एक पैराग्राफ़, सरल भाषा |
| Who uses it | roles (Host, Participant…) |
| User stories | "As a <role>, I want … so that …" |
| Key behaviours | तालिका: व्यवहार + नियम |
| User flows | step-by-step flows |
| Real-time behaviour | क्या live होता है, किसके लिए, reconnect पर क्या दिखता है |
| Scope | In scope / Out of scope |
| Assumptions | मान्यताएँ + कारण |
| Risks | HIGH / MEDIUM / LOW |
| Non-functional requirements | user को दिखने वाली (जैसे "1 सेकंड में update") |
| Success criteria | user को दिखने वाली, testable शर्तें |
| Enhancements | बाद के हिस्सों की तालिका |
| Change log | तारीख + बदलाव |

**असली उदाहरण:** `requirements/sessions-and-join/requirement.md` में "Who uses it" में Presenter, Participant,
Visitor हैं; 6 user stories हैं; 4 flows (session बनाना, join करना, दूसरे device से लौटना, session ख़त्म करना)
और एक "Edge cases" खंड है। `requirements/foundation/requirement.md` में roles Developer (evaluator) और Operator हैं,
क्योंकि उस phase में user के लिए कोई फ़ीचर नहीं था।

---

## Step 2 — `/execute <name>`

```
/execute live-polls
```

`.claude/commands/execute.md` के पाँच भाग:

### 2.1 Context लोड करना
- `requirement.md` पढ़ा जाता है। न हो या status `clarifying` हो, तो पहले `/requirement` flow।
- `implementation-order` skill हमेशा; `integration-data-contracts` अगर फ़ीचर DB → API → web पार करता है;
  layer skills (`backend-patterns`, `frontend-patterns`, `realtime-patterns`, `testing-patterns`) सिर्फ़ ज़रूरी layers के लिए।

### 2.2 Plan — `planner` agent
- बड़े फ़ीचर (3+ files, schema change, auth, या real-time) के लिए `planner` agent (model `opus`, read-only) plan बनाता है।
  छोटे फ़ीचर का plan inline (main session खुद) बनता है।
- Planner फ़ाइल नहीं लिखता; main session plan को `requirements/<name>/planning-tracking.md` में template से लिखता है।
- Plan में होता है: Architecture, Key decisions, Contracts (HTTP + socket), Files (risk के साथ),
  Impact analysis (breaking changes, migrations/rollback, concurrency, security, testing), और Tasks तालिका।

### 2.3 Executor चुनने का नियम

हर task को **complexity** और **executor** मिलता है:

| Complexity | किस तरह का काम | Executor | Model |
|---|---|---|---|
| **LOW** | boilerplate, renames, config, types | `executor-low` | haiku |
| **MEDIUM** | standard CRUD, मौजूदा code के tests, simple components | `executor-medium` | sonnet |
| **HIGH** | auth, authorization, transactions/concurrency, migration design, socket rooms | `executor-high` | opus |
| **tiny** (< ~20 lines) | बहुत छोटा काम | `inline` (main session खुद) | — |

लगातार tasks जिनका executor एक ही है, उन्हें एक **group** में एक agent call से चलाया जाता है। Agent को exact task rows,
file paths, contracts और acceptance criteria दिए जाते हैं, ताकि वह फिर से खोजबीन न करे।

**असली उदाहरण — sessions-and-join के Execution groups:**

| Group | Tasks | Executor |
|---|---|---|
| G1 | 1 (shared schemas) | executor-medium |
| G2 | 2, 3 (env/test-DB guard, migration) | executor-high |
| G3 | 4 (models) | executor-medium |
| G4 | 5 (tokens, room-code, cookies libs) | executor-high |
| G5 | 6 (middleware) | executor-medium |
| G6 | 7, 8, 9 (services, routes) | executor-high |
| G7 | 10, 11, 12 (web) | executor-medium |
| G8 | 13 (docs) | executor-low |
| G9 | 14 (दो-browser check) | inline |

**foundation के groups:** A (1–3) executor-low · B (4) executor-medium · C (5–6) executor-high ·
D (7–8) executor-medium · E (9) executor-medium · F (10) inline।

### 2.4 Approval gate (मंज़ूरी का दरवाज़ा)
- Claude छोटा summary (tasks तालिका + risks) दिखाकर **रुकता है**, जब तक आप साफ़ approval न दें।
- नया dependency, paid service या destructive migration **अलग से** approval माँगता है।

**असली उदाहरण:** sessions-and-join में "Approvals needed" खंड था:
A1 — कोई नया package नहीं; A2 — `livepulse_test` test database बनाना; A3 — destructive `down` migration।
फिर "Decisions (resolved 2026-10-24)" में फ़ैसले लिखे गए (जैसे room code से join, कोई नया package नहीं,
`down` migration सिर्फ़ test DB पर)। foundation में D1–D5 decisions थे (जैसे D2 — कौन से extra packages approved)।

### 2.5 Execute (approval के बाद)
- Requirement status → `in_progress`।
- Tasks क्रम से; हर task/group के बाद verify, फिर task row का status और एक change-log लाइन।
- Executor fail हो या नतीजा गलत हो → main session खुद (inline) संभालता है और change log में लिखता है।
- बीच में ऐसा issue मिले जो plan बदल दे → `Issues & updates` में लिखो, `Plan (v2)/Tasks (v2)` बनाओ (v1 मत मिटाओ),
  और **फिर से approval** लो।

---

## Step 3 — Verification का नियम

**मूल नियम (`CLAUDE.md`):** कोई test, build, migration या runtime check "pass" तभी कहो जब तुमने खुद चलाया और pass होते देखा।

व्यवहार में इसका मतलब:

1. **हर group के बाद** targeted tests / type-check चलाओ (`execute.md` step 4)।
2. **Executor की रिपोर्ट पर भरोसा मत करो — खुद चलाओ।** Agent का कहा हुआ "सब pass" सबूत नहीं है।
   असली exit code (0 = सफल) और असली counts देखो।
3. सिर्फ़ `package.json` में मौजूद scripts चलाओ; कोई script मत गढ़ो (`/run-tests`)।
4. सबसे छोटा check पहले (एक file या `-t` filter, `--reporter=dot`)।
5. Test green करने के लिए `.skip`/`.only` या assertions ढीले मत करो (`.claude/rules/testing.md`)।
6. जो नहीं जाँचा, उसे "NOT VERIFIED" लिखो।

**असली उदाहरण कि यह क्यों ज़रूरी है:**
- foundation task 2: "10 tests pass (executor's count of 11 was wrong)" — executor ने गलत गिनती बताई थी।
- sessions-and-join task 6 और 9: "typecheck re-run by main session", "integration suite 58 of 58 pass (re-run by main session)"।
- sessions-and-join task 7: race test ने एक असली bug पकड़ा (`ended_at` ordering) — fix के बाद re-verify।
- foundation में शुरू में Node/Docker install नहीं थे, इसलिए Group A को "written but unverified" लिखा गया — pass नहीं कहा गया।

Task status के लिए असली शब्द इस्तेमाल हुए: `verified`, `verified (partial)`, `pending`।

---

## Step 4 — Tracking और change log

सब कुछ `requirements/<name>/planning-tracking.md` में:

| खंड | क्या लिखते हैं |
|---|---|
| Tasks (v1) | हर task का Status और Notes (क्या चलाया, क्या नतीजा) |
| Decisions | approval के समय तय हुई बातें, तारीख के साथ |
| Execution groups | कौन सा group, कौन से tasks, कौन सा executor |
| Issues & updates | `तारीख · SEVERITY · शीर्षक: विवरण. Resolution.` — NOT VERIFIED, DEFERRED, OPEN, RISK भी यहीं |
| Plan (v2) / Tasks (v2) | सिर्फ़ replan होने पर; v1 कभी overwrite नहीं |
| Change log | `Date | Type | Description | Files` |

Change log के असली Types: `plan_created`, `decisions`, `build`, `fix`, `verify`।
sessions-and-join की आख़िरी लाइन उदाहरण है:

```
| 2026-10-24 | verify | Final run: lint 0 · typecheck 0 · unit 49 pass · web 35 pass · web build 0 · prettier 0 · integration 58 pass | — |
```

अंत में (`execute.md` step 5): affected workspaces के checks चलाओ, `git diff` खुद review करो, requirement status
`completed` (या `failed` कारण के साथ) करो, `requirement.md` का change log update करो, और `docs/` तभी बदलो जब
architecture या setup बदला हो। रिपोर्ट: success criteria ✔/✘ · files changed · commands → results · not verified · risks।

---

## Step 5 — `docs/hindi-guide/` में नया stage file

हर पूरे हुए stage के लिए एक हिंदी walkthrough फ़ाइल जोड़ें:

```
docs/hindi-guide/stage-NN-<name>.md      उदाहरण: stage-03-sessions-and-join.md
```

`NN` = `docs/08-implementation-plan.md` वाला phase number (यह naming convention इस गाइड का प्रस्ताव है;
अभी कोई stage file मौजूद नहीं — पुष्टि नहीं हुई कि यही नाम अपनाया जाएगा)।

सुझाया गया ढाँचा:
1. **यह stage क्या करता है** — `requirement.md` के "What it does" से, सरल हिंदी में।
2. **Files की सूची** — `planning-tracking.md` के Files खंड से।
3. **Code walkthrough** — request का पूरा रास्ता, layer दर layer (`implementation-order` के क्रम में):
   shared schema → migration → model → service → route/controller → web page।
   उदाहरण (sessions-and-join): `shared/src/schemas/sessions.ts` → `api/migrations/20261024034903-create-sessions-and-participants.cjs`
   → `api/src/models/` → `api/src/services/sessions.service.ts`, `participants.service.ts` → `api/src/routes/sessions.routes.ts`
   → `web/src/app/host/`, `web/src/app/join/`।
4. **ज़रूरी फ़ैसले और क्यों** — Key decisions + Decisions खंड से।
5. **Tests** — कौन सा test किस business behaviour को जाँचता है।
6. **क्या verify नहीं हुआ / risks** — Issues & updates से, ईमानदारी से।

Walkthrough लिखने में `/explain-code <file या flow>` मदद कर सकता है (यह फ़ाइलें नहीं बदलता)।

---

## Step 6 — Commit (human करता है)

- `/pre-commit-check` चलाओ: secrets, leftovers (`console.log`, `debugger`, `.only`/`.skip`), scope, tests,
  requirement/docs जाँचता है, और Ready / Not ready + सुझाया गया Conventional Commit message देता है। यह **कभी commit नहीं करता**।
- Commit आप खुद करते हैं। `CLAUDE.md` में "Ask before commit/push" है, और `settings.json` में `git commit` और
  `git push` `ask` सूची में हैं — यानी Claude करे तो भी हर बार permission माँगी जाएगी।
- `.env`, `.claude/settings.local.json`, keys, `node_modules/`, build output commit न हों (`.gitignore` में हैं)।
- अगला phase शुरू करने से पहले साफ़ approval दें।

---

## हर stage के लिए copy-paste checklist

```markdown
### Stage NN — <name>

**शुरू करने से पहले**
- [ ] अगले phase की approval दी (CLAUDE.md नियम)
- [ ] docs/08-implementation-plan.md में phase पढ़ा; docs/11-phase-prompts.md से prompt लिया
- [ ] पिछले stage के OPEN / NOT VERIFIED issues देखे

**1. Requirement**
- [ ] /requirement <name> <विवरण> चलाया
- [ ] सवालों के जवाब दिए; assumptions, scope, risks, success criteria confirm किए
- [ ] requirements/<name>/requirement.md बना, status `planning`, कोई code/file path नहीं

**2. Plan + approval**
- [ ] /execute <name> चलाया; planner ने plan दिया
- [ ] planning-tracking.md में Architecture, Contracts, Files, Impact analysis, Tasks हैं
- [ ] हर task: complexity + executor (LOW→executor-low, MEDIUM→executor-medium, HIGH→executor-high, tiny→inline)
- [ ] नए packages / paid services / destructive migration अलग से approve या reject किए
- [ ] Decisions खंड में फ़ैसले तारीख के साथ लिखे
- [ ] Plan साफ़ शब्दों में approve किया

**3. Build + verification**
- [ ] status `in_progress`
- [ ] हर group के बाद targeted tests / typecheck खुद चलाए; असली exit codes और counts देखे
- [ ] executor की रिपोर्ट पर अकेले भरोसा नहीं किया
- [ ] migration: up, down, up — सिर्फ़ test DB पर
- [ ] कोई .skip/.only या ढीला assertion नहीं
- [ ] plan बदला तो Plan (v2)/Tasks (v2) + दोबारा approval

**4. Tracking**
- [ ] हर task row: status (verified / verified (partial)) + notes
- [ ] Issues & updates: severity, NOT VERIFIED, RISK, DEFERRED
- [ ] Change log: plan_created, decisions, build, fix, verify लाइनें
- [ ] final verify लाइन: lint · typecheck · tests · build के असली नतीजे
- [ ] requirement.md status `completed` (या `failed` + कारण) और उसका change log

**5. Docs**
- [ ] docs/ सिर्फ़ तब बदले जब architecture/setup बदला
- [ ] docs/hindi-guide/stage-NN-<name>.md: क्या करता है, files, code walkthrough, फ़ैसले, tests, risks

**6. Commit (human)**
- [ ] /code-review (ज़रूरत हो तो) और /pre-commit-check — Ready
- [ ] .env, secrets, settings.local.json staged नहीं
- [ ] commit खुद किया
```
