/**
 * Manga Reader - Cloudflare Worker
 * Proxies MangaDex API to avoid CORS issues and caches results.
 */

const MANGADEX = 'https://api.mangadex.org';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

function cors() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

async function mdx(path) {
  const res = await fetch(MANGADEX + path, {
    headers: { 'User-Agent': 'MangaReader/1.0' },
  });
  return res.json();
}

async function handleRequest(request) {
  if (request.method === 'OPTIONS') return cors();

  const url = new URL(request.url);
  const path = url.pathname;

  // Search manga
  if (path === '/api/search') {
    const q = url.searchParams.get('q') || '';
    const offset = url.searchParams.get('offset') || '0';
    const data = await mdx(`/manga?title=${encodeURIComponent(q)}&limit=20&offset=${offset}&includes[]=cover_art&includes[]=author&order[relevance]=desc&availableTranslatedLanguage[]=en&hasAvailableChapters=true`);
    return json(formatMangaList(data));
  }

  // Popular manga
  if (path === '/api/popular') {
    const offset = url.searchParams.get('offset') || '0';
    const data = await mdx(`/manga?limit=20&offset=${offset}&includes[]=cover_art&includes[]=author&order[followedCount]=desc&availableTranslatedLanguage[]=en&hasAvailableChapters=true`);
    return json(formatMangaList(data));
  }

  // Latest updates
  if (path === '/api/latest') {
    const offset = url.searchParams.get('offset') || '0';
    const data = await mdx(`/manga?limit=20&offset=${offset}&includes[]=cover_art&includes[]=author&order[latestUploadedChapter]=desc&availableTranslatedLanguage[]=en&hasAvailableChapters=true`);
    return json(formatMangaList(data));
  }

  // Manga detail
  if (path.startsWith('/api/manga/') && !path.includes('/chapters')) {
    const id = path.split('/api/manga/')[1];
    const data = await mdx(`/manga/${id}?includes[]=cover_art&includes[]=author&includes[]=artist`);
    if (data.result !== 'ok') return json({ error: 'Not found' }, 404);
    return json(formatMangaDetail(data.data));
  }

  // Chapter list for a manga
  if (path.includes('/chapters')) {
    const id = path.split('/api/manga/')[1].split('/chapters')[0];
    const offset = url.searchParams.get('offset') || '0';
    const order = url.searchParams.get('order') || 'asc';
    const data = await mdx(`/manga/${id}/feed?translatedLanguage[]=en&order[chapter]=${order}&limit=100&offset=${offset}&includes[]=scanlation_group`);
    return json(formatChapterList(data));
  }

  // Chapter pages (image URLs)
  if (path.startsWith('/api/chapter/')) {
    const id = path.split('/api/chapter/')[1];
    const data = await mdx(`/at-home/server/${id}`);
    if (data.result !== 'ok') return json({ error: 'Chapter not available' }, 404);
    const base = data.baseUrl;
    const hash = data.chapter.hash;
    const pages = data.chapter.data.map(f => `${base}/data/${hash}/${f}`);
    const dataSaver = data.chapter.dataSaver.map(f => `${base}/data-saver/${hash}/${f}`);
    return json({ pages, dataSaver });
  }

  // Image proxy — avoid CORS on manga images
  if (path === '/api/image') {
    const imgUrl = url.searchParams.get('url');
    if (!imgUrl) return new Response('Missing url', { status: 400 });
    const imgRes = await fetch(imgUrl, {
      headers: { 'Referer': 'https://mangadex.org/' },
    });
    const headers = new Headers(imgRes.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=86400');
    return new Response(imgRes.body, { status: imgRes.status, headers });
  }

  return json({ error: 'Not found' }, 404);
}

// --- Formatters ---

function formatMangaList(data) {
  if (data.result !== 'ok') return { manga: [], total: 0 };
  return {
    manga: data.data.map(m => formatMangaSummary(m)),
    total: data.total,
    offset: data.offset,
    limit: data.limit,
  };
}

function formatMangaSummary(m) {
  const attrs = m.attributes;
  const title = attrs.title.en || attrs.title['ja-ro'] || attrs.title.ja || Object.values(attrs.title)[0] || 'Untitled';

  // Cover
  const coverRel = m.relationships.find(r => r.type === 'cover_art');
  const coverFile = coverRel?.attributes?.fileName;
  const cover = coverFile ? `https://uploads.mangadex.org/covers/${m.id}/${coverFile}.256.jpg` : null;

  // Author
  const authorRel = m.relationships.find(r => r.type === 'author');
  const author = authorRel?.attributes?.name || 'Unknown';

  return {
    id: m.id,
    title,
    cover,
    author,
    status: attrs.status,
    year: attrs.year,
    contentRating: attrs.contentRating,
    tags: attrs.tags?.slice(0, 5).map(t => t.attributes.name.en).filter(Boolean) || [],
  };
}

function formatMangaDetail(m) {
  const attrs = m.attributes;
  const title = attrs.title.en || attrs.title['ja-ro'] || attrs.title.ja || Object.values(attrs.title)[0] || 'Untitled';

  const coverRel = m.relationships.find(r => r.type === 'cover_art');
  const coverFile = coverRel?.attributes?.fileName;
  const cover = coverFile ? `https://uploads.mangadex.org/covers/${m.id}/${coverFile}.512.jpg` : null;

  const authorRel = m.relationships.find(r => r.type === 'author');
  const artistRel = m.relationships.find(r => r.type === 'artist');

  const desc = attrs.description?.en || attrs.description?.['ja-ro'] || '';

  return {
    id: m.id,
    title,
    cover,
    author: authorRel?.attributes?.name || 'Unknown',
    artist: artistRel?.attributes?.name || null,
    description: desc.split('\n---')[0].trim(),
    status: attrs.status,
    year: attrs.year,
    contentRating: attrs.contentRating,
    tags: attrs.tags?.map(t => t.attributes.name.en).filter(Boolean) || [],
    altTitles: attrs.altTitles?.slice(0, 3).map(t => Object.values(t)[0]).filter(Boolean) || [],
  };
}

function formatChapterList(data) {
  if (data.result !== 'ok') return { chapters: [], total: 0 };

  const seen = new Set();
  const chapters = [];

  for (const ch of data.data) {
    const attrs = ch.attributes;
    // Skip external-only chapters
    if (attrs.externalUrl && attrs.pages === 0) continue;
    // Deduplicate by chapter number
    const key = attrs.chapter || ch.id;
    if (seen.has(key)) continue;
    seen.add(key);

    const group = ch.relationships.find(r => r.type === 'scanlation_group');

    chapters.push({
      id: ch.id,
      chapter: attrs.chapter,
      title: attrs.title,
      volume: attrs.volume,
      pages: attrs.pages,
      group: group?.attributes?.name || 'Unknown',
      publishAt: attrs.publishAt,
    });
  }

  return {
    chapters,
    total: data.total,
    offset: data.offset,
    limit: data.limit,
  };
}

export default {
  async fetch(request) {
    return handleRequest(request);
  },
};
