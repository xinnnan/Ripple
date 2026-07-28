type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function omit(record: JsonRecord, keys: string[]): JsonRecord {
  const copy = { ...record };
  for (const key of keys) delete copy[key];
  return copy;
}

/**
 * Customer-visible field-service response.
 *
 * Completion reports are customer deliverables, while internal completion
 * notes, staff identifiers/emails, and travel-origin details are operations
 * data and must not cross the tenant-facing API boundary.
 */
export function fieldServiceOrderForExternal(value: JsonRecord): JsonRecord {
  const external = omit(value, [
    "completion_notes",
    "requested_by",
    "completed_by",
    "travel_from",
    "requester",
    "completer",
  ]);

  if (Array.isArray(value.engineers)) {
    external.engineers = value.engineers.map((entry) => {
      const row = asRecord(entry);
      if (!row) return entry;
      const engineer = asRecord(row.engineer);
      return {
        role: row.role,
        engineer: engineer
          ? {
              id: engineer.id,
              full_name: engineer.full_name,
            }
          : null,
      };
    });
  }

  return external;
}

/**
 * Customer-visible spare-part request response.
 *
 * Logistics and fulfillment are visible; internal cost, approver identifiers,
 * and catalog price fields are not.
 */
export function sparePartRequestForExternal(value: JsonRecord): JsonRecord {
  const external = omit(value, [
    "total_cost",
    "approved_by",
    "requested_by",
    "approver",
    "requester",
  ]);

  if (Array.isArray(value.items)) {
    external.items = value.items.map((entry) => {
      const row = asRecord(entry);
      if (!row) return entry;
      const item = omit(row, ["unit_price"]);
      const part = asRecord(row.spare_part);
      if (part) {
        item.spare_part = omit(part, ["unit_price"]);
      } else if (Array.isArray(row.spare_part)) {
        item.spare_part = row.spare_part.map((candidate) => {
          const candidateRecord = asRecord(candidate);
          return candidateRecord
            ? omit(candidateRecord, ["unit_price"])
            : candidate;
        });
      }
      return item;
    });
  }

  return external;
}
