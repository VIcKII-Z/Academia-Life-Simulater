# Search Agent Research Strategy

This document designs the next version of the Search Agent's research strategy. The goal is for
the Agent to stop researching generic "city + major + study-abroad life" information and instead
work case-by-case, pinning down a specific school, department, and program, then pulling
information from official pages and student experience that is actually useful for someone about
to enroll in that program.

> **Revision note**: the original draft (`search_agent_strategy.zh.md`, Chinese) already had a
> solid layered search strategy, fallback ladder, confidence tiers, and output schema — good
> enough to implement directly. This revision (present in both the Chinese and this English file)
> adds three things the draft was missing: (1) a new **Layer 0** of government/regulator-maintained
> structured data sources (College Scorecard, Discover Uni, CRICOS, JASSO, etc.) — these are more
> authoritative "true north" sources than any university's own website, and the original draft did
> not mention them at all; (2) an **"Implementation Reality Check"** section that compares this
> strategy against what the code actually does today (`searchAgent.ts` is a single
> `web_search_preview` call; `UserProfile` has no school/department/program fields yet), so the
> plan and the codebase don't drift apart; (3) this complete English translation.
>
> **Second revision note (accessibility check)**: after Phase 0/1 shipped, we directly tested
> whether these Layer 0 URLs actually return usable content to a plain web fetch (i.e. what a
> `web_search_preview`-only agent can do — it cannot call authenticated JSON APIs). Result: about
> half of them are JavaScript search apps that return an empty shell/cookie banner/bare search box
> when fetched directly — **College Scorecard's website** (its real data is API-only, requires an
> `api.data.gov` key), **CRICOS Course Search**, **Discover Uni**, **QILT**, and **JASSO**'s data
> tools all failed this test. The **UK Register of Student Sponsors**' real list is inside a
> downloadable spreadsheet attachment, not page text. What *did* work: **IPEDS/College Navigator's
> per-institution pages** (real server-rendered data, confirmed with a live Cornell lookup),
> **gov.uk** and **canada.ca** policy pages (fully static), **NCES Fast Facts**, and **Wikipedia**
> (reliable for institution facts/history/accreditation, but never for current tuition/deadlines/
> visa specifics). The prompt in `searchAgent.ts` has been updated accordingly: Layer 1 (the
> university/program's own official site) is now explicitly the default starting point, since it's
> the most reliably fetchable source there is; the Layer 0 registries are used opportunistically
> and the agent is told to stop retrying one the moment it returns thin/empty content, falling
> back to the school's own pages plus Wikipedia instead. See the "Layer 0 accessibility" note below
> for the updated per-source verdicts.

## Goals

The Search Agent should ultimately help a user understand, before they ever apply or enroll:

- What this specific program at this specific school actually teaches;
- What the department's and program's real requirements are;
- What international students need to prepare;
- The cost of living and lifestyle in the program's city;
- What concrete pressures this major, grade level, and city combination creates;
- How those pressures map onto the game's `health / mood / money` stats;
- Which facts are official and which are student opinion, and how confident we are in each.

User input should ideally go from coarse to fine-grained:

```json
{
  "country": "United States",
  "city": "New York",
  "school": "New York University",
  "department": "Computer Science",
  "program": "MS in Computer Science",
  "major": "Computer Science",
  "grade": "Master"
}
```

If the user hasn't provided school / department / program, the Search Agent should first search at
the city + major + grade level, and explicitly flag that "program-specific information is
insufficient" rather than pretending otherwise.

## Overall Search Principles

The Search Agent should search by priority, not treat every source as equally trustworthy.

Priority, highest to lowest:

0. **Official structured data sources / regulatory registries** (government/education-ministry/visa
   regulator-maintained structured data — see "Layer 0" below)
1. Program official pages
2. Department official pages
3. University catalog / graduate bulletin
4. Program handbook / department handbook
5. International student office / visa / work authorization pages
6. Tuition / financial aid / cost of attendance pages
7. Housing / campus life / student support official pages
8. Career services / internship / CPT / OPT official pages
9. Student forums: Reddit, GradCafe, Medium, personal FAQs, school subreddits
10. Third-party study-abroad databases, ranking sites, aggregators
11. City cost-of-living sites and public statistics

Layer 0 is the new top-priority tier added in this revision: it's not "what the school says about
itself," it's "what a regulator / government statistical agency has independently confirmed." That
makes it more authoritative than a university's own marketing page, and especially useful for
verifying visa eligibility, real tuition figures, and whether a program is officially certified to
enroll international students. Official sources (Layers 0-8) are used to establish facts; forums
and student experience (Layer 9) fill in the felt experience, risks, details, and hidden costs;
third-party databases (Layer 10) are cross-reference only.

## Layer 0: Official Structured Data Sources ("True North" / Ground-Truth Sources)

This is the single most important addition in this revision relative to the original draft: don't
rely solely on an LLM's freeform `web_search` over web pages. Prioritize querying
government/regulator-maintained **structured, verifiable** data first. These sources typically have
stable APIs or downloadable open datasets that return structured fields (not prose that needs to be
re-summarized), which maps cleanly onto `program_profile` / `report` fields — and their credibility
is inherently higher than any university's own marketing page, since it doesn't depend on the
school's self-reporting.

Known free-or-nearly-free authoritative sources, by country/region:

### United States

| Source | Use | Access |
| --- | --- | --- |
| **College Scorecard API** (U.S. Department of Education, `api.data.gov`) | Official cost, average debt, post-graduation earnings, and admit-rate data by school + CIP program code | Free API key, REST, officially documented |
| **IPEDS / College Navigator** (NCES) | Official institution-level stats: tuition breakdown, housing, student-faculty ratio, graduation/retention rate | Public datasets + College Navigator site, bulk-downloadable |
| **Study in the States / SEVP School Search** (ICE, DHS) | Verifies whether a school is SEVP-certified to enroll F-1 international students | Official school search — lets you *verify* rather than assume eligibility |
| **Federal Student Aid (FAFSA) School Code Search** | Verifies a school's federal ID code; cross-checks that an institution is real | Official lookup tool |

### United Kingdom

| Source | Use | Access |
| --- | --- | --- |
| **Discover Uni** (official, data sourced from HESA + Office for Students) | Official per-course tuition, teaching format, employment rate, and graduate salary data | Website + open data download (the Unistats dataset) |
| **UK Register of Student Sponsors** (UKVI / Home Office) | Verifies whether a school is licensed to sponsor a Student visa | Official published register — direct visa-eligibility check |

### Canada

| Source | Use | Access |
| --- | --- | --- |
| **Designated Learning Institutions (DLI) List** (IRCC) | Official list of which schools may enroll study-permit holders | Official downloadable list |
| **EduCanada / Universities Canada** | Official program and institution directory; cross-checks that a program name is genuine | Official website |

### Australia

| Source | Use | Access |
| --- | --- | --- |
| **CRICOS Course Search** (Australian Government) | Every course eligible to enroll international students is officially registered here, with estimated tuition, duration, campus, and visa eligibility | Official searchable registry, structured per-course data |
| **QILT – Compare Courses** (government-funded teaching-quality indicators) | Official employment rate, starting salary, and student satisfaction, per course | Official site, open data |

### Japan

| Source | Use | Access |
| --- | --- | --- |
| **JASSO (Japan Student Services Organization)** | Official international-student statistics, scholarship database, cost-of-living guides | Official site, multilingual |
| **MEXT (Ministry of Education) study-abroad info** | Official scholarship, visa, and language-school accreditation info | Official site |

### Cross-border reference (cross-check only, not a primary authoritative source)

- **QS / THE ranking APIs**: commercial data, limited free tier — useful as supplementary
  reference only, not for confirming hard facts.
- **UNESCO / OECD education statistics**: good for country-level macro figures (e.g. average
  tuition ranges), not for program-level detail.

### Usage rules

1. Whenever the profile's country matches one of the sources above, the Search Agent should query
   these structured sources **before or in parallel with** Layer 1 (program official pages).
2. Fields returned by these sources (tuition, visa eligibility, graduation rate, starting salary,
   etc.) should be tagged `source_type: "official_registry"`, with confidence *above*
   `program_official` — since it doesn't depend on the school's own claims, but on regulatory
   record.
3. If a structured source conflicts with the school's own website (e.g. the school's site quotes a
   different tuition figure than College Scorecard), note the conflict in `gaps` rather than
   silently picking one.
