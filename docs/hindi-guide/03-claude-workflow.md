# 03 — LivePulse में Claude वर्कफ़्लो (पूरी तस्वीर)

यह गाइड बताती है कि LivePulse प्रोजेक्ट में Claude Code कैसे सेट किया गया है और कैसे इस्तेमाल होता है।
हर बात असली फ़ाइलों (`CLAUDE.md`, `.claude/` फ़ोल्डर, memory फ़ोल्डर) से मिलाकर लिखी गई है।
जहाँ पक्का नहीं है, वहाँ "(पुष्टि नहीं हुई)" लिखा है।

अंग्रेज़ी में यही जानकारी `.claude/README.md` और `docs/claude-workflow/` में है।

---

## 1. Claude Code क्या है?

Claude Code एक AI coding assistant है जो आपके terminal (कमांड लाइन) में चलता है।
यह फ़ाइलें पढ़ सकता है, बदल सकता है, और commands चला सकता है।
लेकिन क्या करने की इजाज़त (permission) है, यह प्रोजेक्ट की settings तय करती हैं।

LivePulse में Claude Code को इन हिस्सों से कंट्रोल किया जाता है:

```
CLAUDE.md                   हर request पर लोड होने वाले प्रोजेक्ट नियम
.claude/
  settings.json             permissions (अनुमतियाँ) + hooks — टीम के लिए, commit होती है
  settings.local.json       आपकी निजी approvals — gitignored
  commands/*.md             slash commands = वर्कफ़्लो जो आप चलाते हैं
  agents/*.md               subagents (planner, executors, debugger, reviewers)
  skills/<name>/SKILL.md    ज्ञान (knowledge) जो ज़रूरत पड़ने पर लोड होता है
  rules/*.md                छोटे नियम, मिलती-जुलती फ़ाइल पढ़ने पर लोड होते हैं
  hooks/format-on-edit.sh   Edit/Write के बाद auto-format
requirements/<feature>/     हर फ़ीचर का requirement.md + planning-tracking.md
```

---

## 2. `CLAUDE.md` — हमेशा लोड होने वाली फ़ाइल

**कब लोड होता है:** हर request (अनुरोध) पर। `.claude/README.md` के अनुसार यह "every request" पर लोड होता है।

**इसमें क्या रखा है (असली sections):**

| Section | क्या कहता है |
|---|---|
| परिचय | LivePulse एक **prototype** है (polls, Q&A, reactions), सिर्फ़ web + backend, mobile नहीं |
| Non-negotiable | Stack तय है: `api/` Express + TS + **Sequelize** + PostgreSQL + Socket.IO (`@socket.io/redis-adapter`), `web/` Next.js App Router + Tailwind, `shared/` Zod schemas, Vitest + Supertest, Docker Compose |
| AI नियम | Phase 9+ में Claude via LangChain.js, LangGraph.js, pgvector; tests में `fake` provider |
| Data नियम | PostgreSQL सच्चाई का स्रोत (source of truth); पहले persist, फिर commit, फिर emit |
| Ask before | नए packages, paid services, destructive schema changes, files delete करना, commit/push/deploy, DB reset — इनसे पहले पूछना |
| Layout | `api/`, `web/`, `shared/`, `requirements/`, `docs/` का ढाँचा |
| Commands | `package.json` के `scripts` पढ़े बिना कोई script मत बनाओ |
| Workflow | `/requirement` → `/execute`, `/bug-fix`, `/code-review` आदि |
| Token discipline | पहले Grep/Glob, फिर सिर्फ़ ज़रूरी lines पढ़ो |
| Code style | 2-space indent, single quotes, no semicolons; kebab-case files; snake_case DB columns |
| Compact instructions | बातचीत छोटी (compact) होने पर क्या याद रखना है |

**छोटा क्यों रखा है:** क्योंकि यह हर request के साथ भेजा जाता है, यानी हर बार इसके tokens (शब्द-इकाइयाँ) का खर्च
होता है। `.claude/README.md` में लिखा है: "keep it short — paid on every request"। इसलिए लंबे patterns और
उदाहरण skills और rules में रखे गए हैं।

> ध्यान दें: `CLAUDE.md` **guidance** (मार्गदर्शन) है, ज़बरदस्ती लागू (enforced) नहीं। आगे खंड 10 देखें।

---

