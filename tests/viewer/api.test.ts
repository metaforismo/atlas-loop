import { describe, expect, it } from "vitest";
import { normalizeArtifactList, normalizeEventList, normalizeScreenshotPayload, toResourceUrl } from "../../apps/viewer/src/api.js";

describe("viewer api normalizers", () => {
  it("accepts raw artifact arrays and wrapped artifact collections", () => {
    const artifact = {
      id: "art_1",
      type: "screenshot",
      path: "screenshots/latest.png"
    };

    expect(normalizeArtifactList([artifact])).toEqual([artifact]);
    expect(normalizeArtifactList({ artifacts: [artifact, { bad: true }] })).toEqual([artifact]);
  });

  it("accepts raw event arrays and wrapped event collections", () => {
    const event = { type: "error", at: "2026-07-04T09:00:00.000Z", error: { message: "Nope" } };

    expect(normalizeEventList([event])).toEqual([event]);
    expect(normalizeEventList({ events: [event, null] })).toEqual([event]);
  });

  it("turns screenshot JSON payloads into displayable data URLs or daemon URLs", () => {
    expect(normalizeScreenshotPayload({ base64: "abc", mediaType: "image/png" }, "http://127.0.0.1:4317")).toMatchObject({
      status: "ready",
      src: "data:image/png;base64,abc",
      source: "data-url"
    });

    expect(normalizeScreenshotPayload({ path: "/v1/sessions/a/latest-screenshot" }, "http://127.0.0.1:4317")).toMatchObject({
      status: "ready",
      src: "http://127.0.0.1:4317/v1/sessions/a/latest-screenshot",
      source: "url"
    });
  });

  it("resolves relative artifact paths against the daemon", () => {
    expect(toResourceUrl("artifacts/session/log.txt", "http://127.0.0.1:4317/")).toBe(
      "http://127.0.0.1:4317/artifacts/session/log.txt"
    );
  });
});