4. Not every country/region has a matching structured source yet. When there's no coverage, go
   straight to Layer 1 and mark `source_coverage.official_registry` as `false`.
5. Most of this layer currently requires additional API integration or data-fetching work — it is
   **not** something the existing single `web_search_preview` call can do out of the box. See
   "Implementation Reality Check" near the end of this document for the concrete gap.

### Layer 0 accessibility — verified per-source (added in the second revision)

A `web_search_preview`-only agent can fetch and read plain web pages, but it **cannot call an
authenticated JSON API** and generally can't execute the client-side JavaScript that many
government "search tool" websites need to render real content. We tested each Layer 0 URL directly
to see what a plain fetch actually returns:

| Source | Verdict | Why |
| --- | --- | --- |
| IPEDS / College Navigator (US) | ✅ Reliable | Per-institution pages are server-rendered; a live fetch of Cornell's page returned real retention/graduation-rate numbers. |
| gov.uk policy pages (UK) | ✅ Reliable | Fully static content (e.g. Student visa rules page fetched cleanly). |
| canada.ca policy pages (Canada) | ✅ Reliable | Same — static, real content (e.g. study-permit overview page). |
| NCES Fast Facts (US) | ✅ Reliable | Static report pages, real numbers returned. |
| Wikipedia (institution pages, cross-border) | ✅ Reliable, but reference-only | Real content, but never treat it as authoritative for current tuition/deadlines/visa rules — tag `source_type: "reference"`, confidence `medium`. |
| College Scorecard's website (US) | ❌ Not reliably fetchable | It's a client-rendered React app; a direct fetch of a real per-school URL returned almost nothing. Its actual data only exists behind the `api.data.gov` API, which requires a key and real integration code — not something a web-search tool can do. |
| CRICOS Course Search (Australia) | ❌ Not reliably fetchable | Homepage is a JS search-tool shell; no per-course data in a plain fetch. |
| Discover Uni (UK) | ❌ Not reliably fetchable | Cookie-banner shell on direct fetch; underlying data loads via JS. |
| QILT (Australia) | ❌ Not reliably fetchable | Same pattern as Discover Uni. |
| JASSO data tools (Japan) | ❌ Not reliably fetchable | Static top-level pages exist but are thin/placeholder; the useful data tools are JS apps. |
| UK Register of Student Sponsors | ⚠️ Partial | The gov.uk publication page itself is real and static, but the actual sponsor list is inside a downloadable spreadsheet attachment, not page text — a browsing-only agent can't open/parse it. |
| HESA statistical releases, IIE Open Doors | ❌ Not reliably fetchable | Both blocked/thin on direct fetch in testing (403 or JS shell). |