## 3. Rules — `.claude/rules/*.md`

Rules छोटे convention (नियम-परंपरा) वाली फ़ाइलें हैं। हर फ़ाइल के ऊपर frontmatter में `paths:` होता है।

**`paths:` का मतलब:** यह glob patterns की सूची है (repo root से relative)। जब Claude कोई ऐसी फ़ाइल पढ़ता है जो
इन patterns से मिलती है, तब वह rule अपने आप लोड हो जाता है। बाकी समय वह rule context में नहीं आता — इससे tokens बचते हैं।

उदाहरण (`.claude/rules/backend-api.md`):

```yaml
---
paths:
  - "api/src/**/*.ts"
---
```

LivePulse के rules:

| Rule फ़ाइल | `paths:` (कब लोड) | किस बारे में |
|---|---|---|
| `backend-api.md` | `api/src/**/*.ts` | Express layers: route → validate → controller → service → model; authorization; errors |
| `database-sequelize.md` | `api/src/models/**`, `api/src/db/**`, `api/migrations/**`, `api/seeders/**`, `api/.sequelizerc` | Sequelize models, migrations |
| `frontend-react.md` | `web/**/*.{ts,tsx}` | Next.js, Server Components, UI states, sockets सिर्फ़ `src/realtime/` में |
| `general-coding.md` | `{api,web}/**/*.{ts,tsx}`, `shared/**/*.ts` | strict TS, naming, `any`/`!` से बचना |
| `realtime-socket-redis.md` | `api/src/realtime/**`, `web/src/realtime/**`, `shared/src/events/**` | event contracts, `domain:action` नाम, ack format |
| `security.md` | `api/**/*.ts`, `shared/**/*.ts`, `**/package.json`, `**/.env.example`, `**/docker-compose*.yml`, `**/Dockerfile*` | Zod validation, secrets, आदि |
| `testing.md` | `**/*.test.{ts,tsx}`, `**/*.spec.{ts,tsx}`, `**/tests/**`, `**/vitest.config.*`, `**/vitest.workspace.*` | test layout; `.skip`/`.only` या assertions ढीले करके green मत करो |

---

## 4. Commands — `.claude/commands/*.md`

Slash command वह वर्कफ़्लो है जो आप `/नाम` टाइप करके चलाते हैं। सभी commands में
`disable-model-invocation: true` है — यानी Claude इन्हें खुद से नहीं चलाता, सिर्फ़ आप चलाते हैं।
कुछ commands में `disallowed-tools` है, जो उन tools को रोक देता है (यह enforced है)।

| Command | उद्देश्य (purpose) | फ़ाइलें बदलता है? |
|---|---|---|
| `/requirement <name> [desc]` | फ़ीचर का idea साफ़ करके `requirements/<name>/requirement.md` लिखना, business भाषा में। कोई code नहीं | सिर्फ़ docs (`disallowed-tools: Edit, NotebookEdit`) |
| `/execute <name>` | Plan (planner) → **approval** → tiered executors से build → tracking → verify | हाँ |
| `/enhance <parent> <name>` | पहले से बने फ़ीचर में नया हिस्सा: `requirements/<parent>/enhancements/<name>/` | हाँ |
| `/bug-fix <symptom>` | Root cause → **approval** → requirement साफ़ करना → failing test → minimal fix | हाँ |
| `/debug <symptom>` | पहले सबूत (evidence: logs, network, server output), फिर root cause और fix का सुझाव | नहीं (जब तक कहा न जाए) |
| `/fix-test <scope>` | Failing test: test गलत है, code गलत है, या requirement अस्पष्ट है → **approval** → fix | हाँ |
| `/code-review [target]` | Diff का read-only review, severity (गंभीरता) के क्रम में | नहीं (`disallowed-tools: Edit, Write, NotebookEdit`) |
| `/run-tests [scope]` | सबसे छोटे असली checks (tests, lint, type-check, build) चलाना और exact नतीजे बताना | नहीं |
| `/pre-commit-check` | Secrets, leftovers (`console.log`, `.only`), scope, tests, tracking जाँचना → Ready/Not ready। **कभी commit नहीं करता** | नहीं (`disallowed-tools: Edit, Write, NotebookEdit`) |
| `/explain-code <target>` | Code कैसे काम करता है: flow, data, errors, security, trade-offs | नहीं (`disallowed-tools: Edit, Write, NotebookEdit`) |

