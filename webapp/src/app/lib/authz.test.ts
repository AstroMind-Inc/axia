import { describe, expect, it } from "vitest";
import { isPublicCorpus, isSystemCollection, SYSTEM_COLLECTIONS } from "./collections";
import { excludeSelfNeighbors } from "./neighbors";

describe("isSystemCollection", () => {
  it("blocks private app collections from being queried as datasets", () => {
    expect(isSystemCollection("chat_threads")).toBe(true);
    expect(isSystemCollection("user_uploaded_sources")).toBe(true);
    expect(isSystemCollection("user_settings")).toBe(true);
    expect(isSystemCollection("chat_messages")).toBe(true);
    expect(isSystemCollection("chat_message_feedbacks")).toBe(true);
    expect(isSystemCollection("metadata_records")).toBe(true);
    expect(SYSTEM_COLLECTIONS.has("sources")).toBe(false);
  });
});

describe("isPublicCorpus", () => {
  it("treats the configured corpus collection as public to logged-in users", () => {
    expect(isPublicCorpus("sources")).toBe(true);
    expect(isPublicCorpus("user_uploaded_sources")).toBe(false);
    expect(isPublicCorpus("chat_threads")).toBe(false);
  });
});

describe("excludeSelfNeighbors", () => {
  const corpus = [
    { _id: "a", obsid: 1, source_name: "2CXO J1" },
    { _id: "b", obsid: 2, source_name: "2CXO J2" },
    { _id: "c", obsid: 1, source_name: "2CXO J1" },
  ];

  it("drops the same _id", () => {
    expect(excludeSelfNeighbors(corpus, { _id: "a" }).map((n) => n._id)).toEqual([
      "b",
      "c",
    ]);
  });

  it("drops the same (obsid, source_name) pair", () => {
    expect(
      excludeSelfNeighbors(corpus, { obsid: 1, source_name: "2CXO J1" }).map(
        (n) => n._id,
      ),
    ).toEqual(["b"]);
  });

  it("leaves the list unchanged when no source is given", () => {
    expect(excludeSelfNeighbors(corpus, null)).toHaveLength(3);
  });
});
