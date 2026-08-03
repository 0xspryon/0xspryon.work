<script>
	/**
	 * One post row. variant="landing" → index number + right-aligned date·tag
	 * (landing page). variant="list" → date | title/summary | tag + minutes
	 * (writing index).
	 */
	let { post, index = 0, variant = 'landing' } = $props();

	const num = $derived(String(index + 1).padStart(2, '0'));
</script>

<a class="row row--{variant}" href="/writing/{post.slug}">
	{#if variant === 'landing'}
		<span class="num">{num}</span>
		<span class="main">
			<span class="title">{@html post.titleHtml ?? post.listTitle ?? post.title}</span>
			<span class="summary">{post.summary}</span>
		</span>
		<span class="side">
			<span class="meta-line">{post.date}&nbsp;&nbsp;·&nbsp;&nbsp;#{post.tag}</span>
		</span>
	{:else}
		<span class="date">{post.date}</span>
		<span class="main">
			<span class="meta-line meta-line--mobile"
				>{post.date}&nbsp;·&nbsp;#{post.tag}&nbsp;·&nbsp;{post.readingMinutes} MIN</span
			>
			<span class="title">{@html post.titleHtml ?? post.listTitle ?? post.title}</span>
			<span class="summary">{post.summary}</span>
		</span>
		<span class="side">
			<span class="meta-line">#{post.tag}</span>
			<span class="mins">{post.readingMinutes} MIN <i class="las la-arrow-right"></i></span>
		</span>
	{/if}
</a>

<style>
	.row {
		display: flex;
		gap: 44px;
		padding: 32px 0;
		border-bottom: 1px solid var(--hairline);
		cursor: pointer;
		transition:
			transform 0.22s ease,
			background-color 0.22s ease;
	}
	.row:hover {
		transform: translateX(8px);
		background-color: var(--hover-tint);
	}

	.row--list {
		display: grid;
		grid-template-columns: 160px 1fr 190px;
		gap: 40px;
		padding: 34px 0;
	}

	.num {
		flex: none;
		width: 36px;
		font-family: var(--mono);
		font-size: 12.5px;
		color: var(--faint);
		padding-top: 8px;
	}

	.date {
		font-family: var(--mono);
		font-size: 12.5px;
		letter-spacing: 1px;
		color: var(--meta);
		padding-top: 8px;
	}

	.main {
		flex: 1;
		min-width: 0;
	}
	.title {
		display: block;
		font-family: var(--serif);
		font-size: 31px;
		font-weight: 400;
		letter-spacing: -0.3px;
		line-height: 1.25;
		color: var(--ink);
		margin-bottom: 10px;
	}
	.title :global(em) {
		font-style: italic;
	}
	.summary {
		display: block;
		font-family: var(--sans);
		font-size: 14.5px;
		line-height: 1.65;
		color: var(--body-muted);
	}

	.side {
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 10px;
		padding-top: 8px;
		text-align: right;
	}
	.meta-line {
		font-family: var(--mono);
		font-size: 11.5px;
		letter-spacing: 1.5px;
		color: var(--meta);
		white-space: nowrap;
	}
	.mins {
		font-family: var(--mono);
		font-size: 11.5px;
		letter-spacing: 1.5px;
		color: var(--ink);
		white-space: nowrap;
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.mins i {
		transition: transform 0.18s ease;
	}
	.row:hover .mins i {
		transform: translateX(4px);
	}

	.meta-line--mobile {
		display: none;
	}

	@media (max-width: 700px) {
		.row,
		.row--list {
			display: flex;
			flex-direction: column;
			gap: 10px;
			padding: 26px 0;
		}
		.row:hover {
			transform: translateX(6px);
		}
		.num {
			display: none;
		}
		.title {
			font-size: 22px;
			line-height: 1.3;
			margin-bottom: 6px;
		}
		.summary {
			display: none;
		}
		.date {
			display: none;
		}
		.row--landing .side {
			order: 2;
			flex-direction: row;
			align-items: center;
			padding-top: 0;
		}
		.row--list .side {
			display: none;
		}
		.row--list .meta-line--mobile {
			display: block;
			margin-bottom: 10px;
		}
	}
</style>
