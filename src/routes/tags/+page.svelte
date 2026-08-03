<script>
	/**
	 * Tags index — every tag with its post count, linking into the filtered
	 * Writing list (/writing?tag=x).
	 */
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import { allTags, posts } from '$lib/posts.js';

	const tags = allTags();
</script>

<svelte:head>
	<title>Tags — Springfield Yonga</title>
	<meta name="description" content="Browse posts by tag." />
</svelte:head>

<Header />

<main>
	<div class="title-block">
		<h1>Tags</h1>
		<span class="count">// {String(tags.length).padStart(2, '0')} tags</span>
	</div>

	<p class="prompt">$ ls ./tags --count</p>

	<ul class="tag-list">
		{#each tags as { tag, count } (tag)}
			<li>
				<a class="tag-row" href="/writing/?tag={tag.toLowerCase()}">
					<span class="tag-name">#{tag}</span>
					<span class="tag-dots" aria-hidden="true"></span>
					<span class="tag-count">{String(count).padStart(2, '0')} {count === 1 ? 'POST' : 'POSTS'}</span>
					<i class="las la-arrow-right"></i>
				</a>
			</li>
		{/each}
	</ul>
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

	.prompt {
		font-family: var(--mono);
		font-size: 14px;
		color: var(--meta);
		padding-bottom: 18px;
		border-bottom: 1px solid var(--hairline);
	}

	.tag-list {
		list-style: none;
	}
	.tag-row {
		display: flex;
		align-items: baseline;
		gap: 20px;
		padding: 28px 0;
		border-bottom: 1px solid var(--hairline);
		transition:
			transform 0.22s ease,
			background-color 0.22s ease;
	}
	.tag-row:hover {
		transform: translateX(8px);
		background-color: var(--hover-tint);
	}
	.tag-name {
		font-family: var(--serif);
		font-size: 31px;
		letter-spacing: -0.3px;
		color: var(--ink);
		flex: none;
	}
	.tag-dots {
		flex: 1;
		border-bottom: 1px dotted var(--pill-border);
		transform: translateY(-6px);
	}
	.tag-count {
		font-family: var(--mono);
		font-size: 11.5px;
		letter-spacing: 1.5px;
		color: var(--meta);
		flex: none;
	}
	.tag-row i {
		font-size: 14px;
		color: var(--ink);
		transition: transform 0.18s ease;
	}
	.tag-row:hover i {
		transform: translateX(4px);
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
		.tag-name {
			font-size: 24px;
		}
		.tag-dots {
			display: none;
		}
		.tag-row {
			gap: 14px;
			padding: 22px 0;
		}
	}
</style>
