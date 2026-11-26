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

  it("denies the shared model_config collection", async () => {
    const db = { collection: () => ({ findOne: vi.fn() }) } as any;
    expect(await canAccessCollection(db, "model_config", "user-a")).toBe(false);
  });

  it("refuses non-string collection names before querying", async () => {
    const findOne = vi.fn().mockResolvedValue({ collection_name: "user_foo_1" });
    const db = { collection: () => ({ findOne }) } as any;
    for (const name of [{ $ne: null }, ["user_foo_1"], 42, null, undefined, ""]) {
      expect(await canAccessCollection(db, name, "user-a")).toBe(false);
    }
    expect(findOne).not.toHaveBeenCalled();
  });

  it("looks ownership up in the metadata registry collection", async () => {
    const collection = vi.fn(() => ({ findOne: vi.fn().mockResolvedValue(null) }));
    await canAccessCollection({ collection } as any, "user_foo_1", "user-a");
    expect(collection).toHaveBeenCalledWith("metadata_records");
  });

  it("denies another user's upload collection", async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const db = { collection: () => ({ findOne }) } as any;
    expect(await canAccessCollection(db, "user_foo_1", "user-b")).toBe(false);
  });
});
