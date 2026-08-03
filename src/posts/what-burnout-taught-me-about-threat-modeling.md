---
title: 'What Burnout Taught Me About Threat Modeling My Own Life'
summary: "Attack surface isn't just for software. A personal post about limits, recovery, and sustainable research."
standfirst: 'The same discipline that maps a system''s attack surface works, uncomfortably well, on your own habits.'
date: '2026-01-19'
tag: 'LESSONS'
readingMinutes: 6
status: 'PERSONAL'
chip: 'PERSONAL'
---

## 01_BACKGROUND

Burnout crept up the way most vulnerabilities do: a series of small, individually reasonable decisions that compounded into a failure nobody designed. Late nights, no boundaries, treating rest as a resource to be exploited rather than budgeted.

## 02_VULNERABLE_SOURCE

```text:PSEUDO
while (awake) {
    // BUG: no rate limit on self
    take_on(new_project());
    skip(rest);
}
```

Threat modeling my own schedule felt absurd until it worked. What is my attack surface? What are the single points of failure? Where is the missing rate limit? The framing turned a vague sense of dread into a concrete list of fixes.

> Rest is not a resource to exploit — it is the thing that keeps the system running.
>
> Every "just this once" is a small privilege escalation against your future self.
>
> Sustainable research beats heroic research over any timeline longer than a month.
