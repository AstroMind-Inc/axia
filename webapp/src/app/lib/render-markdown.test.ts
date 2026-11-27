// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./render-markdown";

describe("renderMarkdown", () => {
  it("strips script and event-handler attributes from model output", () => {
    const html = renderMarkdown(
      'Result\n\n<img src=x onerror="fetch(\'/api/chat-threads\')"><script>alert(1)</script>' +
        '<a href="javascript:alert(1)">link</a><iframe src="https://evil.example"></iframe>',
    );
    expect(html).not.toMatch(/onerror/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/<iframe/i);
  });

  it("keeps ordinary markdown formatting", () => {
    const html = renderMarkdown("# Title\n\n**bold** and `code`\n\n- item\n\n[CSC](https://cxc.cfa.harvard.edu/csc/)");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<li>item</li>");
    expect(html).toContain('href="https://cxc.cfa.harvard.edu/csc/"');
  });
});
