/**
 * Filesystem-backed post index. Every .md file in src/posts is a post; its
 * frontmatter is the source of truth for listing metadata. Everything here
 * resolves at build time, so the generated site is fully static.
 */
const modules = import.meta.glob('/src/posts/*.md');
const metaModules = import.meta.glob('/src/posts/*.md', {
	eager: true,
	import: 'metadata'
});

function slugFromPath(path) {
	return path.split('/').pop().replace(/\.md$/, '');
}

/** All posts, newest first. Metadata only — cheap to import anywhere. */
export const posts = Object.entries(metaModules)
	.map(([path, metadata]) => ({
		slug: slugFromPath(path),
		...metadata
	}))
	.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));

/** Latest N posts for the landing page. */
export function latest(n = 3) {
	return posts.slice(0, n);
}

/** Distinct tags in first-seen (newest-post) order, each with a post count. */
export function allTags() {
	const counts = new Map();
	for (const p of posts) counts.set(p.tag, (counts.get(p.tag) ?? 0) + 1);
	return [...counts].map(([tag, count]) => ({ tag, count }));
}

/** Full component + metadata for a single post; null if unknown slug. */
export async function loadPost(slug) {
	const entry = Object.keys(modules).find((path) => slugFromPath(path) === slug);
	if (!entry) return null;
	const mod = await modules[entry]();
	return {
		slug,
		component: mod.default,
		...mod.metadata
	};
}

/** Up to two related posts: same tag first, then most recent others. */
export function related(slug, tag, n = 2) {
	const others = posts.filter((p) => p.slug !== slug);
	const sameTag = others.filter((p) => p.tag === tag);
	const rest = others.filter((p) => p.tag !== tag);
	return [...sameTag, ...rest].slice(0, n);
}
