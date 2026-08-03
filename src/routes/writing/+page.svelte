<script>
	/**
	 * Writing index — searchable, tag-filterable list of all posts.
	 * Search matches title, summary, tag, and CVE id. The active tag syncs to
	 * the URL (?tag=web) so /tags links and shared URLs land pre-filtered.
	 * Everything filters client-side over the prerendered post list.
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import PostRow from '$lib/components/PostRow.svelte';
	import { posts, allTags } from '$lib/posts.js';

	const tags = allTags();

	let query = $state('');

	// Active tag is driven by the URL param (lowercased slug), resolved back to
	// the real tag string. null → [ALL]. Read in an effect (client-only) since
	// searchParams can't be touched during prerender — the static HTML ships
	// unfiltered and the tag applies on hydration.
	let activeTag = $state(null);
	$effect(() => {
		const param = page.url.searchParams.get('tag');
		activeTag = param
			? (tags.find((t) => t.tag.toLowerCase() === param.toLowerCase())?.tag ?? null)
			: null;
	});

	function selectTag(tag) {
		const url = new URL(page.url);
		if (tag) url.searchParams.set('tag', tag.toLowerCase());
		else url.searchParams.delete('tag');
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}

	const visible = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return posts.filter((p) => {
			if (activeTag && p.tag !== activeTag) return false;
			if (!q) return true;
			const hay = `${p.title} ${p.summary} ${p.tag} ${p.cveId ?? ''}`.toLowerCase();
			return hay.includes(q);
		});
	});
</script>

<svelte:head>
	<title>Writing — Springfield Yonga</title>
	<meta name="description" content="All posts by Springfield Yonga." />
</svelte:head>

<Header />

<main>
	<div class="title-block">
		<h1>Writing</h1>
		<span class="count">// {String(posts.length).padStart(2, '0')} entries</span>
	</div>

	<form class="search" onsubmit={(e) => e.preventDefault()}>
		<span class="search-prefix">$ grep -i</span>
		<input
			type="text"
			bind:value={query}
			placeholder="search posts by title, tag, or CVE id…"
			aria-label="Search posts"
		/>
		<button type="submit" class="search-run">RUN <i class="las la-arrow-right"></i></button>
	</form>

	<div class="filters" role="group" aria-label="Filter by tag">
		<button class="pill" class:active={activeTag === null} onclick={() => selectTag(null)}>[ALL]</button
		>
		{#each tags as { tag } (tag)}
			<button class="pill" class:active={activeTag === tag} onclick={() => selectTag(tag)}
				>#{tag}</button
			>
		{/each}
	</div>

	{#if visible.length}
		<div class="rows">
			{#each visible as post, i (post.slug)}
				<PostRow {post} index={i} variant="list" />
			{/each}
		</div>
	{:else}
		<p class="empty">
			<span class="empty-prompt">$ grep -i "{query}"{activeTag ? ` --tag=${activeTag.toLowerCase()}` : ''}</span>
			<span class="empty-msg">// no matching entries</span>
		</p>
	{/if}
</main>

<Footer variant="status" />

<style>
	main {
		padding: 0 var(--frame-pad) 90px;
	}

	.title-block {
		display: flex;
		align-items: baseline;
		gap: 22px;
		padding: 72px 0 40px;
	}
	h1 {
		font-family: var(--serif);
		font-size: 68px;
		font-weight: 400;
		letter-spacing: -1px;
		color: var(--ink);
	}
	.count {
		font-family: var(--mono);
		font-size: 13px;
		letter-spacing: 1px;
		color: var(--faint);
	}

	.search {
		display: flex;
		align-items: center;
		gap: 18px;
		max-width: 720px;
		border-bottom: 1px solid var(--ink);
		padding-bottom: 14px;
		margin-bottom: 34px;
	}
	.search-prefix {
		font-family: var(--mono);
		font-size: 14px;
		color: var(--meta);
		flex: none;
	}
	.search input {
		flex: 1;
		min-width: 0;
		border: none;
		background: transparent;
		font-family: var(--sans);
		font-size: 15px;
		color: var(--ink);
		outline: none;
	}
	.search input::placeholder {
		color: var(--meta);
	}
	.search-run {
		flex: none;
		border: none;
		background: transparent;
		cursor: pointer;
		font-family: var(--mono);
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 1.5px;
		color: var(--ink);
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 0;
	}
	.search-run i {
		transition: transform 0.18s ease;
	}
	.search-run:hover i {
		transform: translateX(4px);
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-bottom: 20px;
	}
	.pill {
		font-family: var(--mono);
		font-size: 11.5px;
		font-weight: 500;
		letter-spacing: 1.5px;
		color: var(--ink);
		background: transparent;
		border: 1px solid var(--pill-border);
		padding: 8px 14px;
		cursor: pointer;
		transition: all 0.18s ease;
	}
	.pill:hover {
		background: var(--ink);
		color: var(--paper);
		border-color: var(--ink);
	}
	.pill.active {
		background: var(--ink);
		color: var(--paper);
		border-color: var(--ink);
	}

	.empty {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 60px 0;
	}
	.empty-prompt {
		font-family: var(--mono);
		font-size: 14px;
		color: var(--body);
	}
	.empty-msg {
		font-family: var(--mono);
		font-size: 13px;
		color: var(--faint);
	}

	@media (max-width: 700px) {
		main {
			padding-bottom: 60px;
		}
		.title-block {
			padding: 44px 0 26px;
		}
		h1 {
			font-size: 42px;
			letter-spacing: -0.5px;
		}
		.search {
			gap: 12px;
		}
		.search-prefix {
			font-size: 13px;
		}
		.search input {
			font-size: 14px;
		}
	}
</style>
