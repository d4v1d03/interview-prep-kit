# Interview Prep Kit

Paste a job description, give the company's website and the days until the interview. The app reads the posting,
crawls the company site for what they do and how they hire, searches public discussion of their interviews, and
builds a structured kit — company brief, role breakdown, categorised question bank, flashcards and a day-by-day
schedule — that you can edit, regenerate section by section, and practise against.

- **Live app:** https://interview-prep-kit-tau.vercel.app/
- **Batch entry point:** `npm run evaluate -- --input <cases.json> --output <kits.json>` (see [Batch entry point](#batch-entry-point))

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js 16 (App Router) + Tailwind CSS 4** | As preferred. |
| Backend | **Next.js route handlers on Node.js** (instead of Express) | One deployable, one language, one set of types shared by UI, API and pipeline. A separate Express server would add a second deployment without adding capability. |
| Database | **Postgres (Neon free tier) via Drizzle** (instead of MongoDB) | The concurrency design relies on single atomic conditional `UPDATE`s (job leases, versioned saves, ownership in every `WHERE`), plus foreign keys and cascades. Kits themselves are stored as `jsonb`, so the document-shaped part keeps MongoDB's convenience. |
| LLM | **Google Gemini, free tier** (default chain `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` → `gemini-3.6-flash`) | Genuine free tier. See [Model choice](#model-choice-and-rate-limits). |
| Scraping | `fetch` + **cheerio**, **robots-parser**, **ipaddr.js** | Small, well-known libraries for the parts that are easy to get wrong (HTML parsing, robots.txt rules, IP range classification). |
| Tests | **Vitest** (169 tests) | Schedule allocation, coverage, structure validation, retrieval, the job runner (against a real in-memory Postgres), the pipeline with a scripted model. |

Language is TypeScript throughout. Local development needs no database account: `DATABASE_URL=pglite://.data/pg`
runs an embedded Postgres (PGlite) with the same migrations.

## Setup

Requires **Node 20.9+** (`.nvmrc` pins 22).

### Local

```bash
npm install
cp .env.example .env.local        # then set GEMINI_API_KEY, and DATABASE_URL=pglite://.data/pg
npm run dev                        # http://localhost:3000
```

The three fixture company sites used in tests and examples are served with `npm run fixtures:serve` (port 8099).

Other commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

### Deployed (Vercel + Neon)

1. Create a Neon project and copy its connection string.
2. Apply migrations to it: `DATABASE_URL="<neon url>" npm run db:migrate`
3. Import the repository in Vercel. Set `GEMINI_API_KEY` and `DATABASE_URL` in the project's environment variables. Keep Fluid compute on (the default), which allows the 300-second step limit used by the job route.
4. Deploy. `GET /api/health` returns `{"ok":true,"db":"up"}` when the backend can reach the database.

### Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | app, CLI | Google AI Studio key (free tier). **Required.** |
| `DATABASE_URL` | app | Postgres connection string (Neon), or `pglite://<dir>` for local development. Not needed by the CLI. |
| `GEMINI_MODELS` | app, CLI | Optional comma-separated model chain, most preferred first. |
| `GEMINI_MIN_INTERVAL_MS` | app, CLI | Optional minimum gap between model requests (default 4000). |
| `ALLOW_PRIVATE_URLS` | app | Optional. `true` lets the web app fetch private/loopback addresses. Never set in production. |

Secrets live only in `.env.local` (git-ignored) and the Vercel project settings; `.env.example` documents them.

## Batch entry point

```bash
npm install
echo "GEMINI_API_KEY=your-key" > .env      # or export it in the shell
npm run evaluate -- --input cases.json --output kits.json
```

- Reads an array of `{ id, jd, company_url, days }`; writes `{ version: "1.0", generated_at, kits: [...] }` (Appendix B).
- Calls **the same pipeline functions** as the web app (`runPipeline` in `src/pipeline/run.ts`), one case after another. It needs no database.
- One case failing never stops the run; it is recorded as `failed` with a code and message. `failed` is reserved for a case that could not produce a kit at all. A partly researched case — site unreachable, no hiring page, no discussion — is `ok`, with the gaps stated in the kit's `warnings` and `research` fields.
- The output file is rewritten after every case, so an interrupted run keeps its finished kits. An identical case (same description, company and days) reuses the earlier kit rather than spending quota twice.
- Private and loopback company URLs are allowed here, because evaluation sites may be served from `localhost`. Relative links are resolved against each page's URL (and `<base>`), and the crawl stays under the start URL's path, so `http://localhost:8099/acme/` never wanders into another company's folder on the same host.
- Measured: the 5 cases in `examples/cases.json` took **103 seconds** in total (three of them need `npm run fixtures:serve`). Each kit uses about 6–8 model requests.

## Architecture

```
            ┌──────────── browser ─────────────┐           ┌─────── batch CLI ───────┐
            │ create form / upload             │           │ scripts/evaluate.ts     │
            │ progress (polls one step a time) │           │ runBatch → runPipeline  │
            │ builder · practice               │           └───────────┬─────────────┘
            └───────────────┬──────────────────┘                       │ same functions,
                            │ JSON API                                 │ state in memory
            ┌───────────────▼──────────────────┐                       │
            │ route handlers (src/app/api)     │                       │
            │ auth (DAL) · validation · errors │                       │
            │ job runner: claim → 1 step → save│                       │
            └───────┬───────────────┬──────────┘                       │
                    │               │ state saved between steps        │
          ┌─────────▼───┐   ┌───────▼─────────────────────────────────▼──────┐
          │ Postgres    │   │ pipeline (src/pipeline) ─ pure steps over state│
          │ users,      │   │   retrieval (src/retrieval)  crawl, robots,    │
          │ sessions,   │   │                              discussion        │
          │ kits, jobs, │   │   llm (src/llm)              Gemini, backoff   │
          │ card_reviews│   │   kit (src/kit)              schema, coverage, │
          └─────────────┘   │                              schedule, edits   │
                            └────────────────────────────────────────────────┘
```

Concerns are separated by folder. `src/retrieval` fetches and cleans. `src/llm` talks to the model. `src/pipeline`
sequences the steps. `src/kit` holds everything deterministic: the Appendix A schema and validator, coverage, schedule,
builder edits and practice ordering. `src/server` handles persistence, auth and the job runner. `src/app` is the UI and
the thin route handlers. Nothing in `src/retrieval`, `src/pipeline` or `src/kit` imports the database or the web
framework, which is why the CLI can reuse them unchanged.

## Retrieval approach and sources

- **URL guard** (`url-guard.ts`): http(s) only, a real host name, no embedded credentials. In production the host is resolved and rejected if any address is loopback, private, link-local, CGNAT, unique-local or IPv4-mapped IPv6. The check runs on **every redirect hop** (redirects are followed manually).
- **Fetcher** (`fetcher.ts`): 8-second timeout, content-type allow-list, 5 MB cap enforced while streaming (not trusting `Content-Length`), retries with exponential backoff that honour `Retry-After` on 429/5xx/network errors, and a per-host politeness gap (raised to the site's `Crawl-delay`).
- **robots.txt** (`robots.ts`): RFC 9309. A 4xx means no rules. A 5xx or unreachable robots.txt means the site is off-limits, and it is reported as *unreachable*, not as "disallowed".
- **Cleaning** (`html.ts`): hidden elements (`hidden`, `aria-hidden`, `display:none`) are removed **before** anything reads the page, since hidden text is where injected instructions live. Links are taken from the whole page, because careers links often sit only in the footer. Text is taken from the main content without navigation chrome.
- **Finding the hiring page** (`ranking.ts`, `crawler.ts`): no fixed paths. Every discovered link — plus every URL in `sitemap.xml` — is scored deterministically from the words in its path and anchor text against two vocabularies: *how they hire* and *what they do*. Login, legal, file and source-code-viewer links are pushed out. The crawl is best-first and **alternates** between the two questions, so a site with forty job ads cannot use up the budget before its about page is read. At most two pages are taken per section, and the crawl stops at 8 pages or 45 seconds. A page's own text has the final word: one that walks through an interview process counts as hiring whatever its URL, and a "hiring" link whose page never mentions hiring is downgraded. Interview-format signals (take-home, system design, pair programming, recruiter screen…) are recorded. Scope follows the registrable domain (`about.gitlab.com` reaches `handbook.gitlab.com`), except on shared hosting (`*.github.io`, `*.vercel.app`…).
- **Public discussion** (`discussion.ts`): **Hacker News via the Algolia search API** — free, keyless and intended for programmatic use. A hit is kept only if the company name appears as a whole word near an interview term, so a generic name like "Acme" returns nothing rather than someone else's anecdote. Reddit, Glassdoor and Google search were ruled out: they need OAuth, forbid scraping in their terms, or both.

**Sources used:** the company's own website (respecting robots.txt) and Hacker News through `hn.algolia.com`. Checked against real sites during development: PostHog (finds `/handbook/people/hiring-process`), GitLab (finds `handbook.gitlab.com/handbook/hiring/interviewing/…`) and Stripe.

Every source that could not be read is recorded with a reason code in the kit's `research.skipped_sources`, and never fails the run.

## Research and generation: the sequence

Each step is a plain function `(state, deps) → state` (`src/pipeline/run.ts`). The web app runs **one step per HTTP request** and saves the state on a job row between steps; the CLI runs them back to back.

| # | Step | Model? | Responsible for |
|---|---|---|---|
| 1 | `extract` | 1 call | Requirements from the pasted posting. Pasted text needs no retrieval, so this runs first; the posting's company name then drives the discussion search. |
| 2 | `research` | — | Crawl the company site, then search public discussion. |
| 3 | `brief` | 1 call, or none | Company brief and hiring process, written only from pages actually fetched. If the site was unreachable there is nothing to summarise, so **no call is made** and the brief says research was unavailable. |
| 4–7 | `questions:<category>` | 1 call each | Technical, system design, behavioural and company fit are **separate calls with different instructions**. A React skill and mentoring juniors are not asked about the same way. |
| 8 | `coverage` | 0–2 calls | The second pass (below). |
| 9 | `assemble` | — | Deterministic schedule, assembly into Appendix A, validation. |

What was found changes what happens next:

- **Categories are planned in code** from the findings. A system-design category is added when the hiring page mentions a system design round, the role is senior, or a requirement is about design or scale. Behavioural is added when the posting has behavioural requirements or the process has a values interview. Company fit is added when the site was researched or there are domain requirements.
- **The published process shapes the questions.** The hiring stages go into every question prompt ("if there is a take-home, include a question about discussing or extending it"). In testing, a published take-home followed by a system design round produced questions like "Following our take-home exercise… design…".
- **Each requirement is owned by one category.** Technical → technical, or system design when it is about design or scale. Behavioural → behavioural. Domain → company fit. Must-haves ask for two questions and nice-to-haves one.

### What the model is not allowed to decide

- **Whether a requirement exists.** The model must quote the posting for every requirement. `grounding.ts` drops any requirement whose quote is not in the posting (after normalising quotes, dashes and bullets) or that shares no words with its own quote. Dropped items are listed in `research.dropped_requirements`.
- **Must vs nice, when the posting says.** Inline wording ("…is a plus", "(nice to have)", a line starting "Ideally…") or the section heading above the line ("Nice to have", "Bonus points", "Requirements") overrides the model. "Ideally" in the middle of a line ("relational databases, ideally PostgreSQL") qualifies a detail, not the requirement, so it does not demote it.
- **Coverage.** `findUncovered` in `src/kit/coverage.ts`: a requirement is covered when some question lists its id. No similarity scores.
- **The schedule.** Pure arithmetic in `src/kit/schedule.ts`.
- **Sources.** Brief sources must be URLs we fetched; anything else is dropped. Question requirement ids must exist; anything else is dropped.

### The second pass

After the first draft, code lists the requirements no question references (must-haves first). One model call is asked for exactly those, with each requirement's category. Code then checks again. **At most two gap passes**: in testing a gap was almost always closed on the first, a third call rarely helps, and every call costs free-tier quota. Anything still uncovered then gets a **plain template question written by code** ("The role asks for "…". Walk me through…"), marked `origin: "template"`. So `coverage.uncovered_requirement_ids` is always empty and no kit ships with an uncovered must-have. `coverage.passes` counts the checks, and `coverage.history` records what was uncovered at each one.

In the builder, "Fill coverage gaps" runs the same step on demand. Delete the only question for a requirement and the gap appears immediately, because it is computed in the browser by the same function.

## Generated, edited and pinned state

Every question carries three fields (extensions to Appendix A):

- `origin`: `generated`, `gap-pass` or `template` (written by the system), or `user`
- `edited`: set automatically the moment the user changes a system-written question's text, difficulty, requirements or category
- `pinned`: set by the user to keep a question as it is

**The rule**, as one pure function (`replaceCategory` in `src/kit/edit.ts`, unit-tested): regenerating a category replaces only that category's questions that are system-written **and** not edited **and** not pinned. Everything else — your own questions, your edits, your pins, every other category, the flashcards and the brief — is kept.

How a regeneration avoids clobbering work:

1. Edits apply to local state instantly and save in the background (debounced). Every save carries the kit's **version**; the server refuses a save based on an old version (`409 VERSION_CONFLICT`) instead of letting either copy silently win — for example, two tabs.
2. Starting a regeneration first **flushes** pending edits, so the server regenerates against the latest ones.
3. The regeneration is a one-step job that reuses the pipeline step that made the section, with the saved research (nothing is re-crawled). The model sees the questions being kept, so it does not repeat them.
4. The result is merged into **the latest saved kit** (`applyToLatestKit`: read, change, conditional write, retry), then validated. New question ids continue after the highest in use and are never reused.
5. While the few-second job runs, the editor is inside a disabled `<fieldset>`. It then reloads the merged kit.

The trade-off is deliberate: locking the editor for a few seconds is simpler and safer than merging edits made during a regeneration.

The schedule is derived, not hand-edited. Deleting a question removes it from the schedule immediately. New questions are flagged as "not in the schedule yet" until **Rebuild schedule**, which re-runs the deterministic allocator (optionally with a new number of days) — no model call.

## How the schedule is allocated

`buildSchedule` in `src/kit/schedule.ts`, deterministic and tested for 1, 2, 3, 5, 11, 12, 30, 60 and 90 days:

1. Order the questions: must-have-linked first, then harder first, then by category.
2. **The last day is never new material.** It is a mock interview over the must-have questions. With one day, everything is on day 1, hardest first.
3. Days 1…N−1 are learning days. The ordered list is cut into equal-count chunks with the remainder going to the earliest days, so hard, high-priority material lands first, not the night before.
4. When there are more days than questions (e.g. 60 days), the days in between become review days that cycle through the ordered list, so every day has real question ids.
5. Minutes are integers: 10/20/30 per question by difficulty (half that when reviewing), plus a 15-minute flashcard block per day.

Guaranteed and tested: exactly `days` entries numbered 1…N, every question allocated, every must-have requirement present, every id valid, integer minutes. Days are accepted from 1 to 365.

## Practice mode

One card at a time: <kbd>Space</kbd> reveals, <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> rate *Again / Unsure / Knew it*. Every rating is saved as it is given, to an append-only `card_reviews` table kept apart from the kit (so practising never collides with builder saves). A progress panel shows cards covered vs not, and lists the unpractised and "again" cards.

**Ordering: a confidence-weighted sort, not spaced repetition.** Interview prep lasts days, not months, so long review intervals would mostly never come due; what helps is meeting the weakest material first every session. The order is: last rated *Again* → never practised → *Unsure* → *Knew it*. Within a group, must-have-linked cards come first, then the card practised longest ago.

## Edge cases and failure handling

| Case | Behaviour |
|---|---|
| Company URL invalid, 404 or timing out | The crawl returns `reachable: false` with the reason (`INVALID_URL`, `HTTP_ERROR`, `DNS_FAILED`, `NETWORK`, `TIMEOUT`). The homepage gets 3 attempts with backoff. The kit is still made from the posting, with a brief that says plainly no research was available. |
| No discoverable hiring or about page | `research.hiring_page_found: false`, a warning in the kit, no hiring process claimed, and questions not tailored to an invented process. |
| Two-line stub description | Only what it states. Invented items are removed by the grounding check, and the kit carries a "this description is thin" warning. Categories without requirements are not padded. |
| Public discussion finds nothing | An empty `research.discussion.items` and a warning. A failed search is a skipped source, not an error. |
| Invalid JSON or an incomplete kit from the model | Structured output against a JSON schema. Each reply is validated with zod and re-asked with the specific problem, twice at most. The finished kit is validated against Appendix A (including cross-references) before it is saved or written out. |
| Rate limits or brief provider failures | See [Model choice](#model-choice-and-rate-limits). If a step still fails, the kit degrades rather than dies: a failed brief falls back to the site's own description, and a failed category leaves gaps the coverage pass fills. Only requirement extraction is fatal. |
| Same description and company submitted twice | The web app recognises the fingerprint (description, company, days) and offers to open the existing kit or generate a fresh one. The CLI reuses the kit. |
| 1-day or 60-day schedule | Both are covered by tests (see the schedule section). |

**Long, failing or duplicated generation (web).** Each HTTP request runs one step, well within serverless limits, and the browser keeps asking for the next. A tick first **claims a lease** with one conditional `UPDATE … WHERE lease expired RETURNING`, so two tabs or a double click cannot run a step twice; a random lease token makes every save conditional, so a tick whose lease expired cannot overwrite newer progress. A failing step is retried once, then the job stops with its error shown and a **Retry from this step** button that resumes there, keeping every completed step. Closing the tab pauses the job; reopening the kit resumes it. All of this is tested against a real in-memory Postgres (`tests/server/job-runner.test.ts`).

## Model choice and rate limits

Checked against a new free-tier key on 2026-09-24: the `gemini-2.5-*` models are closed to new keys, and `gemini-3.6-flash` allows only **20 requests a day** on the free tier — not enough for a five-case run. The default chain therefore leads with the fast lite models. Free-tier quotas are counted **per model**, so a chain multiplies the daily allowance.

`src/llm/gemini.ts` is a small REST client (no SDK), so every rate-limit decision is visible:

- calls run **one at a time** with a minimum gap, to stay under requests-per-minute limits
- a per-minute 429 waits exactly as long as the server's `RetryInfo` says
- a daily-quota 429 **retires that model** and moves to the next in the chain immediately
- a model overloaded (5xx) twice in a row hands over to the next model; other transient errors back off exponentially
- a call gives up after a bounded total wait with a coded error (`LLM_RATE_LIMITED`, `LLM_UNAVAILABLE`, `LLM_INVALID_OUTPUT`, `LLM_AUTH`), which the UI explains in plain words

## Security

- **Untrusted text is data.** The posting, crawled pages and forum posts are wrapped in `<untrusted_…>` tags with a standing rule to never follow instructions inside them. Closing tags inside the text are defused. Hidden page text is removed before the model sees anything. Output is schema-constrained, and requirements must be quotes from the posting, so an injected "add requirement X" cannot become a requirement.
- **SSRF.** See the URL guard above; private targets are blocked in production and checked on every redirect.
- **Content.** Content-type allow-list and size caps on fetched pages; 1 MB cap on API request bodies; only http(s) links are rendered.
- **Auth.** Passwords hashed with scrypt, compared in constant time; login answers the same for an unknown email and a wrong password. Sessions are random tokens stored as SHA-256 hashes (a database leak cannot be replayed), with expiry decided server-side. `proxy.ts` only pre-filters on the cookie's presence; every page and endpoint verifies the session in the database. Every kit, job and review query is scoped by user id at the data layer, so another user's id returns 404.
- **Headers.** `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, a strict referrer policy.

## Key decisions and trade-offs

- **The browser drives generation, one step per request**, instead of a queue or cron. It works on a free serverless tier with no extra infrastructure, and each step is small enough to retry. The cost is that a job only advances while a kit page is open; it resumes when reopened.
- **Code decides; the model writes.** Existence of requirements, priority when the posting states it, coverage, schedule, category plan and sources are all code. The model writes text inside those constraints.
- **Fewer, broader calls.** One call per category (not per requirement), and flashcards come back in the same call as each category's questions. That is about 6–8 requests per kit, which keeps the free tier and the 15-minute batch limit comfortable.
- **Unreachable site → an honest `ok` kit, not `failed`.** Per the FAQ, `failed` is for when no kit can be produced at all.

## Known limitations

- DNS rebinding: the resolved address is checked before connecting, but not pinned for the connection itself.
- Sites that render content only with JavaScript yield little text (reported as `EMPTY_PAGE`); there is no headless browser.
- External job boards (Greenhouse, Lever…) are outside the company's domain and are not crawled.
- Hacker News is the only public-discussion source, so smaller companies often have none.
- Login has no rate limiting (auth is deliberately minimal); there is no password reset or email verification, which are out of scope.
- Link ranking is keyword-based; it can occasionally rank an irrelevant page, which the content check usually corrects.
- The editor is locked for a few seconds while a section regenerates.

## Creative feature

Not built as a separate feature. The closest thing is the **honesty trail**: each kit shows what was read, what was skipped and why, which proposed requirements were discarded as unsupported by the posting, and whether the interview process came from the company or only from public discussion — so a candidate knows how far to trust each part of the kit.