**Practical takeaway**: don't treat "Layer 0" as a guaranteed data source. The agent should try it
opportunistically, but the *actually* reliable backbone of this whole strategy is Layer 1 — the
school/program's own official website — plus Wikipedia and the handful of verified-static
government policy pages above as supplementary grounding. Turning the ❌ rows into real sources
requires genuine API integration (see "Implementation Reality Check"), not prompt engineering.

## Layer 1: Program Official Pages

This is the most important source category.

Search Agent should prioritize queries like:

```text
{school} {program} official
{school} {department} {program} curriculum
{school} {program} degree requirements
{school} {program} admissions international students
{school} {program} tuition
```

Extract:

- Official program name;
- Which school/department it belongs to;
- Degree type: MS, MEng, MSc, PhD, BA, BS, etc.;
- Full-time / part-time / residential / online;
- Whether it's eligible for a student visa;
- Program length;
- Credit requirements;
- Core curriculum;
- Concentrations / tracks;
- Capstone / thesis / research project;
- Whether an internship/co-op is required;
- Admission requirements;
- Application deadlines;
- Language test requirements;
- Prerequisites;
- Program contact;
- Whether there's an FAQ.

This information primarily affects: `academic`, `career`, `visa`, `money`, and the story's courses,
projects, labs, internships, and graduation-pressure nodes.

### Example

A page like Johns Hopkins' MSE Computer Science official page will give program length, course
requirements, tuition, deadlines, and research-project info. This kind of information should be
collected first, because it directly determines the player's academic path within that program.

## Layer 2: Department Official Pages

If the program page is thin, or the user only gave a department (not a specific program), search
the department page.

Queries:

```text
{school} {department} graduate programs
{school} {department} faculty research areas
{school} {department} graduate student handbook
{school} {department} advising graduate students
{school} {department} assistantship funding
```

