import { afterEach, describe, expect, it } from "vitest";
import { isCrossOriginWrite, isPublic } from "./request-guards";

function req(method: string, origin?: string) {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  return { method, headers, nextUrl: new URL("https://axia.example.com/api/chat") };
}

describe("isPublic", () => {
  it("never treats API paths as public static files", () => {
    expect(isPublic("/api/datasets/sources.png")).toBe(false);
    expect(isPublic("/api/chat-threads/x.svg")).toBe(false);
  });
  it("still serves static images and auth routes without a session", () => {
    expect(isPublic("/logo.png")).toBe(true);
    expect(isPublic("/api/auth/signin")).toBe(true);
    expect(isPublic("/login")).toBe(true);
    expect(isPublic("/")).toBe(false);
  });
});

describe("isCrossOriginWrite", () => {
  const saved = process.env.AUTH_URL;
  afterEach(() => {
    process.env.AUTH_URL = saved;
  });

  it("blocks writes from another origin, including sibling subdomains", () => {
    process.env.AUTH_URL = "https://axia.example.com";
    expect(isCrossOriginWrite(req("POST", "https://evil.example"))).toBe(true);
    expect(isCrossOriginWrite(req("DELETE", "https://other.example.com"))).toBe(true);
  });
  it("allows same-origin writes, reads, and non-browser clients", () => {
    process.env.AUTH_URL = "https://axia.example.com";
    expect(isCrossOriginWrite(req("POST", "https://axia.example.com"))).toBe(false);
    expect(isCrossOriginWrite(req("GET", "https://evil.example"))).toBe(false);
    expect(isCrossOriginWrite(req("POST"))).toBe(false);
  });
  it("falls back to the request origin when AUTH_URL is unset", () => {
    delete process.env.AUTH_URL;
    expect(isCrossOriginWrite(req("PUT", "https://axia.example.com"))).toBe(false);
    expect(isCrossOriginWrite(req("PUT", "https://evil.example"))).toBe(true);
  });
});
