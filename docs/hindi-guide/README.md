# LivePulse — पूरी गाइड (हिंदी में)

यह फ़ोल्डर LivePulse प्रोजेक्ट का पूरा रिकॉर्ड है: प्रोजेक्ट क्या है, कैसे बना, Claude Code ने कैसे काम किया,
हर फ़ाइल में कौन सा code क्या करता है, और कौन सा फ़ैसला क्यों लिया गया। यह demo की तैयारी और आगे के
features के लिए मुख्य संदर्भ है।

## किस क्रम में पढ़ें

| क्रम | फ़ाइल | इसमें क्या है |
|---|---|---|
| 1 | [01-project-overview.md](01-project-overview.md) | प्रोजेक्ट क्या है, किसके लिए है, अभी तक क्या बना |
| 2 | [02-architecture.md](02-architecture.md) | तीन हिस्से, request का पूरा सफ़र, सुरक्षा की परतें |
| 3 | [03-claude-workflow.md](03-claude-workflow.md) | Claude Code कैसे सेट है: CLAUDE.md, commands, agents, skills, hooks |
| 4 | [04-stages/README.md](04-stages/README.md) | सभी stages की सूची और हर stage का status |
| 5 | [04-stages/stage-01-foundation.md](04-stages/stage-01-foundation.md) | Stage 1: project का ढाँचा, Docker, health checks |
| 6 | [04-stages/stage-02-sessions-and-join.md](04-stages/stage-02-sessions-and-join.md) | Stage 2: session बनाना और join करना |
| 7 | [05-code/](05-code/) | हर फ़ाइल का code, line by line, हिंदी में |
| 8 | [06-how-to-add-next-stage.md](06-how-to-add-next-stage.md) | अगला feature कैसे जोड़ें (step by step) |
| 9 | [07-decisions.md](07-decisions.md) | हर बड़ा फ़ैसला: क्या, क्यों, trade-off |
| 10 | [08-verification-log.md](08-verification-log.md) | क्या जाँचा, असली commands और नतीजे |
| 11 | [09-demo-script.md](09-demo-script.md) | CTO demo का plan, talk track और fallback |
| 12 | [10-glossary.md](10-glossary.md) | शब्दावली (हिंदी अर्थ के साथ) |
| 13 | [11-known-issues.md](11-known-issues.md) | खुले issues, risks और जो अभी जाँचा नहीं गया |
| 14 | [12-cto-qa.md](12-cto-qa.md) | CTO के संभावित सवाल और जवाब |

## code walkthrough (`05-code/`)

- [01-shared.md](05-code/01-shared.md) — `shared/`: Zod schemas, जो frontend और backend दोनों इस्तेमाल करते हैं
- [02-api-foundation.md](05-code/02-api-foundation.md) — `api/`: config, logger, app setup, errors, health, startup
- [03-api-sessions.md](05-code/03-api-sessions.md) — `api/`: sessions का backend (models, tokens, cookies, services, routes)
- [04-web.md](05-code/04-web.md) — `web/`: Next.js pages, components, API client
- [05-tests-docker-env.md](05-code/05-tests-docker-env.md) — tests, Docker Compose, `.env.example`, scripts

## हर फ़ाइल कैसे पढ़ें

हर code walkthrough में एक ही ढाँचा है: फ़ाइल का उद्देश्य, मुख्य lines का विवरण (line number के साथ), यह
डिज़ाइन ऐसा क्यों है, और इसे कैसे test किया गया। Line numbers उस समय की फ़ाइलों से लिए गए हैं; फ़ाइल बदलने
पर उन्हें दोबारा मिलाएँ।

## इस फ़ोल्डर को अपडेट कैसे रखें

हर नया stage पूरा होने पर ये फ़ाइलें अपडेट होनी चाहिए:
1. `04-stages/README.md` में stage का status बदलें।
2. नया `04-stages/stage-NN-<name>.md` लिखें (ढाँचा `04-stages/README.md` में है)।
3. नए/बदले files के लिए `05-code/` में walkthrough जोड़ें या बदलें।
4. `07-decisions.md` में नए फ़ैसले, `08-verification-log.md` में असली commands और नतीजे, और
   `11-known-issues.md` में नए issues जोड़ें।
5. जो बात पक्की नहीं है, उसे "(पुष्टि नहीं हुई)" लिखें, अंदाज़े से न भरें।

पूरी प्रक्रिया [06-how-to-add-next-stage.md](06-how-to-add-next-stage.md) में है।

## अभी की स्थिति (2026-10-24)

- Stage 1 (foundation): पूरा, verified (commit `f382ca2`)।
- Stage 2 (sessions-and-join): पूरा, verified; commit अभी बाकी है।
- अगला: realtime-backbone (requirement अभी नहीं लिखा गया)।

सारे commands और नतीजे `08-verification-log.md` में हैं। Demo से पहले `09-demo-script.md` पढ़ें।
