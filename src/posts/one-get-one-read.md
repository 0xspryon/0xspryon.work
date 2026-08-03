---
title: 'One GET, One Read'
titleHtml: 'One GET, <em>One Read</em>'
summary: "A stored-markdown gadget in a newsroom's comments let me forge article reads — quietly poisoning the authenticated analytics the whole business ran on. A logic bug, not a payload."
standfirst: 'The payload was a markdown image. The vulnerability was a business decision.'
date: '2026-07-25'
tag: 'WRITEUP'
readingMinutes: 9
status: 'DISCLOSED'
chip: 'WRITEUP'
---

## 01_THE_PLATFORM

The target was a digital news publisher — editors write, readers read, and the number of reads is the currency everything else is priced in. That count isn't a vanity metric on this platform. It grades articles. It rewards the editors who wrote the best-performing ones. It tells the newsroom who their readers are, what they care about, and *when* a piece mattered — whether a story is evergreen or burned bright for a week and died. That signal feeds real editorial decisions.

So the read count isn't a display value. It's an input to the business. Keep that in mind — it's the whole story.

The one implementation detail that matters: **the platform counts a `GET` request for an article as a read by whoever made it.** Server-side. No scroll depth, no dwell time, no client confirmation. Fetch the article, you read it.

## 02_THE_DEAD_ENDS

I did the usual first pass on the client portal — XSS, SSRF, auth bypass, the standard rotation. Nothing. The app was tidy.

Then something small snagged. The **web** comment box is a plain WYSIWYG editor with HTML input disabled — locked down, nothing to chew on. But the **mobile** app's comment field supports a tiny slice of markdown: bold, italics, strikethrough. Two different comment surfaces, two different input models, one shared backend.

After a brainstorm with bit — my hackbot, aka *bit*, pun fully intended — we tried the obvious thing a limited markdown parser makes you try: a markdown image.

```md:COMMENT (mobile input)
Great read!
![](https://REDACTED/article/8842)
```

It was accepted. It didn't render in the mobile comment view. We shrugged and moved on, assuming the parser just allowlisted inline text formatting and dropped images on the floor.

That assumption was wrong, and it took a few days to find out.

## 03_THE_GADGET

Mid-testing, bit flagged something I'd have missed: the image comment *did* render — not on mobile, but in the **web** article view, where the latest comments are shown under the piece. The mobile parser stored the raw markdown; the web renderer happily turned it into a real `<img>` and fetched the `src`.

That's the gadget: **a comment posted through the mobile markdown path becomes an attacker-controlled outbound request fired from every web reader's browser** when they open the article. Whatever URL I put in that image loads, from their session, without their knowledge.

At that point the tiredness left my eyes. I had a stored, cross-surface request primitive. I just didn't yet know what to do with it.

## 04_FIVE_DAYS_AGAINST_A_WALL

I spent two days trying to weaponize it into something classic and got nowhere. Then five more. SameSite cookies shut the door on every account-takeover angle I could think of — no riding the session cross-site, no CSRF worth the name. I had the entire app model in my head and kept coming up empty.

Past bug-bounty scars taught me one thing though: persistence pops bugs. I was sure there was something here.

The break came when I stopped staring at the primitive and went back to staring at the *business*. I was looking at the read counter — the thing the whole platform is built around — and asked the only question that mattered: **how do I break this number?** And there was my gadget, waiting.

What if the image `src` isn't an image at all, but the URL of an *article*? Rendering the comment fires a `GET` to that article. If a `GET` is a read… I could manufacture reads.

To prove it I needed two facts nailed down:

1. **Which event the platform counts as a read.**
2. **What access controls sit on the path that triggers that event.**

You can't confirm the first without pinning the second.

## 05_PROVING_THE_TRIGGER

The access control turned out to be: none worth the name. A bare `GET` to an article path was enough. So I built a clean experiment to prove a raw fetch increments the count.

Constraints I set for a trustworthy test:

- **A very old, obscure article** dug out of the archive, so no genuine reader would wander in and poison the measurement.
- **Under 1k reads**, because past that threshold the UI rounds — it shows `1k` or `1.2k` instead of an exact integer, and I needed exactness.
- **The platform's local midnight**, the quietest possible window, to keep organic traffic near zero.

Then I sent **100** plain `GET`s to that article in Caido — raw requests, no JavaScript rendering phase, nothing that would fire secondary analytics. Just the fetch.

Three hours later the count had gone up by **exactly 100**. Not ~100. Exactly. The server-side handler was, in effect:

```text:PSEUDO
// article fetch handler
GET /article/:id
    article = db.load(id)

    // BUG: a bare fetch is treated as a human read.
    // For authenticated requests it's also attributed to that user.
    analytics.record_read(id, reader = session?.user)

    return render(article)
```

Then I ran the same idea through the gadget — the markdown-image comment pointing at the article — and watched a browser render fire the read. Same result. The primitive worked end to end.

## 06_THE_IMPACT_I_SAW

Proving impact was the hard part, and honestly the part I got *wrong* at first. I had no view into the newsroom's back office, so I could only reason from the outside.

What I could argue, and did:

- I can make **any article as popular as I want**, on demand.
- The article view auto-surfaces its **10 most recent comments**, so my gadget re-arms itself on every viewer.
- The **more reads an article racks up, the more likely it is to be promoted** into the app's discovery feed.

Net: I could puppet the discovery section into featuring any article I chose. I wrote it up as a **low** and submitted it through [bugbounty.ch](https://www.bugbounty.ch/), and it triaged as low. The publisher agreed and paid a  &l;1K€ bounty. I filed it away as a tidy little logic bug and moved on.

## 07_THE_IMPACT_I_MISSED

Three weeks later I got a mitigation-review invite. I checked their fix, confirmed it was mitigated properly — and *then* they explained why it had been quietly re-rated to **high**.

The read counter wasn't just a public popularity number. **For authenticated users, that forged image request went out with their auth tokens** — so the platform recorded *those specific, real readers* as having read whatever article I aimed the gadget at. And the entire internal analytics layer runs on authenticated reads:

- which editors/field agents are performing best, and who gets rewarded;
- what editorial line to lean into next;
- which article categories are good paywall candidates and which aren't.

My gadget didn't just inflate a vanity count. It could **corrupt the ground-truth dataset the business steers by** — attributing fabricated interest to real, identifiable readers, and pointing the newsroom down decisions built on a lie.

The reason a single `GET` ever equalled a read was the least glamorous cause imaginable: **tech debt**. One developer on the mobile app, busy with bigger fish when reads were implemented, shipped the fast version — count it server-side on fetch — instead of the correct version: client-side, only after a scroll-depth and dwell-time threshold. The proper rewrite had been on the backlog, postponed, for four months. My report landed in the middle of that postponement and made the case for it undeniable. The severity bump came with a healthy four-figure bounty.

## 08_WHAT_I_TOOK_AWAY

The lesson that stuck: **bugs aren't always an obscure payload — they're often a consequence of understanding the business logic and finding where you can bend it to your will instead of the devs'.** The payload here was a markdown image a beginner could write. The vulnerability was a decision about what counts as a read.

Understanding an app to its core *before* hunting is what surfaces logic bugs like this — the kind that are hard to weaponize even for an AI. bit was genuinely great at the discovery end: it caught the cross-surface render I'd written off. But when I leaned on it to help *prove impact*, it couldn't — and neither could I, at first. That gap between finding a primitive and articulating what it costs the business is exactly where AI-augmented hunting still falls short for me, and exactly what I'm practicing next.

> A read counter that trusts the request has already lost — it's counting fetches and calling them people.
>
> The obscure payload finds the bug; understanding the business is what proves it matters.
>
> Persistence popped this one. Five days against a wall, then one question: how do I break this number.