Extract:

- Department research directions;
- Faculty / labs / research groups;
- Advising model;
- Graduate community;
- TA / RA / assistantships;
- PhD vs. Master differences;
- Lab culture / research expectations;
- List of programs within the department;
- Department handbook.

This is especially important for PhD and research-master profiles.

### Effect on the game

If the user picked PhD, the Design Agent should prioritize department information to generate:
advisor communication, group meetings, lab deadlines, funding, publication pressure, qualifying
exams, thesis proposals, conference travel, TA duties.

If the user picked undergraduate, department info is used more for course structure, major
requirements, projects, and career tracks.

## Layer 3: University Catalog / Graduate Bulletin

The catalog is usually more formal and structured than a marketing page.

Queries:

```text
{school} catalog {program}
{school} graduate bulletin {program}
{school} academic catalog {department} {program}
{school} degree requirements {program} catalog
```

Extract: official degree requirements, credits, required courses, elective rules, GPA
requirement, residency requirement, academic standing, transfer credit, internship/thesis/capstone
rules.

The catalog serves as a fact-check source when the program page is incomplete.

## Layer 4: Program / Department Handbook

The handbook is a critical source — it often contains real constraints the program page won't
mention.

Queries:

```text
{school} {department} graduate handbook pdf
{school} {program} student handbook
{school} {department} PhD handbook
{school} {department} MS handbook
```

Extract: degree-progress timeline, advisor assignment, milestones, qualifying exam,
thesis/dissertation, TA/RA rules, funding policy, full-time enrollment, leave/probation,
international-student notes, internship/CPT notes, workload and course-selection guidance.

### Example sources

Research turned up handbooks at multiple CS departments — Rice, CMU, Penn State, Indiana
University, University of Kentucky, and others. These handbooks are often better for building real
challenges than an admissions page.

### Effect on the game

Handbook info converts into: academic nodes, advisor nodes, funding nodes, TA-duty nodes,
visa/CPT nodes, progress-crisis nodes.

## Layer 5: International Student Office

The authoritative source for visa, work, CPT/OPT, and status-maintenance information.

Queries:

```text
{school} international student office CPT OPT
{school} international students visa requirements
{school} F-1 CPT OPT international office
{school} immigration full-time enrollment international students
{country} student visa work hours official
```

Extract: student visa type, full-time enrollment requirement, CPT/OPT/internship rules, on-campus
work, off-campus work, work-hour limits, I-20/CoE/CAS-style documents, proof of funds, health
insurance, status-maintenance notes.

For US programs, check the school's international office first, then Study in the States, ICE,
USCIS. For UK/Canada/Australia/Japan, check the school's international office plus the relevant
country's immigration authority.

### Effect on the game

This produces: visa document deadlines, work-hours-vs-study tradeoffs, internship authorization,
status-maintenance pressure, and conflicts between `money` and `academic`.

## Layer 6: Tuition / Cost of Attendance / Financial Aid

The single most important source for the `money` stat.

Queries:

```text
{school} {program} tuition international students
{school} cost of attendance international graduate
{school} tuition fees {program}
{school} financial documentation international students
{school} graduate funding {department}
```

Extract: tuition, fees, health insurance, estimated living expenses, proof of funds, payment
deadlines, scholarships, assistantships, tuition waivers, whether Master's programs offer funding,
whether PhD funding is guaranteed, hidden costs (books, equipment, transportation, student fees).

Priority order: (1) school's official tuition page, (2) international office's estimated-expenses
page, (3) tuition mentioned on the program page, (4) department funding page, (5) third-party
databases as supplementary cross-check only.

## Layer 7: Housing / Campus Life / Student Support

Used to build lived-in detail.

Queries:

```text
{school} graduate housing
{school} off campus housing international students
{school} student life graduate students
{school} counseling international students
{school} student clubs international students
{city} student housing {school}
```

Extract: on-campus housing availability, off-campus neighborhoods, commute options, rent ranges,
roommates, safety, counseling, student clubs, international community, graduate student
association, food/meal plans. Affects `health`, `mood`, `money`.

## Layer 8: Career Services / Internship / Industry Links

Career information should stay close to the specific program and city.

Queries:

```text
{school} {program} career outcomes
{school} {department} internship
{school} career services international students CPT
{school} {program} employment report
{city} {major} internship opportunities international students
```

