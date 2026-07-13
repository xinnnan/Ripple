import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase admin client before importing the module under test
const insertMock = vi.fn();
const fromMock = vi.fn(() => ({ insert: insertMock }));

vi.mock("./supabase/admin", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

import { logAudit, logDiff } from "./audit";

beforeEach(() => {
  insertMock.mockReset();
  fromMock.mockClear();
  // Default: insert resolves
  insertMock.mockResolvedValue({ error: null });
});

describe("logAudit", () => {
  it("writes a single row to audit_logs with the expected shape", async () => {
    await logAudit({
      actorId: "u1",
      actorEmail: "a@dropletai.services",
      actorRole: "admin",
      entityType: "customer",
      entityId: "c1",
      action: "created",
      newValue: "Acme",
      metadata: { foo: "bar" },
    });
    expect(fromMock).toHaveBeenCalledWith("audit_logs");
    expect(insertMock).toHaveBeenCalledTimes(1);
    const [row] = insertMock.mock.calls[0];
    expect(row).toMatchObject({
      actor_id: "u1",
      actor_email: "a@dropletai.services",
      actor_role: "admin",
      entity_type: "customer",
      entity_id: "c1",
      action: "created",
      new_value: "Acme",
      metadata: { foo: "bar" },
    });
  });

  it("coerces null / undefined fields to null in the row", async () => {
    await logAudit({
      entityType: "site",
      action: "updated",
    });
    const [row] = insertMock.mock.calls[0];
    expect(row).toMatchObject({
      actor_id: null,
      actor_email: null,
      actor_role: null,
      entity_type: "site",
      entity_id: null,
      action: "updated",
      field_name: null,
      old_value: null,
      new_value: null,
      metadata: {},
    });
  });

  it("swallows insert errors and never throws", async () => {
    insertMock.mockResolvedValueOnce({ error: { message: "db down" } });
    // Should not throw
    await logAudit({ entityType: "x", action: "created" });
    // And it should still attempt the insert
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});

describe("logDiff", () => {
  it("emits one row per changed field", async () => {
    await logDiff({
      actorId: "u1",
      entityType: "customer",
      entityId: "c1",
      before: { name: "Acme", status: "trial" },
      after: { name: "Acme Inc", status: "active" },
    });
    // 2 fields changed (name, status)
    expect(insertMock).toHaveBeenCalledTimes(2);
  });

  it("emits zero rows when nothing changed", async () => {
    await logDiff({
      actorId: "u1",
      entityType: "customer",
      entityId: "c1",
      before: { name: "Acme", status: "active" },
      after: { name: "Acme", status: "active" },
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("ignores updated_at by default", async () => {
    await logDiff({
      actorId: "u1",
      entityType: "customer",
      entityId: "c1",
      before: { name: "Acme", updated_at: "2026-01-01" },
      after: { name: "Acme", updated_at: "2026-07-13" },
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("respects the explicit ignoredFields list", async () => {
    await logDiff({
      actorId: "u1",
      entityType: "customer",
      entityId: "c1",
      before: { name: "Acme", phone: "1" },
      after: { name: "Acme Inc", phone: "2" },
      ignoredFields: ["phone"],
    });
    expect(insertMock).toHaveBeenCalledTimes(1);
    const [row] = insertMock.mock.calls[0];
    expect(row.field_name).toBe("name");
  });

  it("treats null in `before` as a new field (creation-style)", async () => {
    await logDiff({
      actorId: "u1",
      entityType: "site",
      entityId: "s1",
      before: null,
      after: { site_name: "New Site" },
    });
    expect(insertMock).toHaveBeenCalledTimes(1);
    const [row] = insertMock.mock.calls[0];
    expect(row.field_name).toBe("site_name");
    expect(row.old_value).toBeNull();
    expect(row.new_value).toBe("New Site");
  });
});
