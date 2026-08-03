import { posts } from '$lib/posts.js';

export const prerender = true;

const SITE = 'https://halfabit.work';

function escapeXml(str) {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export function GET() {
	const items = posts
		.map(
			(p) => `		<item>
			<title>${escapeXml(p.title)}</title>
			<link>${SITE}/writing/${p.slug}/</link>
			<guid isPermaLink="true">${SITE}/writing/${p.slug}/</guid>
			<pubDate>${new Date(`${p.date}T00:00:00Z`).toUTCString()}</pubDate>
			<category>${escapeXml(p.tag)}</category>
			<description>${escapeXml(p.summary)}</description>
		</item>`
		)
		.join('\n');

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
	<channel>
		<title>Half a Bit</title>
		<link>${SITE}</link>
		<description>Notes on breaking and mending software.</description>
		<language>en</language>
		<atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml"/>
${items}
	</channel>
</rss>`;

	return new Response(xml, {
		headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' }
	});
}