नोट: `.claude/README.md` के अनुसार `/code-review` इस repo में bundled command की जगह लेता है; bundled वाला `/review` है।

---

## 5. Agents — `.claude/agents/*.md`

Agent (subagent) एक अलग Claude instance है जिसे main session कोई काम सौंपता है। हर agent फ़ाइल के frontmatter में:

- **`model`** — कौन सा model चलेगा: `haiku` (सस्ता, तेज़), `sonnet` (मध्यम), `opus` (सबसे सक्षम, महँगा)।
- **`tools`** — agent कौन से tools इस्तेमाल कर सकता है। `Edit`/`Write` न हों तो वह फ़ाइलें नहीं बदल सकता (read-only)।
- **`maxTurns`** — agent ज़्यादा से ज़्यादा कितने turns (चक्र) चलेगा, ताकि वह अटककर खर्च न बढ़ाए।

`.claude/README.md` के अनुसार tool list, model और `maxTurns` Claude Code द्वारा enforced हैं।

| Agent | `model` | `tools` | `maxTurns` | काम |
|---|---|---|---|---|
| `planner` | opus | Read, Grep, Glob, Bash (read-only) | 30 | बड़े फ़ीचर (3+ files, schema, auth, real-time) का plan; हर task की complexity और executor। फ़ाइलें नहीं बनाता — main session plan को `planning-tracking.md` में लिखता है |
| `executor-low` | haiku | Read, Grep, Glob, Edit, Write, Bash | 25 | LOW tasks: boilerplate, config, types, renames |
| `executor-medium` | sonnet | Read, Grep, Glob, Edit, Write, Bash | 40 | MEDIUM tasks: CRUD endpoints, components, tests |
| `executor-high` | opus | Read, Grep, Glob, Edit, Write, Bash | 50 | HIGH tasks: auth/authorization, transactions, concurrency, migrations, Socket.IO rooms |
| `debugger` | opus | Read, Grep, Glob, Bash, Edit, Write | 40 | कठिन bugs: पहले evidence, फिर सबसे छोटा fix + regression test |
| `debug-helper` | haiku | Read, Grep, Glob, Bash (read-only) | 20 | सस्ते में सबूत इकट्ठा करना (logs, DB state, git log)। फ़ाइलें नहीं बदलता |
| `code-reviewer` | sonnet | Read, Grep, Glob, Bash | 25 | Diff का review; सिर्फ़ user के कहने पर |
| `security-reviewer` | sonnet | Read, Grep, Glob, Bash | 25 | auth, validation, secrets, socket rooms का security review; read-only |
| `test-engineer` | sonnet | Read, Grep, Glob, Bash, Edit, Write | 40 | test gaps ढूँढना, Vitest/Supertest/Socket.IO tests लिखना और चलाना |

ध्यान दें: "read-only" agents के पास भी `Bash` है। उनकी फ़ाइल में लिखा है "Bash only for read-only commands" —
यह निर्देश (guidance) है; Bash tool खुद को read-only तक सीमित नहीं करता।

**Inline नियम:** ~20 lines से छोटे tasks main session खुद करता है, क्योंकि agent शुरू करना task से महँगा पड़ता है।

---

## 6. Skills — `.claude/skills/*/SKILL.md`

Skill ज्ञान (knowledge) का पैकेट है। शुरू में सिर्फ़ उसका एक लाइन का `description` दिखता है; पूरा body तभी
लोड होता है जब Claude या कोई command उसे लोड करे। इससे tokens बचते हैं।

| Skill | किस काम का |
|---|---|
| `implementation-order` | फ़ीचर किस क्रम में बनाएँ: shared contracts → migration → model → service → route → realtime → web client/hooks → components/page → docs/tracking। हर layer के साथ tests |
| `integration-data-contracts` | PostgreSQL → Sequelize → API response → shared Zod schemas → socket events → Next.js तक data shapes एक जैसी रखना |
| `backend-patterns` | Express + Sequelize: route, validation middleware, controller, transaction वाली service, model, migration, error handling |
| `frontend-patterns` | Next.js App Router + React + Tailwind: pages, client components, hooks, forms, UI states |
| `realtime-patterns` | Socket.IO + Redis adapter: typed events, handshake auth, room join authorization, ack, commit के बाद emit, reconnect |
| `testing-patterns` | Vitest: business भाषा में test names, Supertest, Socket.IO tests, concurrency tests, React component tests |
| `requirement-clarifier` | अस्पष्ट request को confirmed requirement बनाना: सवाल, assumptions, scope, risks, success criteria। `/requirement` और `/enhance` इसे इस्तेमाल करते हैं |