Extract: whether internships are common, built-in co-ops, career fairs, employment reports, local
industry, alumni outcomes, employer connections, international-student work-authorization limits,
job opportunities for this major in this city.

Examples:

- CS + Silicon Valley: abundant internships, but fierce competition, high rent, intense interview
  pressure.
- Business + New York: strong networking and internship access, but higher social/wardrobe/commute
  costs and psychological pressure.
- PhD + Tokyo: industry internships may hinge on advisor approval, research progress, and Japanese
  fluency.

## Layer 9: Forums and Student Experience

Forums are not a first-priority factual source, but they're excellent for supplementing "what it's
actually like."

Usable sources: school subreddits, `r/gradadmissions`, `r/csMajors`, The GradCafe, Medium student
write-ups, personal FAQs/blogs, Facebook/Discord/WeChat groups (if accessible), student housing
guides, forum discussions of course difficulty, program pace, housing, TA duties, job search.

Queries:

```text
site:reddit.com {school} {program} workload
site:reddit.com {school} {program} international students
site:reddit.com {school} {program} housing
site:reddit.com {school} {program} internship
site:reddit.com/r/gradadmissions {school} {program}
site:thegradcafe.com {school} {program}
{school} {program} student experience blog
{school} {program} FAQ international students
```

Extract: felt workload, which courses are considered hard, whether the first semester tends to be
overloaded, housing pain points, commute, whether TA/RA duties are realistic, internship/job-search
pressure, hidden problems international students run into, social isolation/city-adaptation
issues, "things students mention that the official pages don't."

### Confidence handling

Forum information must be tagged:

```json
{
  "claim": "Students often warn against taking more than 18 credits in the first semester.",
  "source_type": "student_forum",
  "confidence": "medium",
  "needs_official_confirmation": true
}
```

Forums should never be used alone to establish tuition, visa rules, deadlines, or other hard facts
— those must be confirmed by official sources.

## Layer 10: Third-Party Study-Abroad Databases and Ranking Sites

Supplementary only — never top priority.

Usable sources: Yocket, GradPilot, QS / US News / THE, MastersPortal, FindAMasters, Peterson's,
other study-abroad agencies/databases.

Good for: program names, rough tuition figures, deadlines, rankings, application materials,
program overviews, possible third-party reviews.

Not suitable as the sole confirmation for: current tuition, visa rules, official deadlines,
funding policy, whether a program supports F-1/student visas, course requirements.

## Fallback Ladder

The Search Agent should degrade gracefully, level by level.

### Case 1: Program official page found

Use, in order: (1) program page, (2) catalog, (3) handbook, (4) international office, (5)
tuition/cost, (6) housing/career, (7) forum supplement. This is the ideal case.

### Case 2: No program page, but a department page exists

Use: (1) department graduate programs, (2) matching degree in the catalog, (3) department
handbook, (4) faculty/research groups, (5) international office, (6) tuition, (7) forums.

Output must note: *"Program-specific official page not found. Used department-level sources
instead."*

### Case 3: No department page, but school + major direction is known

Use: (1) university catalog, (2) graduate-school program list, (3) admissions page, (4)
tuition/cost, (5) international office, (6) city + major industry info, (7) forum/student posts.

Output must flag that the granularity is coarser than program-level.

### Case 4: Very little information about the school

Use: (1) country/city/major general info, (2) similar schools or similar programs, (3) official
immigration authority, (4) city cost of living, (5) industry employment info, (6) forums.

Output must state explicitly: *"No reliable official program-level source found. The report uses
city/major-level fallback information."*

### Case 5: Forum information is missing

Don't fabricate. Substitute with: program handbook, course catalog, student-life office, housing
office, career services, international-office FAQ, alumni outcome page, LinkedIn alumni profiles
(if accessible), YouTube/blog/Medium student experience (if available).

## Recommended Search Workflow

### Step 1: Parse user input

Split into:

```json
{
  "country": "string",
  "city": "string",
  "school": "string | optional",
  "department": "string | optional",
  "program": "string | optional",
  "major": "string",
  "grade": "Undergraduate | Master | PhD | Exchange | High School"
}
```

If school/department/program are missing, the Search Agent should try to infer from search
results, but must never pretend to be certain when it isn't.

### Step 2: Check Layer 0, then find the program's official source

