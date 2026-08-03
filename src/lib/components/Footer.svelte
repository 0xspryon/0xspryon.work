<script>
	let { variant = 'status' } = $props();

	const links = [
		{ label: 'EMAIL', href: 'mailto:springfieldyonga@outlook.com', icon: 'las la-envelope' },
		{ label: 'GITHUB', href: 'https://github.com/0xspryon', icon: 'lab la-github' },
		{
			label: 'X',
			href: 'https://x.com/half4bit',
			// line-awesome (abandoned at 1.3.0) has no X glyph — inline the mark.
			iconSvg:
				'<svg class="x-icon" viewBox="0 0 512 512" aria-hidden="true" focusable="false"><path d="M389.2 48h70.6L305.6 224.2 487 464H345L233.7 318.6 106.5 464H35.8L200.7 275.5 26.8 48H172.4L272.9 180.9 389.2 48zM364.4 421.8h39.1L151.1 88h-42L364.4 421.8z"/></svg>'
		},
		{ label: 'PGP_KEY', href: '/pgp.txt', icon: 'las la-key' },
		{ label: 'RSS', href: '/rss.xml', icon: 'las la-rss' }
	];
</script>

<footer class="site-footer">
	{#if variant === 'status'}
		<span class="left">STATUS: OPERATIONAL&nbsp;&nbsp;|&nbsp;&nbsp;LAST_PUSH: {__BUILD_TIME__}</span>
	{:else}
		<span class="left">HALFABIT // {new Date(__BUILD_TIME__.slice(0, 10)).getFullYear()}</span>
	{/if}
	<nav class="right" aria-label="External links">
		{#each links as link (link.label)}
			<a href={link.href}
				>{#if link.iconSvg}{@html link.iconSvg}{:else}<i class={link.icon}
					></i>{/if}{link.label}</a
			>
		{/each}
	</nav>
</footer>

<style>
	.site-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 26px var(--frame-pad);
		border-top: 1px solid var(--hairline);
		font-family: var(--mono);
		font-size: 11px;
		letter-spacing: 1px;
		color: var(--meta);
	}

	.right {
		display: flex;
		gap: 26px;
	}
	.right a {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--meta);
		transition: color 0.18s ease;
	}
	.right a:hover {
		color: var(--ink);
	}
	.right a i {
		font-size: 14px;
	}
	/* Inline X mark — sized to sit with the line-awesome glyphs, inherits color. */
	.right a :global(.x-icon) {
		width: 12px;
		height: 12px;
		fill: currentColor;
	}

	@media (max-width: 700px) {
		/* Stack: status row on top, links block below. */
		.site-footer {
			flex-direction: column;
			align-items: stretch;
			font-size: 10px;
			padding: 22px var(--frame-pad);
			gap: 18px;
		}
		/* Links split into two columns. */
		.right {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 14px 16px;
		}
	}
</style>
