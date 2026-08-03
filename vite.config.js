import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Baked in at compile time — powers the footer LAST_PUSH stamp on the fully
// static output. Format matches the design: 2026-05-14_09:12_UTC
const buildStamp = new Date().toISOString().slice(0, 16).replace('T', '_') + '_UTC';

export default defineConfig({
	plugins: [sveltekit()],
	define: {
		__BUILD_TIME__: JSON.stringify(buildStamp)
	}
});
