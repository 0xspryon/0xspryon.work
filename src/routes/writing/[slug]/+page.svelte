<script>
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';

	let { data } = $props();

	const Post = $derived(data.post.component);
</script>

<svelte:head>
	<title>{data.post.title} — Half a Bit</title>
	<meta name="description" content={data.post.summary} />
</svelte:head>

<Header />

<main>
	<Post />

	{#if data.related.length}
		<section class="related">
			<h2 class="section-head">03_RELATED_POSTS</h2>
			<div class="related-grid">
				{#each data.related as rel (rel.slug)}
					<a class="related-card" href="/writing/{rel.slug}">
						<span class="rel-meta">{rel.date}&nbsp;&nbsp;|&nbsp;&nbsp;#{rel.tag}</span>
						<span class="rel-title">{rel.title}</span>
						<span class="arrow-link">READ <i class="las la-arrow-right"></i></span>
					</a>
				{/each}
			</div>
		</section>
	{/if}
</main>

<Footer variant="byline" />

<style>
	main {
		padding-bottom: 90px;
	}

	.related {
		max-width: 760px;
		margin: 0 auto;
		padding: 20px 40px 0;
	}
	.related .section-head {
		margin-bottom: 34px;
	}
	.related-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 40px;
	}
	.related-card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 14px;
		border-top: 1px solid var(--hairline);
		padding-top: 22px;
		transition:
			transform 0.22s ease,
			background-color 0.22s ease;
	}
	.related-card:hover {
		transform: translateX(8px);
		background-color: var(--hover-tint);
	}
	.rel-meta {
		font-family: var(--mono);
		font-size: 11px;
		letter-spacing: 1.5px;
		color: var(--meta);
	}
	.rel-title {
		font-family: var(--serif);
		font-size: 22px;
		line-height: 1.3;
		letter-spacing: -0.2px;
		color: var(--ink);
	}

	@media (max-width: 700px) {
		main {
			padding-bottom: 56px;
		}
		/* Mobile drops the related grid to save space (per design). */
		.related {
			display: none;
		}
	}
</style>
