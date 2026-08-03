<script>
	/**
	 * Blinking terminal-style block cursor that rests ON its content — pass the
	 * sentence's final character(s) as children so the caret blinks over a real
	 * glyph, not an empty box.
	 *
	 *   …taught me<Cursor>.</Cursor>
	 *
	 * The block alternates between an inverted glyph (paper-on-ink) and the
	 * glyph in its normal colour.
	 */
	let { children } = $props();
</script>

<span class="cursor">{@render children()}</span>

<style>
	.cursor {
		display: inline-block;
		background: var(--ink);
		color: var(--paper);
		animation: cursor-blink 1.1s step-end infinite;
	}

	@keyframes cursor-blink {
		50% {
			background: transparent;
			color: inherit;
		}
	}
</style>