Query Layer 0 structured sources first if the country has coverage (see above), then:

```text
{school} {program} official
{school} {department} {program}
{school} {program} curriculum
{school} {program} admissions
```

Confirm a hit by checking: the URL is on the school's official domain; the title includes the
program name; the content includes degree/curriculum/admissions/tuition/FAQ; it's not a
third-party ranking/agency page.

### Step 3: Fill in catalog and handbook

```text
{school} {program} catalog
{school} {department} graduate handbook pdf
{school} {program} handbook
```

Confirms courses, credits, milestones, funding, academic standing.

### Step 4: Check international students and visas

```text
{school} international students visa {program}
{school} international office CPT OPT
{country} student visa work hours official
```

US: school international office, Study in the States, ICE, USCIS, school CPT/OPT pages. UK /
Canada / Australia / Japan: school international office + the relevant country's immigration
authority + school visa guide.

### Step 5: Check cost and funding

```text
{school} {program} tuition
{school} cost of attendance international students
{school} graduate funding {department}
{school} assistantship {program}
```

Distinguish: tuition, living costs, mandatory fees, health insurance, proof of funds,
scholarships, TA/RA, Master's vs. PhD funding differences.

### Step 6: Check housing / life / city

```text
{school} graduate housing
{school} off campus housing
{city} student housing {school}
{city} cost of living international students
{school} student life international students
```

Get: how tight housing is, where to live, commute, safety, cost of living, campus support,
community.

### Step 7: Check career / internship

```text
{school} {program} career outcomes
{school} {department} internship
{school} career services international students
{city} {major} internship jobs international students
```

Get: whether the program has internships, career fairs, local industry, international-student
work limits, whether local language matters, opportunities for this major in this city.

### Step 8: Check forums and student experience

```text
site:reddit.com {school} {program} workload
site:reddit.com {school} {program} housing
site:reddit.com {school} {program} international students
site:thegradcafe.com {school} {program}
{school} {program} student experience blog
{school} {program} FAQ international students
```

Forum info is used only for: felt workload, housing pain points, course-selection advice,
social/isolation issues, program value, career pressure, hidden costs.

## Suggested Output Structure

The next Search Agent version should output a richer structure than the current flat 9 fields.

```json
{
  "mode": "live_search",
  "profile": {
    "country": "United States",
    "city": "New York",
    "school": "New York University",
    "department": "Computer Science",
    "program": "MS in Computer Science",
    "major": "Computer Science",
    "grade": "Master"
  },
  "source_coverage": {
    "official_registry": true,
    "program_official": true,
    "department_official": true,
    "catalog": true,
    "handbook": false,
    "international_office": true,
    "tuition": true,
    "housing": true,
    "career": true,
    "student_forum": true
  },
  "program_profile": {
    "official_name": "string",
    "degree_type": "string",
    "department": "string",
    "duration": "string",
    "delivery_mode": "full-time / part-time / residential / online",
    "visa_eligible_notes": "string",
    "curriculum": ["string"],
    "milestones": ["string"],
    "prerequisites": ["string"],
    "admissions": ["string"],
    "deadlines": ["string"],
    "funding": ["string"]
  },
  "student_life_profile": {
    "housing": "string",
    "commute": "string",
    "campus_support": "string",
    "community": "string",
    "safety": "string",
    "climate": "string"
  },
  "career_profile": {
    "local_industry": "string",
    "internship": "string",
    "work_authorization": "string",
    "language_or_networking_requirements": "string"
  },
  "report": {
    "cost_of_living": "string",
    "academic": "string",
    "visa": "string",
    "culture_shock": "string",
    "community": "string",
    "career": "string",
    "safety": "string",
    "climate": "string",
    "part_time_work": "string"
  },
  "gameplay_signals": {
    "health": ["string"],
    "mood": ["string"],
    "money": ["string"],
    "city_major_grade_specific_challenges": ["string"]
  },
  "sources": [
    {
      "title": "string",
      "url": "string",
      "source_type": "official_registry | program_official | department | catalog | handbook | international_office | tuition | housing | career | forum | third_party",
      "confidence": "official_registry | high | medium | low",
      "used_for": ["academic", "money", "visa"]
    }
  ],
  "gaps": [
    "Could not find official program handbook.",
    "Student forum evidence is sparse."
  ]
}
```

