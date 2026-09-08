import { describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { canAccessCollection } from "./authz";

describe("canAccessCollection", () => {
  it("denies system collections even for a logged-in user", async () => {
    const db = { collection: () => ({ findOne: vi.fn() }) } as any;
    expect(await canAccessCollection(db, "chat_threads", "user-a")).toBe(false);
    expect(await canAccessCollection(db, "user_uploaded_sources", "user-a")).toBe(
      false,
    );
  });

  it("allows the public corpus", async () => {
    const db = { collection: () => ({ findOne: vi.fn() }) } as any;
    expect(await canAccessCollection(db, "sources", "user-a")).toBe(true);
  });

  it("allows a user-owned upload collection", async () => {
    const findOne = vi.fn().mockResolvedValue({ collection_name: "user_foo_1" });
    const db = { collection: () => ({ findOne }) } as any;
    expect(await canAccessCollection(db, "user_foo_1", "user-a")).toBe(true);
    expect(findOne).toHaveBeenCalledWith({
      collection_name: "user_foo_1",
      user_id: "user-a",
    });
  });

  it("denies another user's upload collection", async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const db = { collection: () => ({ findOne }) } as any;
    expect(await canAccessCollection(db, "user_foo_1", "user-b")).toBe(false);
  });
});
