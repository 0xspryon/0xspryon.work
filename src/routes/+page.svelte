<script>
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import Cursor from '$lib/components/Cursor.svelte';
	import PostRow from '$lib/components/PostRow.svelte';
	import { latest } from '$lib/posts.js';

	const posts = latest(3);
</script>

<svelte:head>
	<title>0xspryon — Notes on breaking &amp; mending software</title>
	<meta
		name="description"
		content="Security researcher. I break things to understand them — then write down what it taught me."
	/>
</svelte:head>

<Header />

<main>
	<section class="hero">
		<p class="prompt">$ whoami</p>
		<h1>Yonga Springfield<br /><em>aka 0xspryon.</em></h1>
		<p class="bio">
			Security researcher. I break things to understand them — then write down what it taught me<Cursor
				>.</Cursor
			>
		</p>
	</section>

	<section class="latest">
		<div class="latest-head">
			<span class="prompt">$ ls ./latest --sort=date</span>
			<a class="arrow-link" href="/writing">ALL_POSTS <i class="las la-arrow-right"></i></a>
		</div>
		<div class="rows">
			{#each posts as post, i (post.slug)}
				<PostRow {post} index={i} variant="landing" />
			{/each}
		</div>
	</section>
</main>

<Footer variant="status" />

<style>
	main {
		padding: 0 var(--frame-pad);
	}

	.prompt {
		font-family: var(--mono);
		font-size: 14px;
		color: var(--meta);
	}

	.hero {
		padding: 100px 0 110px;
		max-width: 900px;
	}
	.hero h1 {
		font-family: var(--serif);
		font-size: 82px;
		font-weight: 400;
		letter-spacing: -1px;
		line-height: 1.08;
		color: var(--ink);
		margin: 26px 0 40px;
	}
	.hero h1 em {
		font-style: italic;
	}
	.bio {
		font-family: var(--sans);
		font-size: 16px;
		line-height: 1.6;
		color: var(--body-muted);
		max-width: 420px;
	}

	.latest {
		padding-bottom: 90px;
	}
	.latest-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		padding-bottom: 18px;
		border-bottom: 1px solid var(--hairline);
	}

	@media (max-width: 700px) {
		.hero {
			padding: 56px 0 70px;
		}
		.hero h1 {
			font-size: 42px;
			letter-spacing: -0.5px;
			line-height: 1.12;
			margin: 20px 0 28px;
		}
		.bio {
			font-size: 15px;
		}
		.prompt {
			font-size: 13px;
		}
		.latest {
			padding-bottom: 60px;
		}
	}
</style>
