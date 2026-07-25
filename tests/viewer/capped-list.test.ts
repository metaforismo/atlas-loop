import { describe, expect, it } from "vitest";
import { capList } from "../../apps/viewer/src/cappedList.js";

const rows = (n: number) => Array.from({ length: n }, (_, index) => index);

describe("holding back what nobody will read", () => {
  it("renders everything when the list is short", () => {
    const result = capList(rows(12), { limit: 60 });

    expect(result.visible).toHaveLength(12);
    expect(result.hidden).toBe(0);
    expect(result.moreLabel).toBeUndefined();
  });

  it("renders exactly the limit and says how much is held back", () => {
    const result = capList(rows(600), { limit: 60, page: 200, noun: "artifact" });

    expect(result.visible).toHaveLength(60);
    expect(result.total).toBe(600);
    expect(result.hidden).toBe(540);
  });

  it("reveals in pages, so the escape hatch cannot freeze the page either", () => {
    // Unbounding six hundred rows in one click would move the twenty-second
    // paint behind a button rather than remove it.
    const result = capList(rows(600), { limit: 60, page: 200, noun: "artifact" });

    expect(result.moreLabel).toBe("Show 200 more of 540 artifacts");
    expect(result.nextLimit).toBe(260);
  });

  it("offers a small remainder in full rather than paging it", () => {
    const result = capList(rows(70), { limit: 60, page: 200, noun: "artifact" });

    expect(result.moreLabel).toBe("Show all 70 artifacts");
    expect(result.nextLimit).toBe(70);
  });

  it("never promises a next page past the end", () => {
    const result = capList(rows(100), { limit: 60, page: 200 });

    expect(result.nextLimit).toBe(100);
  });

  it("offers the whole list when only a row or two is hidden", () => {
    // "Show 1 more of 1 artifact" is a worse offer than "Show all 61".
    expect(capList(rows(61), { limit: 60, page: 1, noun: "artifact" }).moreLabel).toBe("Show all 61 artifacts");
    expect(capList(rows(2), { limit: 1, page: 5, noun: "artifact" }).moreLabel).toBe("Show all 2 artifacts");
  });

  it("counts one of something without an s", () => {
    const paged = capList(rows(62), { limit: 60, page: 1, revealAllUpTo: 0, noun: "artifact" });

    expect(paged.moreLabel).toBe("Show 1 more of 2 artifacts");
  });

  it("works without a noun", () => {
    expect(capList(rows(600), { limit: 60, page: 200 }).moreLabel).toBe("Show 200 more of 540");
  });

  it("does not divide by zero on an empty list or a zero limit", () => {
    expect(capList([], { limit: 60 })).toMatchObject({ visible: [], total: 0, hidden: 0 });
    expect(capList(rows(5), { limit: 0, page: 2 }).visible).toEqual([]);
    expect(capList(rows(5), { limit: 0, page: 2 }).nextLimit).toBe(2);
  });

  it("copies rather than aliasing the caller's array", () => {
    const source = rows(3);
    const result = capList(source, { limit: 60 });
    result.visible.push(99);

    expect(source).toHaveLength(3);
  });
});
