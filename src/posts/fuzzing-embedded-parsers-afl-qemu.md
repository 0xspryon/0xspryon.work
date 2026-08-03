---
title: 'Fuzzing Embedded Parsers with AFL++ and QEMU'
summary: 'A practical harness-building walkthrough: from firmware blob to first crash in an afternoon.'
standfirst: 'You do not need source, a debugger port, or the original toolchain to fuzz firmware. You need a harness.'
date: '2026-02-08'
tag: 'TOOLING'
readingMinutes: 15
status: 'GUIDE'
chip: 'TOOLING'
---

## 01_BACKGROUND

Embedded parsers are a soft target: hand-written, rarely fuzzed, and often shipped in binaries you cannot recompile. AFL++ under QEMU user-mode lets you fuzz them anyway, no source required.

## 02_VULNERABLE_SOURCE

```c:C
int decode_frame(const uint8_t *in, size_t len) {
    uint8_t out[256];
    size_t n = in[0];

    /* BUG: n can exceed sizeof(out) */
    for (size_t i = 0; i < n; i++)
        out[i] = in[i + 1] ^ 0x5a;

    return commit(out, n);
}
```

The whole game is the harness: extract the parser, stub its dependencies, feed it AFL's input, and let QEMU translate the foreign architecture. First crash usually lands within the hour.

> Spend your time on the harness, not the fuzzer config — a good harness finds bugs the defaults never reach.
>
> QEMU user-mode means you never need the original board on your desk.
>
> Minimize crashing inputs before you triage; a 12-byte repro beats a 4KB one every time.
