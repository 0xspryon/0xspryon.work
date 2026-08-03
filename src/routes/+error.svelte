<script>
	import { page } from '$app/state';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
</script>

<svelte:head>
	<title>{page.status} — Half a Bit</title>
</svelte:head>

<Header />

<main>
	<p class="prompt">$ cat {page.url.pathname}</p>
	<h1>{page.status}<span class="slash">/</span>{page.error?.message ?? 'Not found'}</h1>
	<p class="bio">
		That path doesn't resolve. Head back to <a class="inline-link" href="/">the index</a> or browse
		<a class="inline-link" href="/writing">all writing</a>.
	</p>
</main>

<Footer variant="byline" />

<style>
	main {
		padding: 120px var(--frame-pad) 140px;
		max-width: 760px;
	}
	.prompt {
		font-family: var(--mono);
		font-size: 14px;
		color: var(--meta);
		margin-bottom: 26px;
	}
	h1 {
		font-family: var(--serif);
		font-size: 68px;
		font-weight: 400;
		letter-spacing: -1px;
		line-height: 1.1;
		color: var(--ink);
		margin-bottom: 32px;
	}
	.slash {
		color: var(--faint);
		margin: 0 12px;
	}
	.bio {
		font-family: var(--sans);
		font-size: 16px;
		line-height: 1.7;
		color: var(--body-muted);
	}
	.inline-link {
		color: var(--ink);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	@media (max-width: 700px) {
		main {
			padding: 70px var(--frame-pad) 90px;
		}
		h1 {
			font-size: 40px;
			letter-spacing: -0.5px;
		}
	}
</style>
