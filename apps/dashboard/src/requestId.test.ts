import { describe, expect, it, vi } from "vitest";
import { createUiRequestId } from "./requestId";

describe("createUiRequestId", () => {
  it("uses randomUUID when the browser provides it", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "native-id" });
    expect(createUiRequestId()).toBe("native-id");
    vi.unstubAllGlobals();
  });

  it("falls back to getRandomValues when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0);
        return bytes;
      },
    });

    expect(createUiRequestId()).toBe("00000000-0000-4000-8000-000000000000");
    vi.unstubAllGlobals();
  });

  it("still returns a UUID-shaped key without Web Crypto", () => {
    vi.stubGlobal("crypto", undefined);
    const id = createUiRequestId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    vi.unstubAllGlobals();
  });
});
