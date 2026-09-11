import { describe, it, expect } from "vitest";
import { parsePort } from "../src/server";

describe("Server PORT validation", () => {
  it("rejects PORT=8080abc with clear error message", () => {
    expect(() => parsePort("8080abc")).toThrow(
      "Invalid PORT environment variable: 8080abc"
    );
  });

  it("rejects PORT=99999 with clear error message", () => {
    expect(() => parsePort("99999")).toThrow(
      "Invalid PORT environment variable: 99999"
    );
  });

  it("rejects PORT=0 with clear error message", () => {
    expect(() => parsePort("0")).toThrow(
      "Invalid PORT environment variable: 0"
    );
  });

  it("accepts valid port number string", () => {
    expect(parsePort("8080")).toBe(8080);
  });

  it("defaults to 3000 when PORT is undefined", () => {
    expect(parsePort(undefined)).toBe(3000);
  });
});
