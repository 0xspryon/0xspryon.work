import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Renders fenced code blocks as the design's line-numbered "code excerpt":
 * a gutter of faint line numbers next to each line, with lines containing a
 * BUG marker (e.g. `/* BUG ... `) highlighted on the darker tint.
 * Language may carry a label after a colon, e.g. ```c:C — the part after the
 * colon becomes the right-aligned "LANGUAGE: C" annotation.
 */
function escapeHtml(str) {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

// Svelte treats {, } and ` specially inside the {@html `...`} wrapper.
function escapeSvelte(str) {
	return str
		.replace(/\\/g, '&#92;')
		.replace(/`/g, '&#96;')
		.replace(/{/g, '&#123;')
		.replace(/}/g, '&#125;');
}

const BUG_MARKER = /(\/\*\s*BUG|\/\/\s*BUG|#\s*BUG)/;

function highlight(code, lang) {
	const label = lang ? lang.split(':').pop().toUpperCase() : null;
	const lines = code.replace(/\n$/, '').split('\n');
	const rows = lines
		.map((line, i) => {
			const hl = BUG_MARKER.test(line) ? ' code-line--bug' : '';
			return (
				`<span class="code-line${hl}">` +
				`<span class="code-ln">${i + 1}</span>` +
				`<span class="code-src">${escapeHtml(line) || ' '}</span>` +
				`</span>`
			);
		})
		.join('');
	const labelHtml = label
		? `<div class="code-lang"><span>LANGUAGE: ${escapeHtml(label)}</span></div>`
		: '';
	const html = `<figure class="code-excerpt">${labelHtml}<pre><code>${rows}</code></pre></figure>`;
	return `{@html \`${escapeSvelte(html)}\`}`;
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
	extensions: ['.svelte', '.md'],
	preprocess: [
		vitePreprocess(),
		mdsvex({
			extensions: ['.md'],
			layout: join(__dirname, 'src/lib/components/mdsvex/PostLayout.svelte'),
			highlight: { highlighter: highlight },
			smartypants: { dashes: 'oldschool' }
		})
	],
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			// Styled not-found page for hosts (Caddy) to serve on 404.
			fallback: '404.html',
			strict: true
		}),
		prerender: {
			handleHttpError: 'fail'
		}
	}
};

export default config;
