import { error } from '@sveltejs/kit';
import { loadPost, related, posts } from '$lib/posts.js';

/** Prerender every post even if nothing links to it yet. */
export function entries() {
	return posts.map(({ slug }) => ({ slug }));
}

export async function load({ params }) {
	const post = await loadPost(params.slug);
	if (!post) error(404, 'Post not found');
	return {
		post,
		related: related(post.slug, post.tag)
	};
}
