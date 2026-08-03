<script module>
	export { default as h2 } from './H2.svelte';
	export { default as blockquote } from './Blockquote.svelte';
</script>

<script>
	/**
	 * mdsvex layout: wraps every src/posts/*.md. Receives the post's
	 * frontmatter as props and renders the post header chrome (chip, title,
	 * standfirst, meta row) above the markdown body.
	 */
	let {
		title,
		titleHtml = '',
		standfirst = '',
		date,
		tag,
		status = '',
		cveId = '',
		chip = '',
		children
	} = $props();
</script>

<article class="post">
	<header class="post-header">
		{#if chip || cveId}
			<div class="chip-row">
				{#if chip}<span class="chip">{chip}</span>{/if}
				{#if cveId}<span class="chip-id">ID: {cveId}</span>{/if}
			</div>
		{/if}

		<h1>{#if titleHtml}{@html titleHtml}{:else}{title}{/if}</h1>

		{#if standfirst}
			<p class="standfirst">{standfirst}</p>
		{/if}

		<dl class="meta-row">
			<div class="meta-field">
				<dt>AUTHOR</dt>
				<dd>HALFABIT</dd>
			</div>
			<div class="meta-field">
				<dt>PUBLISHED</dt>
				<dd>{date}</dd>
			</div>
			<div class="meta-field meta-field--tag">
				<dt>TAG</dt>
				<dd>#{tag}</dd>
			</div>
			{#if status}
				<div class="meta-field">
					<dt>STATUS</dt>
					<dd>{status}</dd>
				</div>
			{/if}
		</dl>
	</header>

	<div class="post-body">
		{@render children?.()}
	</div>
</article>

<style>
	.post {
		max-width: 760px;
		margin: 0 auto;
		padding: 76px 40px 0;
	}

	.chip-row {
		display: flex;
		align-items: center;
		gap: 18px;
		margin-bottom: 30px;
	}
	.chip {
		font-family: var(--mono);
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 2px;
		background: var(--ink);
		color: var(--paper);
		padding: 6px 12px;
	}
	.chip-id {
		font-family: var(--mono);
		font-size: 12px;
		letter-spacing: 1.5px;
		color: var(--meta);
	}

	h1 {
		font-family: var(--serif);
		font-size: 50px;
		font-weight: 400;
		letter-spacing: -0.5px;
		line-height: 1.15;
		color: var(--ink);
		margin: 0 0 26px;
	}

	.standfirst {
		font-family: var(--serif);
		font-style: italic;
		font-size: 19px;
		line-height: 1.55;
		color: var(--body-muted);
		margin: 0 0 40px;
	}

	.meta-row {
		display: flex;
		gap: 64px;
		border-top: 1px solid var(--hairline);
		padding-top: 24px;
		margin: 0 0 58px;
	}
	.meta-field dt {
		font-family: var(--mono);
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 2px;
		color: var(--meta);
		margin-bottom: 9px;
	}
	.meta-field dd {
		font-family: var(--mono);
		font-size: 14px;
		font-weight: 600;
		color: var(--ink);
		margin: 0;
	}

	@media (max-width: 700px) {
		.post {
			padding: 44px 24px 0;
		}
		h1 {
			font-size: 29px;
			letter-spacing: -0.3px;
			line-height: 1.22;
			margin-bottom: 22px;
		}
		.standfirst {
			display: none;
		}
		.chip-row {
			margin-bottom: 24px;
		}
		.meta-row {
			gap: 32px;
			flex-wrap: wrap;
			margin-bottom: 40px;
		}
		.meta-field--tag {
			display: none;
		}
		.meta-field dd {
			font-size: 12px;
		}
	}
</style>
