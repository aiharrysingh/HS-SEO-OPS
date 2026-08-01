import { marked } from "marked";

/**
 * Markdown → HTML for report preview and export.
 *
 * Content here is first-party (model-generated, human-edited by the team), so
 * this is not an untrusted-input path. It still strips script and event
 * handlers: "first-party" stops being true the moment someone pastes a
 * competitor's page into the work log, and the cost of being wrong is stored
 * XSS in a page that gets sent to clients.
 */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false, gfm: true }) as string;
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}
