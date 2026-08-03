<script>
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import Cursor from '$lib/components/Cursor.svelte';

	// Edit these to taste — they render the mono "profile" block.
	const facts = [
		{ label: 'ROLE', value: 'Independent security researcher' },
		{ label: 'FOCUS', value: 'Memory safety · protocol parsers · fuzzing' },
		{ label: 'BASED', value: 'Remote' },
		{ label: 'DISCLOSURE', value: 'Coordinated · 90-day default' }
	];
</script>

<svelte:head>
	<title>About — Springfield Yonga</title>
	<meta
		name="description"
		content="Springfield Yonga — independent security researcher writing about breaking and mending software."
	/>
</svelte:head>

<Header />

<main>
	<section class="intro">
		<p class="prompt">$ cat about.md</p>
		<h1>Hi, I'm Springfield<Cursor>.</Cursor></h1>
	</section>

	<div class="body">
		<h2 class="section-head">01_WHOAMI</h2>
		<p>
			I'm an independent security researcher. I spend most of my time reading code that was never
			meant to be read closely — protocol parsers, allocators, firmware blobs — and figuring out
			where the assumptions break.
		</p>
		<p>
			This site is where I write it down. Not just the bugs, but the process around them: the dead
			ends, the tooling, and the parts that don't fit in a CVE description. If a write-up here saves
			you three weeks of heap grooming, it did its job.
		</p>

		<h2 class="section-head">02_PROFILE</h2>
		<dl class="facts">
			{#each facts as { label, value } (label)}
				<div class="fact">
					<dt>{label}</dt>
					<dd>{value}</dd>
				</div>
			{/each}
		</dl>

		<h2 class="section-head">03_CONTACT</h2>
		<p>
			Reach me on <a class="inline-link" href="https://github.com/springfieldyonga">GitHub</a>. For
			anything sensitive, encrypt it to my <a class="inline-link" href="/pgp.txt">PGP key</a>. New
			write-ups go out over <a class="inline-link" href="/rss.xml">RSS</a>.
		</p>
	</div>
</main>

<Footer variant="byline" />

<style>
	main {
		max-width: 760px;
		margin: 0 auto;
		padding: 0 40px 90px;
	}

	.intro {
		padding: 90px 0 60px;
	}
	.prompt {
		font-family: var(--mono);
		font-size: 14px;
		color: var(--meta);
		margin-bottom: 22px;
	}
	h1 {
		font-family: var(--serif);
		font-size: 68px;
		font-weight: 400;
		letter-spacing: -1px;
		line-height: 1.08;
		color: var(--ink);
	}

	.section-head {
		margin: 52px 0 24px;
	}
	.section-head:first-child {
		margin-top: 0;
	}

	.body p {
		font-family: var(--sans);
		font-size: 16px;
		line-height: 1.85;
		color: var(--body);
		margin-bottom: 22px;
	}
	.inline-link {
		color: var(--ink);
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.facts {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 30px 64px;
	}
	.fact dt {
		font-family: var(--mono);
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 2px;
		color: var(--meta);
		margin-bottom: 9px;
	}
	.fact dd {
		font-family: var(--mono);
		font-size: 14px;
		font-weight: 600;
		color: var(--ink);
		margin: 0;
	}

	@media (max-width: 700px) {
		main {
			padding: 0 24px 60px;
		}
		.intro {
			padding: 50px 0 40px;
		}
		h1 {
			font-size: 40px;
			letter-spacing: -0.5px;
		}
		.facts {
			grid-template-columns: 1fr;
			gap: 22px;
		}
	}
</style>
