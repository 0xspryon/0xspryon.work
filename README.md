# Springfield Yonga — blog

A static security-research blog. **SvelteKit + Svelte 5 + mdsvex**, prerendered
to plain HTML at build time and served by **Caddy**.

Design source: `design_handoff_security_blog/` (direction `2a HYBRID`).

## Stack

- **SvelteKit** with `@sveltejs/adapter-static` — every route is prerendered; no
  server runs in production.
- **mdsvex** — each `src/posts/*.md` file is a post. Frontmatter drives the
  listing metadata; the Markdown body is rendered through
  `src/lib/components/mdsvex/PostLayout.svelte`.
- **IBM Plex Serif / Sans / Mono** via `@fontsource` (self-hosted, no external
  requests).
- **line-awesome** for icons (footer social links, arrows, hamburger, terminal
  dots).

## Develop

```bash
npm install
npm run dev        # http://localhost:5179
```

## Build (static)

```bash
npm run build      # → ./build (fully static HTML)
npm run preview    # serve ./build locally
```

Output in `build/`:

- `index.html` — landing page
- `writing/index.html` — post index
- `writing/<slug>/index.html` — one per post
- `rss.xml`, `404.html`, `favicon.svg`, `pgp.txt`

## Deploy (Caddy)

1. `npm run build`
2. Copy `build/` to the server (the `Caddyfile` expects
   `/srv/springfieldyonga/build`).
3. `caddy run --config ./Caddyfile` (or reload an existing instance).

The `Caddyfile` handles pretty URLs, the `404.html` fallback, gzip/zstd, and
long-lived caching for fingerprinted `_app/immutable/*` assets.

## Add a post

Drop a Markdown file in `src/posts/`. Frontmatter fields:

| Field           | Required | Notes                                             |
| --------------- | -------- | ------------------------------------------------- |
| `title`         | yes      | Plain-text title                                  |
| `titleHtml`     | no       | HTML title (e.g. `<em>alg:none</em>`) for the H1  |
| `listTitle`     | no       | Alternate title shown in listings                 |
| `summary`       | yes      | One-line summary for listings + `<meta>`          |
| `standfirst`    | no       | Serif-italic intro line (hidden on mobile)        |
| `date`          | yes      | `YYYY-MM-DD` — drives sort order                  |
| `tag`           | yes      | Single tag, e.g. `VULN-RESEARCH`                  |
| `readingMinutes`| yes      | Integer, shown as `N MIN` in the index            |
| `status`        | no       | Meta-row status, e.g. `PATCHED ✓`                 |
| `cveId`         | no       | Shown next to the report chip                     |
| `chip`          | no       | Black chip label, e.g. `VULN_REPORT`              |

Markdown conventions in the body:

- `## 01_BACKGROUND` → square-bullet mono section header.
- Fenced code block with a language label (```` ```c:C ````) → line-numbered
  code excerpt; a line containing `/* BUG`, `// BUG`, or `# BUG` is highlighted.
- A blockquote → the dark `LESSONS_LEARNED.LOG` terminal block; each `>`
  paragraph is one log line (separate them with a blank `>`).

## Pages

- `/` — landing (hero + latest 3 posts)
- `/writing` — searchable, tag-filterable index of all posts. Search matches
  title, summary, tag, and CVE id; the active tag syncs to the URL (`?tag=web`)
  so `/tags` links and shared URLs land pre-filtered. Filtering runs client-side
  over the prerendered list.
- `/writing/<slug>` — a post
- `/tags` — every tag with its post count, linking into the filtered index
- `/about` — profile page (edit the copy + `facts` in
  `src/routes/about/+page.svelte`)
