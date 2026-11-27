import DOMPurify from "dompurify";
import { marked } from "marked";

// Model output is rendered as HTML, and `marked` passes raw HTML through
// untouched. Model output can be steered by text the user did not write (an
// uploaded dataset, a source name, a crafted prompt someone was talked into
// pasting), so `<img onerror=...>` in a reply would run script on this origin
// with the viewer's session and could read all of their threads and uploads.
// Everything goes through DOMPurify before it reaches the DOM.

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Markdown to HTML that is safe to pass to dangerouslySetInnerHTML. */
export function renderMarkdown(markdown: string): string {
  // DOMPurify needs a DOM. Chat content only exists client-side, so during
  // server rendering fall back to plain escaped text rather than raw HTML.
  if (typeof window === "undefined") {
    return escapeHtml(markdown);
  }
  const html = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
