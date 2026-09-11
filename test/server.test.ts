import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { parsePort, resolveDbPath, createServer, DEFAULT_DB_PATH } from "../src/server";

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

describe("Server DB_PATH resolution and persistence", () => {
  const TEST_DB_FILE = path.join(__dirname, "test_server_persist.db");

  function cleanupDbFiles() {
    for (const suffix of ["", "-wal", "-shm"]) {
      const file = `${TEST_DB_FILE}${suffix}`;
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  }

  beforeEach(() => {
    cleanupDbFiles();
  });

  afterEach(() => {
    cleanupDbFiles();
  });

  it("defaults to tally.db when DB_PATH is undefined or empty", () => {
    expect(resolveDbPath(undefined)).toBe("tally.db");
    expect(resolveDbPath("")).toBe("tally.db");
    expect(DEFAULT_DB_PATH).toBe("tally.db");
  });

  it("respects custom database path", () => {
    expect(resolveDbPath("custom.db")).toBe("custom.db");
    expect(resolveDbPath("/tmp/custom.db")).toBe("/tmp/custom.db");
  });

  it("allows explicit :memory: database", () => {
    expect(resolveDbPath(":memory:")).toBe(":memory:");
  });

  it("persists data across server instances when using file-backed database", async () => {
    // Instance 1: Create a group on the file-backed database
    const instance1 = createServer(TEST_DB_FILE);
    const postRes = await request(instance1.app)
      .post("/groups")
      .send({ name: "Persistent Group", members: ["Alice"] });
    expect(postRes.status).toBe(201);
    const createdId = postRes.body.id;
    expect(createdId).toBeDefined();
    instance1.db.close();

    // Verify file exists on disk
    expect(fs.existsSync(TEST_DB_FILE)).toBe(true);

    // Instance 2: Start a new server instance against the same file
    const instance2 = createServer(TEST_DB_FILE);
    const getRes = await request(instance2.app).get(`/groups/${createdId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.name).toBe("Persistent Group");
    expect(getRes.body.members).toEqual([{ id: 1, name: "Alice" }]);
    instance2.db.close();
  });

  it("supports in-memory database without writing to disk", async () => {
    const memoryInstance = createServer(":memory:");
    const postRes = await request(memoryInstance.app)
      .post("/groups")
      .send({ name: "Ephemeral Group", members: ["Bob"] });
    expect(postRes.status).toBe(201);
    memoryInstance.db.close();

    expect(fs.existsSync(TEST_DB_FILE)).toBe(false);
  });
});