## Source Confidence Rules

### Official registry confidence (new, highest tier)

Sources: College Scorecard, IPEDS (US); Discover Uni, UK Register of Student Sponsors (UK); DLI
List (Canada); CRICOS, QILT (Australia); JASSO, MEXT (Japan); other government/regulator-maintained
registries or statistical databases.

Used for: hard verification of visa/enrollment eligibility (e.g. "can this school sponsor an
international student visa"), officially-reported tuition/graduation rate/starting salary, and as
the tie-breaker when it conflicts with High confidence sources.

This tier ranks above High confidence because it doesn't depend on the school's own claims — it's
independent regulatory data. If it conflicts with a High confidence source, prefer this tier and
log the conflict in `gaps`.

### High confidence

Sources: program official pages, department official pages, catalog, handbook, international
office, school tuition/cost pages, government immigration authorities.

Used for: deadlines, curriculum, tuition, visa, work authorization, degree requirements, official
funding.

### Medium confidence

Sources: student blogs, Medium, Reddit, GradCafe, school subreddits, alumni FAQs, third-party
databases.

Used for: workload, housing difficulty, felt course experience, program value, social pressure,
hidden costs.

### Low confidence

Sources: SEO study-abroad articles, unattributed agency pages, stale posts, information whose
timeframe can't be confirmed.

Reference only — never a core fact.

## How to Ensure the Research Is Complete and Actionable

### Minimum viable standard

Find at least: 1 program or department official source; 1 tuition/cost source; 1 international
student/visa source; 1 city living/housing source; 1 career or internship source. If no program
official source is found, this must be flagged in the output.

### Ideal standard

Ideally find: program official page, catalog, department handbook, international office,
tuition/cost, housing/student life, career/internship, and 2-3 student-experience sources.

### Disallowed behaviors

The Search Agent must never: fabricate program requirements; fabricate tuition; fabricate visa
policy; treat forum posts as official fact; pass off another school's program as the requested
one; omit stating that program-level information is missing; write only generic city-level content
while ignoring school and program specifics.

## What the Design Agent Needs Most

1. **Program intensity** — drives academic nodes and `health`/`mood` pressure.
2. **Funding and cost** — drives `money` pressure.
3. **Housing and commute** — drives `health`/`money` tradeoffs.
4. **International student status** — drives visa/CPT/work-authorization nodes.
5. **Major-specific tasks** — drives whether the story actually differs by major.
6. **Grade-specific lifestyle** — drives undergrad vs. master's vs. PhD experience differences.
7. **Hidden risks from student experience** — drives whether the story feels real.

## Worked Example: How the Search Agent Handles One Input

Input:

```json
{
  "country": "United States",
  "city": "Ithaca",
  "school": "Cornell University",
  "department": "Computer Science",
  "program": "MEng in Computer Science",
  "grade": "Master"
}
```

Search order:

1. `College Scorecard: Cornell University, CIP 11.0101 (Computer Science)` — Layer 0, tuition/debt/earnings baseline
2. `Cornell MEng Computer Science official`
3. `Cornell MEng Computer Science curriculum`
4. `Cornell MEng Computer Science FAQ`
5. `Cornell Computer Science MEng tuition`
6. `Cornell international students CPT OPT` (+ check school against SEVP School Search)
7. `Cornell graduate housing Ithaca`
8. `Cornell MEng Computer Science student experience`
9. `site:reddit.com Cornell MEng CS workload`
10. `Cornell MEng CS Medium student experience`

Likely extracted facts: MEng is a professional (not research) master's; coursework and project
requirements; advice against overloading the first semester; Ithaca housing needs to be secured
early; winter and commute affect daily life; the international office handles visas and work
authorization; career prep matters a lot.

Gameplay signals handed to the Design Agent:

- `money`: tuition, housing, professional/career costs;
- `health`: winter, course overload, commute;
- `mood`: new-city isolation, project pressure, networking confidence;
- Challenges: first-semester course load, housing search, career fair, project deadlines.

## Implementation Reality Check

Before moving on Phases 1-3 below, it's important to be explicit about the gap between this
strategy and what the code actually does today, so planning and implementation don't drift apart.

### Current state (as of this revision)

- `backend/src/agents/searchAgent.ts`'s `runSearchAgentLive` is a **single**
  `client.responses.create()` call using the `web_search_preview` tool. The model decides on its
  own what and how many times to search, then produces the final JSON in one shot. There is no
  staged/layered search plan, and no source list, confidence, or gaps fields in the output.
- `UserProfile` (`backend/src/types.ts`) currently only has `country / city / major / grade` — **no
  `school / department / program`**. The frontend `QuizFlow.tsx` only collects those same four
  fields. In other words, the case-by-case (down to a specific school/program) vision this document
  describes isn't wired up at the product input layer yet.
- No Layer 0 structured-data API is integrated (College Scorecard, Discover Uni, CRICOS, etc.) —
  everything currently comes from the model's own `web_search_preview` tool, so coverage and
  reliability are entirely bounded by whatever pages the model happens to find.

### What it actually takes to implement this document

1. **Schema changes**: add optional `school / department / program` to `UserProfile`; add matching
   optional steps to `QuizFlow.tsx` (allowing them to be skipped, falling back to city+major level);
   `buildCacheStoryId`'s hash payload must also include these new fields, or different
   schools/programs will incorrectly collide on the same cache slot.
2. **Layer 0 integration**: start with College Scorecard (US) as the pilot — it has a free API key
   and a simple REST interface, making it the cheapest way to validate the hypothesis that
   "structured official data meaningfully improves realism." Other regions' Layer 0 sources can
   follow later.
3. **Multi-round search executor**: the `web_search_preview` tool already lets the model call search
   multiple times within a single `responses.create` call (at its own discretion), but to strictly
   follow this document's staged order (program → catalog → visa → tuition → housing → career →
   forum) and record per-stage hits separately, you need to **explicitly split this into multiple
   `responses.create` calls**, chained via `previous_response_id`, each focused on one stage and
   asked to return only that stage's structured result, merged into the full report afterward by
   code. This is slower and more expensive than the current single call, and needs the search-budget
   guardrail below.