नोट: `.claude/README.md` में एक `learnings` skill का नाम भी है, और `debugger` agent उसका ज़िक्र करता है, लेकिन
`.claude/skills/learnings/` फ़ोल्डर मौजूद नहीं मिला (पुष्टि नहीं हुई)।

---

## 7. Memory — `C:\Users\dell\.claude\projects\C--Users-dell-LivePulse\memory\`

Memory वह जानकारी है जो एक बातचीत (conversation) से अगली बातचीत तक बची रहती है। यह repo के बाहर, आपके user
फ़ोल्डर में रहती है, इसलिए git में नहीं जाती।

- **`MEMORY.md`** — index (सूची) फ़ाइल। हर memory फ़ाइल की एक लाइन। अभी इसमें दो entries हैं:
  `user-profile.md` और `livepulse-phases.md`।
- हर memory फ़ाइल के frontmatter में `name`, `description` और `metadata.type` होता है।

Memory के types:

| Type | मतलब | इस प्रोजेक्ट में |
|---|---|---|
| `user` | user कौन है, कैसे काम करना पसंद करता है | `user-profile.md` — ~5 साल Node/Express अनुभव, AI-written code खुद समझना चाहते हैं, हर phase से पहले approval |
| `project` | प्रोजेक्ट का लक्ष्य, फ़ैसले, स्थिति | `livepulse-phases.md` — CTO demo, AI-heavy, roadmap `docs/08`, prompts `docs/11` |
| `feedback` | user की दी हुई सुधार/पसंद (जैसे "ऐसे मत करो") | अभी कोई फ़ाइल नहीं |
| `reference` | बाहरी संदर्भ (links, docs कहाँ हैं) | अभी कोई फ़ाइल नहीं |

`feedback` और `reference` types की परिभाषा प्रोजेक्ट फ़ाइलों में लिखी नहीं मिली (पुष्टि नहीं हुई); ऊपर का मतलब सामान्य समझ पर है।

---

## 8. `settings.json` — permissions (अनुमतियाँ)

`.claude/settings.json` में तीन सूचियाँ हैं:

- **`allow`** — बिना पूछे चल सकता है।
- **`ask`** — हर बार आपसे पूछेगा।
- **`deny`** — बिल्कुल मना है।

Precedence (प्राथमिकता): **deny > ask > allow**। जैसे `npx sequelize-cli *` allow में है, लेकिन
`*db:drop*` ask में है, इसलिए `npx sequelize-cli db:drop` फिर भी पूछेगा।

**allow (बिना पूछे):** `npm run *`, `npm test`, `npx vitest|tsc|prettier|eslint|sequelize-cli *`, `node --version`,
`npm --version`, `docker compose up|ps|logs|version`, `curl -s http://localhost*`, read-only git
(`git status|diff|log|show`)। कुछ के PowerShell रूप भी allow हैं।

**ask (हर बार पूछता है):**
- Git: `git commit`, `git push`, `git reset`, `git clean`, `git rebase`, `git restore`, `git checkout --`, `git branch -D`
- फ़ाइल हटाना: `rm *` (PowerShell में `Remove-Item *`)
- Packages: `npm install`, `npm i`, `npm ci`, `npm uninstall`, `npm update`, `npx create-*`
- Database: `*db:drop*`, `*db:reset*`, `*db:migrate:undo*`, `*db:seed:undo*`
- Docker: `docker compose down`, `docker volume rm`, `docker system prune`
- Lockfiles पढ़ना (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) और `.env` / `.env.*` edit करना

**deny (मना):** `node_modules`, `.next`, `dist`, `build`, `coverage` पढ़ना; `.env` और `.env.*` पढ़ना
(`.env.example` छोड़कर); `*.pem`, `*.key` पढ़ना; force push (`--force`, `-f`, `--force-with-lease`); `npm publish`।

**`bashOutputMaxChars: 15000`** — लंबा output context में न भरे।

