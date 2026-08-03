<script>
	/**
	 * Markdown blockquotes render as the dark terminal-log block
	 * (TERMINAL_OUTPUT: LESSONS_LEARNED.LOG). Each quoted paragraph becomes a
	 * `>`-prefixed log line. The blinking block cursor rests on the last
	 * character of the final line — since the lines come from Markdown, we wrap
	 * that glyph on the client after mount (cosmetic, so SSR-safe).
	 */
	let { children } = $props();

	let body = $state();

	$effect(() => {
		if (!body) return;
		const lines = body.querySelectorAll('p');
		const last = lines[lines.length - 1];
		if (!last || last.dataset.caret) return;

		// Walk to the final non-whitespace text node in the last line.
		const walker = document.createTreeWalker(last, NodeFilter.SHOW_TEXT);
		let lastText = null;
		while (walker.nextNode()) {
			if (walker.currentNode.textContent.trim()) lastText = walker.currentNode;
		}
		if (!lastText) return;

		const text = lastText.textContent;
		const caret = document.createElement('span');
		caret.className = 'term-caret';
		caret.textContent = text.slice(-1);
		lastText.textContent = text.slice(0, -1);
		lastText.after(caret);
		last.dataset.caret = 'true';
	});
</script>

<figure class="terminal-log">
	<div class="terminal-chrome">
		<span class="terminal-title">TERMINAL_OUTPUT: LESSONS_LEARNED.LOG</span>
		<span class="terminal-dots"><i></i><i></i></span>
	</div>
	<div class="terminal-body" bind:this={body}>
		{@render children?.()}
	</div>
</figure>
