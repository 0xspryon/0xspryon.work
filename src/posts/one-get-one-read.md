---
title: 'One GET, One Read'
titleHtml: 'One GET, <em>One Read</em>'
summary: "A stored-markdown gadget in a newsroom's comments let me forge article reads and quietly poison the authenticated analytics the business relied on."
standfirst: 'The payload was a markdown image. The vulnerability was a business decision.'
date: '2026-08-01'
tag: 'WRITEUP'
readingMinutes: 7
status: 'DISCLOSED'
chip: 'WRITEUP'
---

## 01_THE_PLATFORM

The target was a digital news publisher where article reads influenced much more than the number shown on a page. The count helped grade articles, reward the editors behind the best-performing work, and show the newsroom what readers cared about. It also showed whether a story had lasting interest or only performed well for a few days. Editors used that information when deciding what to publish next.

The read count directly affected business decisions, which became important later.

The one implementation detail that matters: **the platform counts a `GET` request for an article as a read by whoever made it.** Server-side. No scroll depth, no dwell time, no client confirmation. Fetch the article, you read it.

## 02_THE_DEAD_ENDS

I did the usual first pass on the client portal: XSS, SSRF, auth bypass, and the standard rotation. Nothing. The app was tidy.

Then something small caught my attention. The **web** comment box is a plain WYSIWYG editor with HTML input disabled. The **mobile** app, however, supports a small slice of markdown for bold, italics, and strikethrough. Both clients write comments to the same backend despite handling the input differently.

After a brainstorm with *bit* (my hackbot), we tried the obvious thing a limited markdown parser makes you try: a markdown image.

```md:COMMENT (mobile input)
Great read!
![](https://REDACTED/profiles/my_profile_pictur.png)
```

It was accepted. It didn't render in the mobile comment view. We shrugged and moved on, assuming the parser just allowlisted inline text formatting and dropped images on the floor.

That assumption was wrong, and it took a few days to find out.

## 03_THE_GADGET

Mid-testing, bit flagged something I'd have missed. The image comment did not render on mobile, but it *did* render in the **web** article view where the latest comments appear. The mobile parser stored the raw markdown, and the web renderer turned it into a real `<img>` and fetched the `src`.

A comment posted through the mobile markdown path could therefore trigger an attacker-controlled request in a web reader's browser when they opened the article. Browser credentials would only accompany requests where origin and cookie policy allowed it, but same-origin article URLs were enough for what followed.

At that point the tiredness left my eyes. I had a stored, cross-surface request primitive. I just didn't yet know what to do with it.

## 04_FIVE_DAYS_AGAINST_A_WALL

I spent two days trying to turn it into something more familiar and got nowhere, then kept at it for five more. SameSite cookies blocked every account-takeover angle I could think of. I could not ride the session cross-site, and none of the CSRF or CSPT ideas held up.

Previous bounty work made me reluctant to drop a useful primitive just because the obvious paths had failed.

The break came when I stopped staring at the primitive and reconsidered the read counter. If the platform treated a request as a read, the image did not need to point to an image at all. It could point to another article.

What if the image `src` isn't an image at all, but the URL of an *article*? Rendering the comment fires a `GET` to that article. If a `GET` is a read… I could manufacture reads.

```md:COMMENT (mobile input)
Great read!
![](https://REDACTED/article/424242)
```


To prove it I needed two facts nailed down:

1. **Which event the platform counts as a read.**
2. **What access controls sit on the path that triggers that event.**

You can't confirm the first without pinning the second.

## 05_PROVING_THE_TRIGGER

The access control turned out to be: none worth the name. A bare `GET` to an article path was enough. So I built a clean experiment to prove a raw fetch increments the count.

Constraints I set for a trustworthy test:

- **A very old, obscure article** dug out of the archive, so no genuine reader would wander in and poison the measurement.
- **Under 1k reads**, because the UI rounds larger values to `1k` or `1.2k`, and I needed an exact count.
- **The platform's local midnight**, the quietest possible window, to keep organic traffic near zero.

Then I sent **100** plain `GET`s to that article in Caido. These were raw requests with no JavaScript rendering phase or secondary analytics, just the fetch.

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

Then I tested the markdown-image comment with the article URL as its target. Rendering the comment added another read, confirming the full path worked.

## 06_THE_IMPACT_I_SAW

Proving impact was the hard part, and honestly the part I got *wrong* at first. I had no view into the newsroom's back office, so I could only reason from the outside.

What I could argue, and did:

- I can make **any article as popular as I want**, on demand.
- The article view auto-surfaces its **10 most recent comments**, so my gadget re-arms itself on every viewer.
- The **more reads an article racks up, the more likely it is to be promoted** into the app's discovery feed.

Net: I could puppet the discovery section into featuring any article I chose. I wrote it up as a **low** and submitted it through [bugbounty.ch](https://www.bugbounty.ch/), and it triaged as low. The publisher agreed and paid a €350 bounty. I filed it away as a tidy little logic bug and moved on.

## 07_THE_IMPACT_I_MISSED

Three weeks later I got a mitigation-review invite. I checked their fix and confirmed it worked. They then explained why the report had quietly been re-rated to **high**.

The read counter was also tied to authenticated analytics. For same-origin article requests, the browser included the reader's session cookies, so the platform attributed the forged read to that specific account. Those authenticated reads fed several internal reports:

- which editors/field agents are performing best, and who gets rewarded;
- what editorial line to lean into next;
- which article categories are good paywall candidates and which aren't.

The gadget could therefore corrupt the dataset the newsroom used for decisions by attributing fabricated interest to real, identifiable readers.

The reason a single `GET` counted as a read was ordinary tech debt. A mobile developer with other priorities had implemented counting on the server when an article was fetched. A rewrite using client-side scroll depth and dwell time had sat in the backlog for four months. My report made that work urgent, and the severity increase came with a healthy four-figure bounty.

## 08_WHAT_I_TOOK_AWAY

What stayed with me was how ordinary the payload looked. The markdown image was simple; the real issue was the platform's decision about what counted as a read and how much depended on that count.

Understanding the application before hunting is what helped turn this odd render into a meaningful logic bug. bit was genuinely useful during discovery because it caught the cross-surface behavior I had dismissed. It was less useful when I needed to prove the business impact, and I struggled with that too. Closing the gap between finding a primitive and explaining its actual cost is something I am still practicing.
