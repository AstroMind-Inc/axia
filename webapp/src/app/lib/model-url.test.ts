import { afterEach, describe, expect, it } from "vitest";
import { customModelUrlsAllowed, forwardableModelUrl } from "./model-url";

const ORIGINAL = process.env.ALLOW_CUSTOM_MODEL_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ALLOW_CUSTOM_MODEL_URL;
  else process.env.ALLOW_CUSTOM_MODEL_URL = ORIGINAL;
});

describe("forwardableModelUrl", () => {
  it("drops client URLs by default", () => {
    delete process.env.ALLOW_CUSTOM_MODEL_URL;
    expect(customModelUrlsAllowed()).toBe(false);
    expect(forwardableModelUrl("http://169.254.169.254/latest")).toBeUndefined();
    expect(forwardableModelUrl("http://mongo:27017")).toBeUndefined();
  });

  it("drops client URLs unless the flag is exactly 'true'", () => {
    for (const value of ["false", "1", "yes", "TRUE", ""]) {
      process.env.ALLOW_CUSTOM_MODEL_URL = value;
      expect(forwardableModelUrl("https://gpu.example.com")).toBeUndefined();
    }
  });

  it("forwards a non-empty string URL when allowed", () => {
    process.env.ALLOW_CUSTOM_MODEL_URL = "true";
    expect(forwardableModelUrl("https://gpu.example.com")).toBe("https://gpu.example.com");
    expect(forwardableModelUrl("   ")).toBeUndefined();
    expect(forwardableModelUrl({ url: "x" })).toBeUndefined();
  });
});
