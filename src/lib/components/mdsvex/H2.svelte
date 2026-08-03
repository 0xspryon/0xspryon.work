<script>
	let { children } = $props();
</script>

<!-- ## 01_BACKGROUND → square-bullet mono section header -->
<h2 class="section-head md-section-head">{@render children?.()}</h2>

<style>
	.md-section-head {
		margin: 56px 0 26px;
	}
	@media (max-width: 700px) {
		.md-section-head {
			margin: 42px 0 20px;
		}
	}
</style>
