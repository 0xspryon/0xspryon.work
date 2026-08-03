---
title: 'Lessons From My First Kernel Bug Bounty'
summary: "Six months, one dangling pointer, and everything I'd tell myself before starting."
standfirst: 'The bug was small. Everything around the bug — the process, the patience, the paperwork — was the real lesson.'
date: '2026-03-11'
tag: 'LESSONS'
readingMinutes: 10
status: 'DISCLOSED'
chip: 'RETROSPECTIVE'
---

## 01_BACKGROUND

I spent six months chasing a use-after-free in a driver almost nobody uses. The bug itself was a single dangling pointer. The lessons were about everything else: scoping the target, reading the process, and staying sane through months of dead ends.

## 02_VULNERABLE_SOURCE

```c:C
static void release_ctx(struct ctx *c) {
    kfree(c->buffer);
    /* BUG: c->buffer still reachable from ioctl path */
    c->state = CTX_FREED;
    kfree(c);
}
```

Most of the six months was not the bug. It was learning to keep a lab notebook, to diff kernel versions patiently, and to write a report a maintainer could act on without a meeting.

> Pick a target small enough that you can hold the whole thing in your head.
>
> Your notebook is worth more than your exploit — write down every dead end.
>
> A great report is a working proof-of-concept plus a patch the maintainer can read in five minutes.