`.claude/README.md` के अनुसार ये rules command के text से match होते हैं — ये guard rails (सुरक्षा रेलिंग) हैं, sandbox नहीं।

`settings.local.json` आपकी निजी approvals रखती है और gitignored है।

---

## 9. Hooks — `PostToolUse` → `format-on-edit.sh`

Hook एक script है जो किसी event पर Claude Code अपने आप चलाता है।

`settings.json` में:

```json
"PostToolUse": [{ "matcher": "Edit|Write",
  "hooks": [{ "type": "command",
    "command": "bash \"${CLAUDE_PROJECT_DIR}/.claude/hooks/format-on-edit.sh\"", "timeout": 30 }] }]
```

मतलब: हर `Edit` या `Write` के **बाद** `.claude/hooks/format-on-edit.sh` चलता है। यह script:

1. Node न हो तो चुपचाप बाहर निकल जाती है।
2. stdin के JSON से `tool_input.file_path` (जिस फ़ाइल को अभी edit किया) निकालती है।
3. `node_modules`, `.next`, `dist`, `coverage` को छोड़ देती है।
4. सिर्फ़ `.ts/.tsx/.js/.jsx/.mjs/.cjs/.json/.css` फ़ाइलें format करती है।
5. सिर्फ़ repo की अपनी `node_modules/.bin/prettier` इस्तेमाल करती है; न मिले तो चुपचाप बाहर।
6. `prettier --write` सिर्फ़ उसी एक फ़ाइल पर चलाती है और हमेशा `exit 0` करती है (edit को कभी रोकती नहीं)।

ध्यान दें: `.md` फ़ाइलें इस hook से format नहीं होतीं।

---

## 10. Enforced बनाम Guidance — सबसे ज़रूरी फ़र्क

| Mechanism | कब लोड | Enforced? |
|---|---|---|
| `CLAUDE.md` | हर request | guidance |
| Rules | `paths` से मिलती फ़ाइल पढ़ने पर | guidance |
| Skills | description हमेशा दिखता है; body लोड करने पर | guidance |
| Commands | जब आप `/name` टाइप करें | guidance; `disallowed-tools` enforced |
| Agents | description दिखता है; body spawn होने पर | tool list, model, `maxTurns` enforced |
| `settings.json` permissions | हमेशा | **Claude Code द्वारा enforced** |
| Hooks | event होने पर | **Claude Code द्वारा enforced** |

(यह तालिका `.claude/README.md` से है।)

**Guidance** (मार्गदर्शन) = Claude को बताया गया है कि ऐसा करो। Claude आम तौर पर मानता है, लेकिन यह गारंटी नहीं है।
जैसे `CLAUDE.md` कहता है "commit से पहले पूछो" — यह निर्देश है।

**Enforced** (लागू किया गया) = Claude Code खुद रोकता या चलाता है, Claude चाहे या न चाहे।
जैसे `git commit` `ask` सूची में है, इसलिए Claude Code हर बार आपसे permission माँगेगा। `.env` पढ़ना `deny` में है,
इसलिए वह tool call ही रुक जाएगा। Hook हर Edit/Write के बाद अपने आप चलेगा।

**सीख:** जो बात सच में ज़रूरी है (secrets, destructive commands, commit), उसे सिर्फ़ `CLAUDE.md` में लिखना काफ़ी नहीं —
उसे `settings.json` में भी डालें। इस प्रोजेक्ट में यही किया गया है: "ask before commit" `CLAUDE.md` में भी है और
`settings.json` की `ask` सूची में भी।

---

## 11. नया हिस्सा जोड़ना (`.claude/README.md` → Extending)

- Command: `.claude/commands/<name>.md` — `description`, `argument-hint`, `disable-model-invocation: true`
- Skill: `.claude/skills/<name>/SKILL.md` — `name` (= फ़ोल्डर का नाम) और एक लाइन `description`
- Agent: `.claude/agents/<name>.md` — `name`, `description`, सबसे कम ज़रूरी `tools`, `model`, `maxTurns`
- Rule: `.claude/rules/<topic>.md` — `paths:` globs, repo root से relative

बदलाव के बाद जाँच: नया session → `/` से commands दिखें → `/agents` → `/status` → `/hooks` → `claude doctor`।

अगला फ़ीचर (stage) कैसे जोड़ें — देखें `06-how-to-add-next-stage.md`।
