---
title: 'JWT alg:none, Ten Years Later'
titleHtml: 'JWT <em>alg:none</em>, Ten Years Later'
summary: "Why a bug class we \"fixed\" in 2015 still shows up in production APIs — and how to hunt it in modern stacks."
standfirst: 'The oldest JWT footgun refuses to die. Here is why libraries keep reintroducing it.'
date: '2026-04-02'
tag: 'WEB'
readingMinutes: 8
status: 'ONGOING'
chip: 'FIELD_NOTES'
---

## 01_BACKGROUND

The `alg:none` attack is old enough to vote soon. Set a JWT's algorithm header to `none`, drop the signature, and any library that honors the header will happily accept a forged token.

We "fixed" this a decade ago. Yet every year a fresh crop of libraries and misconfigurations bring it back, usually because verification and algorithm selection are two decisions that should be one.

## 02_VULNERABLE_SOURCE

```js:JavaScript
function verify(token, secret) {
  const { header, payload, signature } = decode(token);

  // BUG: trusting the token to name its own algorithm
  const alg = header.alg;
  if (alg === 'none') return payload;

  return check(alg, signature, secret) ? payload : null;
}
```

The fix is boring and unchanging: pin the accepted algorithm server-side and never read it from the token.

> The token is the attacker's input — including the header. Do not let input pick its own verification.
>
> Pin the algorithm allowlist in your code, not in the JWT.
>
> When a bug class survives a decade, the problem is the API shape, not the developers.
