# Muhurat — business model

Researched 2026-10-29 (sources listed inline). The decision, then the evidence.

## The product in one sentence

Muhurat is the deadline-first opportunity radar for students: it ingests real
contests, hackathons and scholarships from public sources, ranks them by time
remaining, and converts them into reminders that reach the student's own device.

## Why this wins (market evidence)

- **Demand is proven by incumbents.** Unstop (India's leading platform, top job
  finder on Google Play) and Campus Ninjas (instant-alert Android app) both
  validate that students want opportunity flow pushed to them, not searched for.
- **The gap is fragmentation plus deadlines.** Incumbents specialise (jobs OR
  hackathons OR scholarships) or are employer-facing first. None treats the
  *deadline countdown* as the product. Muhurat's unit is "a moment you must not
  miss", with time remaining on every card.
- **Trust is the differentiator students actually feel.** Every Muhurat item
  links to its source, every fetch is snapshotted, unparsed dates say "see
  source" instead of a guessed date. Aggregators die of stale-listing
  skepticism; provenance is the answer.

## Model: freemium B2C + featured listings B2B

1. **Free (acquisition):** full live feed, filters, search, save + `.ics`
   export. This is the whole current app — free forever, because the feed is
   the network effect.
2. **Muhurat Pro (₹99/mo, student ₹49):** personalised keyword/region watches
   with web-push digests, multi-calendar sync, deadline risk scoring (portfolio
   aware: "you have 3 deadlines in the same week"), and historical stats.
   Paying for *reliability of never missing out* is the strongest willingness-
   to-pay lever the student market shows (test-prep and alert apps monetise the
   same anxiety).
3. **Featured listings (B2B, the margin):** organisers, universities and
   scholarship funds pay for verified, clearly-labelled placement at the top of
   the matching feed — labelled "featured", never mixed into organic ranking
   (the provenance rule makes this enforceable and trustworthy). Employers pay
   Unstop for exactly this reach; Muhurat sells it at student-feed precision.
4. **Affiliate (later, labelled):** exam/test-prep partnerships, only inside
   the "prepare for this" slot on relevant items.

## Name

**Muhurat** — "the right moment". Distinctive, meaningful to the target market,
deadline-native. Known collision to clear before scale: BSE's annual "Muhurat
trading" session (finance category, different class) — do a formal trademark
search in class 9/35/41 before the store launch. Alternates researched and
rejected as taken: Mauka (existing student-opportunity portal, Inc42-featured),
Avasar (existing earning app + scholarship foundation).

## Competitive positioning

| | Unstop | Campus Ninjas | InternAtlas | **Muhurat** |
|---|---|---|---|---|
| Deadline-first UX | no | alerts only | no | **every card** |
| Provenance per item | partial | no | no | **snapshot + source link** |
| Works without accounts | yes | no | yes | **yes** |
| Offline reminders | app push | app push | no | **device calendar (.ics), works offline** |
| Verified-feature revenue | yes | no | no | **labelled, provenance-enforced** |

## Go-to-market

1. Ship the PWA free to student communities (Discord/WhatsApp college groups) —
   the `.ics` export spreads it: every exported calendar markets Muhurat.
2. Seed with the three live sources; add sources per community demand (each is
   a config entry, and the ingest architecture is source-agnostic).
3. Pro (₹49) launches when watches + web-push ship; featured listings when
   weekly active users pass 5k.

## Honest boundaries

- Play Store distribution needs the owner's developer account (see
  [`PLAYSTORE.md`](PLAYSTORE.md)); the PWA is the shippable product today.
- Web-push digests (Pro's core) need a VAPID keypair (generable locally) and a
  hosted deployment with a domain — deliberately deferred until hosting exists.
