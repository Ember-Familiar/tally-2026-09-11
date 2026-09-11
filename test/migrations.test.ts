import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { createDatabase } from "../src/db";
import { runMigrations } from "../src/migrations";


describe("Migrations & Data Model", () => {
  it("applies cleanly from empty and creates all 5 tables plus schema_migrations", () => {
    const db = createDatabase(":memory:", { autoMigrate: false });

    const applied = runMigrations(db);
    expect(applied).toContain("001_initial_schema.sql");
    expect(applied.length).toBe(1);

    const migrations = db.prepare("SELECT name, applied_at FROM schema_migrations;").all() as {
      name: string;
      applied_at: string;
    }[];
    expect(migrations.length).toBe(1);
    expect(migrations[0].name).toBe("001_initial_schema.sql");
    expect(migrations[0].applied_at).toBeDefined();

    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'groups', 'group_members', 'expenses', 'expense_splits') ORDER BY name;"
        )
        .all() as { name: string }[]
    ).map((r) => r.name);

    expect(tables).toEqual([
      "expense_splits",
      "expenses",
      "group_members",
      "groups",
      "users",
    ]);

    const indexes = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_expenses_group_id_date_id';"
        )
        .all() as { name: string }[]
    );
    expect(indexes.length).toBe(1);

    db.close();
  });

  it("is idempotent: a second run is a no-op that applies nothing", () => {
    const db = createDatabase(":memory:", { autoMigrate: false });

    const firstRun = runMigrations(db);
    expect(firstRun.length).toBe(1);

    const secondRun = runMigrations(db);
    expect(secondRun.length).toBe(0);
    expect(secondRun).toEqual([]);

    db.close();
  });

  it("autoMigrate defaults to true in createDatabase", () => {
    const db = createDatabase(":memory:");
    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'groups', 'group_members', 'expenses', 'expense_splits') ORDER BY name;"
        )
        .all() as { name: string }[]
    ).map((r) => r.name);

    expect(tables.length).toBe(5);
    db.close();
  });

  it("handles non-existent migrations directory gracefully", () => {
    const db = createDatabase(":memory:", { autoMigrate: false });
    const applied = runMigrations(db, "/tmp/non-existent-migrations-dir-" + Date.now());
    expect(applied).toEqual([]);
    db.close();
  });

  it("applies migrations in numeric prefix order", () => {
    const db = createDatabase(":memory:", { autoMigrate: false });
    const tmpDir = path.join("/tmp", `tally-test-migrations-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      fs.writeFileSync(path.join(tmpDir, "10_third.sql"), "CREATE TABLE third (id INT);");
      fs.writeFileSync(path.join(tmpDir, "1_first.sql"), "CREATE TABLE first (id INT);");
      fs.writeFileSync(path.join(tmpDir, "002_second.sql"), "CREATE TABLE second (id INT);");

      const applied = runMigrations(db, tmpDir);
      expect(applied).toEqual(["1_first.sql", "002_second.sql", "10_third.sql"]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      db.close();
    }
  });

  it("rolls back failed migration atomically without stranding transaction", () => {
    const db = createDatabase(":memory:", { autoMigrate: false });
    const tmpDir = path.join("/tmp", `tally-test-fail-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      fs.writeFileSync(path.join(tmpDir, "001_good.sql"), "CREATE TABLE good (id INT);");
      fs.writeFileSync(path.join(tmpDir, "002_bad.sql"), "CREATE TABLE bad (id INT); CREATE TABLE bad (id INT);");

      expect(() => runMigrations(db, tmpDir)).toThrow(/Failed to apply migration 002_bad\.sql/);
      expect(db.inTransaction).toBe(false);

      const tables = (
        db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;").all() as { name: string }[]
      ).map((r) => r.name);
      expect(tables).toContain("good");
      expect(tables).not.toContain("bad");

      const migrations = (
        db.prepare("SELECT name FROM schema_migrations;").all() as { name: string }[]
      ).map((r) => r.name);
      expect(migrations).toEqual(["001_good.sql"]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      db.close();
    }
  });

  describe("Table insertions and constraint enforcement", () => {
    it("accepts valid rows across all five tables", () => {
      const db = createDatabase(":memory:");

      const userStmt = db.prepare("INSERT INTO users (name) VALUES (?);");
      const u1 = userStmt.run("Alice");
      const u2 = userStmt.run("Bob");
      expect(Number(u1.lastInsertRowid)).toBe(1);
      expect(Number(u2.lastInsertRowid)).toBe(2);

      const userRow = db.prepare("SELECT * FROM users WHERE id = 1;").get() as {
        id: number;
        name: string;
        created_at: string;
      };
      expect(userRow.name).toBe("Alice");
      expect(userRow.created_at).toBeDefined();

      const groupStmt = db.prepare("INSERT INTO groups (name) VALUES (?);");
      const g1 = groupStmt.run("Paris Trip");
      expect(Number(g1.lastInsertRowid)).toBe(1);

      const groupRow = db.prepare("SELECT * FROM groups WHERE id = 1;").get() as {
        id: number;
        name: string;
        created_at: string;
      };
      expect(groupRow.name).toBe("Paris Trip");
      expect(groupRow.created_at).toBeDefined();

      const memberStmt = db.prepare("INSERT INTO group_members (group_id, user_id) VALUES (?, ?);");
      memberStmt.run(1, 1);
      memberStmt.run(1, 2);

      const memberRows = db
        .prepare("SELECT * FROM group_members WHERE group_id = 1 ORDER BY user_id ASC;")
        .all() as { group_id: number; user_id: number; joined_at: string }[];
      expect(memberRows.length).toBe(2);
      expect(memberRows[0].user_id).toBe(1);
      expect(memberRows[1].user_id).toBe(2);
      expect(memberRows[0].joined_at).toBeDefined();

      const expenseStmt = db.prepare(
        "INSERT INTO expenses (group_id, paid_by, amount, description) VALUES (?, ?, ?, ?);"
      );
      const exp1 = expenseStmt.run(1, 1, 12500, "Hotel room");
      expect(Number(exp1.lastInsertRowid)).toBe(1);

      const expRow = db.prepare("SELECT * FROM expenses WHERE id = 1;").get() as {
        id: number;
        group_id: number;
        paid_by: number;
        amount: number;
        description: string;
        date: string;
        created_at: string;
      };
      expect(expRow.group_id).toBe(1);
      expect(expRow.paid_by).toBe(1);
      expect(expRow.amount).toBe(12500);
      expect(expRow.description).toBe("Hotel room");
      expect(expRow.date).toBeDefined();
      expect(expRow.created_at).toBeDefined();

      const splitStmt = db.prepare(
        "INSERT INTO expense_splits (expense_id, user_id, amount) VALUES (?, ?, ?);"
      );
      splitStmt.run(1, 1, 6250);
      splitStmt.run(1, 2, 6250);

      const splitRows = db
        .prepare("SELECT * FROM expense_splits WHERE expense_id = 1 ORDER BY user_id ASC;")
        .all() as { id: number; expense_id: number; user_id: number; amount: number; created_at: string }[];
      expect(splitRows.length).toBe(2);
      expect(splitRows[0].amount).toBe(6250);
      expect(splitRows[1].amount).toBe(6250);
      expect(splitRows[0].created_at).toBeDefined();

      db.close();
    });

    it("rejects foreign key violations at runtime (enforces foreign keys)", () => {
      const db = createDatabase(":memory:");

      const fkPragma = db.prepare("PRAGMA foreign_keys;").get() as { foreign_keys: number };
      expect(fkPragma.foreign_keys).toBe(1);

      db.prepare("INSERT INTO users (name) VALUES (?);").run("Alice");
      db.prepare("INSERT INTO groups (name) VALUES (?);").run("Paris Trip");

      const memberStmt = db.prepare("INSERT INTO group_members (group_id, user_id) VALUES (?, ?);");
      expect(() => {
        memberStmt.run(999, 1);
      }).toThrow(/FOREIGN KEY constraint failed/);

      expect(() => {
        memberStmt.run(1, 999);
      }).toThrow(/FOREIGN KEY constraint failed/);

      const expenseStmt = db.prepare(
        "INSERT INTO expenses (group_id, paid_by, amount, description) VALUES (?, ?, ?, ?);"
      );
      expect(() => {
        expenseStmt.run(999, 1, 5000, "Invalid group");
      }).toThrow(/FOREIGN KEY constraint failed/);

      expect(() => {
        expenseStmt.run(1, 999, 5000, "Invalid payer");
      }).toThrow(/FOREIGN KEY constraint failed/);

      expenseStmt.run(1, 1, 5000, "Valid Dinner");

      const splitStmt = db.prepare(
        "INSERT INTO expense_splits (expense_id, user_id, amount) VALUES (?, ?, ?);"
      );
      expect(() => {
        splitStmt.run(999, 1, 2500);
      }).toThrow(/FOREIGN KEY constraint failed/);

      expect(() => {
        splitStmt.run(1, 999, 2500);
      }).toThrow(/FOREIGN KEY constraint failed/);

      db.close();
    });

    it("rejects uniqueness violations", () => {
      const db = createDatabase(":memory:");

      db.prepare("INSERT INTO users (name) VALUES (?);").run("Alice");
      db.prepare("INSERT INTO groups (name) VALUES (?);").run("Trip");

      const memberStmt = db.prepare("INSERT INTO group_members (group_id, user_id) VALUES (?, ?);");
      memberStmt.run(1, 1);
      expect(() => {
        memberStmt.run(1, 1);
      }).toThrow(/UNIQUE constraint failed: group_members\.group_id, group_members\.user_id|PRIMARY KEY/);

      db.prepare("INSERT INTO expenses (group_id, paid_by, amount, description) VALUES (1, 1, 1000, ?);").run("Food");
      const splitStmt = db.prepare("INSERT INTO expense_splits (expense_id, user_id, amount) VALUES (?, ?, ?);");
      splitStmt.run(1, 1, 1000);
      expect(() => {
        splitStmt.run(1, 1, 500);
      }).toThrow(/UNIQUE constraint failed: expense_splits\.expense_id, expense_splits\.user_id/);

      expect(() => {
        db.prepare("INSERT INTO schema_migrations (name) VALUES (?);").run("001_initial_schema.sql");
      }).toThrow(/UNIQUE constraint failed: schema_migrations\.name/);

      db.close();
    });

    it("rejects NOT NULL constraint violations", () => {
      const db = createDatabase(":memory:");

      expect(() => {
        db.prepare("INSERT INTO users (name) VALUES (NULL);").run();
      }).toThrow(/NOT NULL constraint failed: users\.name/);

      expect(() => {
        db.prepare("INSERT INTO groups (name) VALUES (NULL);").run();
      }).toThrow(/NOT NULL constraint failed: groups\.name/);

      db.prepare("INSERT INTO users (name) VALUES (?);").run("Alice");
      db.prepare("INSERT INTO groups (name) VALUES (?);").run("Trip");

      expect(() => {
        db.prepare("INSERT INTO group_members (group_id, user_id) VALUES (NULL, 1);").run();
      }).toThrow(/NOT NULL constraint failed/);
      expect(() => {
        db.prepare("INSERT INTO group_members (group_id, user_id) VALUES (1, NULL);").run();
      }).toThrow(/NOT NULL constraint failed/);

      expect(() => {
        db.prepare("INSERT INTO expenses (group_id, paid_by, amount) VALUES (NULL, 1, 1000);").run();
      }).toThrow(/NOT NULL constraint failed: expenses\.group_id/);
      expect(() => {
        db.prepare("INSERT INTO expenses (group_id, amount) VALUES (1, 1000);").run();
      }).toThrow(/NOT NULL constraint failed: expenses\.paid_by/);
      expect(() => {
        db.prepare("INSERT INTO expenses (group_id, paid_by, amount) VALUES (1, NULL, 1000);").run();
      }).toThrow(/NOT NULL constraint failed: expenses\.paid_by/);
      expect(() => {
        db.prepare("INSERT INTO expenses (group_id, paid_by, amount) VALUES (1, 1, NULL);").run();
      }).toThrow(/NOT NULL constraint failed: expenses\.amount/);

      db.prepare("INSERT INTO expenses (group_id, paid_by, amount) VALUES (1, 1, 1000);").run();
      expect(() => {
        db.prepare("INSERT INTO expense_splits (expense_id, user_id, amount) VALUES (NULL, 1, 500);").run();
      }).toThrow(/NOT NULL constraint failed: expense_splits\.expense_id/);
      expect(() => {
        db.prepare("INSERT INTO expense_splits (expense_id, user_id, amount) VALUES (1, NULL, 500);").run();
      }).toThrow(/NOT NULL constraint failed: expense_splits\.user_id/);
      expect(() => {
        db.prepare("INSERT INTO expense_splits (expense_id, user_id, amount) VALUES (1, 1, NULL);").run();
      }).toThrow(/NOT NULL constraint failed: expense_splits\.amount/);

      db.close();
    });

    it("enforces money integer cents constraints and rejects floats / invalid amounts", () => {
      const db = createDatabase(":memory:");
      db.prepare("INSERT INTO users (name) VALUES (?);").run("Alice");
      db.prepare("INSERT INTO groups (name) VALUES (?);").run("Trip");

      const expenseStmt = db.prepare(
        "INSERT INTO expenses (group_id, paid_by, amount, description) VALUES (?, ?, ?, ?);"
      );

      expect(() => {
        expenseStmt.run(1, 1, 10.5, "Float amount");
      }).toThrow(/CHECK constraint failed/);

      expect(() => {
        expenseStmt.run(1, 1, 0, "Zero amount");
      }).toThrow(/CHECK constraint failed/);

      expect(() => {
        expenseStmt.run(1, 1, -100, "Negative amount");
      }).toThrow(/CHECK constraint failed/);

      const validExp = expenseStmt.run(1, 1, 1050, "10 dollars 50 cents");
      expect(Number(validExp.lastInsertRowid)).toBe(1);

      const splitStmt = db.prepare(
        "INSERT INTO expense_splits (expense_id, user_id, amount) VALUES (?, ?, ?);"
      );

      expect(() => {
        splitStmt.run(1, 1, 5.25);
      }).toThrow(/CHECK constraint failed/);

      expect(() => {
        splitStmt.run(1, 1, -50);
      }).toThrow(/CHECK constraint failed/);

      splitStmt.run(1, 1, 1050);

      db.close();
    });

    it("rejects expense insertion without paid_by with NOT NULL constraint failure", () => {
      const db = createDatabase(":memory:");
      db.prepare("INSERT INTO users (name) VALUES (?);").run("Alice");
      db.prepare("INSERT INTO groups (name) VALUES (?);").run("Trip");

      expect(() => {
        db.prepare("INSERT INTO expenses (group_id, amount) VALUES (1, 1000);").run();
      }).toThrow(/NOT NULL constraint failed: expenses\.paid_by/);

      db.close();
    });

    it("enforces date format constraints and rejects non-standard formats", () => {
      const db = createDatabase(":memory:");
      db.prepare("INSERT INTO users (name) VALUES (?);").run("Alice");
      db.prepare("INSERT INTO groups (name) VALUES (?);").run("Trip");

      const expenseStmt = db.prepare(
        "INSERT INTO expenses (group_id, paid_by, amount, description, date) VALUES (?, ?, ?, ?, ?);"
      );

      // Valid formatted date accepted
      expenseStmt.run(1, 1, 1000, "Lunch", "2026-09-05 12:30:00");

      // Non-conforming formats rejected
      expect(() => {
        expenseStmt.run(1, 1, 1000, "Lunch", "not-a-date");
      }).toThrow(/CHECK constraint failed/);

      expect(() => {
        expenseStmt.run(1, 1, 1000, "Lunch", "2026-09-05T12:30:00Z");
      }).toThrow(/CHECK constraint failed/);

      expect(() => {
        expenseStmt.run(1, 1, 1000, "Lunch", "2026-09-05");
      }).toThrow(/CHECK constraint failed/);

      db.close();
    });

    it("enforces ON DELETE RESTRICT on expenses.paid_by to protect financial history", () => {
      const db = createDatabase(":memory:");
      db.prepare("INSERT INTO users (name) VALUES (?);").run("Alice");
      db.prepare("INSERT INTO groups (name) VALUES (?);").run("Trip");
      db.prepare("INSERT INTO expenses (group_id, paid_by, amount, description) VALUES (1, 1, 5000, 'Hotel');").run();

      expect(() => {
        db.prepare("DELETE FROM users WHERE id = 1;").run();
      }).toThrow(/FOREIGN KEY constraint failed/);

      db.close();
    });

    it("enforces cascade deletes across the entire data model hierarchy", () => {
      const db = createDatabase(":memory:");

      db.prepare("INSERT INTO users (name) VALUES (?);").run("Alice");
      db.prepare("INSERT INTO users (name) VALUES (?);").run("Bob");
      db.prepare("INSERT INTO groups (name) VALUES (?);").run("Paris");

      db.prepare("INSERT INTO group_members (group_id, user_id) VALUES (1, 1);").run();
      db.prepare("INSERT INTO group_members (group_id, user_id) VALUES (1, 2);").run();

      db.prepare("INSERT INTO expenses (group_id, paid_by, amount, description) VALUES (1, 1, 10000, ?);").run("Hotel");
      db.prepare("INSERT INTO expense_splits (expense_id, user_id, amount) VALUES (1, 1, 5000);").run();
      db.prepare("INSERT INTO expense_splits (expense_id, user_id, amount) VALUES (1, 2, 5000);").run();

      db.prepare("DELETE FROM groups WHERE id = 1;").run();

      const membersCount = (db.prepare("SELECT count(*) as count FROM group_members WHERE group_id = 1;").get() as { count: number }).count;
      expect(membersCount).toBe(0);

      const expensesCount = (db.prepare("SELECT count(*) as count FROM expenses WHERE group_id = 1;").get() as { count: number }).count;
      expect(expensesCount).toBe(0);

      const splitsCount = (db.prepare("SELECT count(*) as count FROM expense_splits WHERE expense_id = 1;").get() as { count: number }).count;
      expect(splitsCount).toBe(0);

      const usersCount = (db.prepare("SELECT count(*) as count FROM users;").get() as { count: number }).count;
      expect(usersCount).toBe(2);

      db.close();
    });
  });
});