4. **Search budget limit**: multi-round search meaningfully increases latency and token/request
   cost. Recommend capping each generation at, say, 6-8 search stages with at most 1-2 tool calls
   per stage; stages beyond budget are marked as `gaps` rather than retried indefinitely.
5. **Output schema migration**: the `ResearchReport` type (`backend/src/types.ts`) needs to move from
   today's flat 9-field structure to the nested structure in "Suggested Output Structure" above
   (`source_coverage` / `program_profile` / `student_life_profile` / `career_profile` / `sources` /
   `gaps`), and the Design Agent's prompt needs a matching update to consume these new fields.

### Recommended rollout order

Ordered by cost/benefit — you don't have to do all of it before shipping anything:

1. Schema changes (low cost, unblocks everything else);
2. Upgrade the prompt to this document's layered structure, but still as a single
   `web_search_preview` call (medium cost, immediate realism boost);
3. Integrate College Scorecard as the first Layer 0 source (medium cost, validates the "official
   structured data" hypothesis);
4. Multi-round search executor + search-budget control (high cost — only do this once the earlier
   steps have proven their value).

## Next Steps

To make the Search Agent genuinely case-by-case, roll out in four phases (the original draft's
three phases, plus a new Phase 0 for schema/Layer 0 groundwork).

### Phase 0: Schema and Layer 0 pilot

- Add optional `school / department / program` to `UserProfile`;
- Update `QuizFlow.tsx` with matching optional inputs;
- Update `buildCacheStoryId`'s hash payload;
- Integrate the College Scorecard API as the first Layer 0 source.

### Phase 1: Prompt upgrade

Add to the current Search Agent prompt: school/department/program fields; source priority; source
coverage; gaps; sources list; program_profile; student_life_profile; career_profile.

### Phase 2: Multi-round search plan

Don't do a single broad `web_search` call. Have the Search Agent search in stages: (1) official
program, (2) catalog/handbook, (3) international/visa, (4) tuition/housing, (5) career, (6) forums.
Record which sources hit and which gaps remain at each stage. Technically this requires splitting
into multiple `responses.create` calls chained via `previous_response_id` — see "Implementation
Reality Check" above.

### Phase 3: Reliability scoring

Attach to every claim: `source_type` (including the new `official_registry`); `confidence`
(including the new official-registry tier); `whether_official`; `used_for`; `needs_confirmation`.

This lets the Design Agent prioritize high-confidence facts and treat forum information as
experiential color rather than hard rules.
