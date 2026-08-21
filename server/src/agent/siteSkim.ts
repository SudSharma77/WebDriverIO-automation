/**
 * Best-effort static skim of a web target before live exploration starts.
 *
 * Fetches the raw HTML (no JS execution) and pulls out cheap structural
 * signals - title, headings, nav/link text, form field and button labels -
 * so the explorer has a rough map before it starts spending its tool-call
 * budget. Never blocks or fails the run: a JS-heavy app that renders an
 * empty shell just yields a thin (or null) skim, and the explorer falls back
 * to observing the live DOM as it always has.
 */
export async function skimSite(url: string): Promise<string | null> {
  let html: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  const title = firstMatch(/<title[^>]*>([^<]*)<\/title>/i, html);
  const headings = allMatches(/<h[12][^>]*>(.*?)<\/h[12]>/gis, html, 6);
  const links = allMatches(/<a\b[^>]*>(.*?)<\/a>/gis, html, 12);
  const buttons = allMatches(/<button\b[^>]*>(.*?)<\/button>/gis, html, 10);
  const labels = allMatches(/<label\b[^>]*>(.*?)<\/label>/gis, html, 10);

  const lines: string[] = [];
  if (title) lines.push(`Title: ${title}`);
  if (headings.length) lines.push(`Headings: ${headings.join(" | ")}`);
  if (links.length) lines.push(`Nav/links: ${links.join(" | ")}`);
  if (buttons.length) lines.push(`Buttons: ${buttons.join(" | ")}`);
  if (labels.length) lines.push(`Form labels: ${labels.join(" | ")}`);

  if (lines.length === 0) return null;
  return lines.join("\n").slice(0, 1200);
}

function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function firstMatch(pattern: RegExp, html: string): string | null {
  const text = stripTags(pattern.exec(html)?.[1] ?? "");
  return text || null;
}

function allMatches(pattern: RegExp, html: string, limit: number): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(pattern)) {
    const text = stripTags(match[1] ?? "");
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}
