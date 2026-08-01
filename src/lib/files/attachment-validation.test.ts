import { File } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  AttachmentValidationError,
  buildAttachmentStoragePath,
  MAX_ATTACHMENT_BYTES,
  validateAttachmentFile,
} from "./attachment-validation";

function file(
  name: string,
  type: string,
  bytes: number[] | Uint8Array
) {
  return new File([Uint8Array.from(bytes)], name, { type }) as unknown as File;
}

describe("attachment content validation", () => {
  it.each([
    ["proof.jpg", "image/jpeg", [0xff, 0xd8, 0xff, 0xdb]],
    [
      "proof.png",
      "image/png",
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ],
    ["proof.gif", "image/gif", [...Buffer.from("GIF89a")]],
    [
      "proof.webp",
      "image/webp",
      [...Buffer.from("RIFF0000WEBP")],
    ],
    ["proof.pdf", "application/pdf", [...Buffer.from("%PDF-1.7")]],
    ["proof.xls", "application/vnd.ms-excel", [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  ])("accepts verified %s content", async (name, type, bytes) => {
    const result = await validateAttachmentFile(file(name, type, bytes));
    expect(result.fileName).toBe(name);
    expect(result.bytes.byteLength).toBe(bytes.length);
  });

  it("normalizes log and CSV media types after UTF-8 validation", async () => {
    const log = await validateAttachmentFile(
      file("events.log", "application/octet-stream", Buffer.from("ok\nnext"))
    );
    const csv = await validateAttachmentFile(
      file("events.csv", "application/vnd.ms-excel", Buffer.from("a,b\n1,2"))
    );

    expect(log.mediaType).toBe("text/plain");
    expect(csv.mediaType).toBe("text/csv");
  });

  it("rejects extension, declared MIME, and content spoofing", async () => {
    await expect(
      validateAttachmentFile(file("payload.exe", "application/pdf", [1]))
    ).rejects.toThrow("extension is not allowed");
    await expect(
      validateAttachmentFile(file("proof.pdf", "image/png", Buffer.from("%PDF-")))
    ).rejects.toThrow("Declared file type");
    await expect(
      validateAttachmentFile(file("proof.pdf", "application/pdf", Buffer.from("not pdf")))
    ).rejects.toThrow("content does not match");
  });

  it("rejects unsafe names, empty/oversized files, and binary text", async () => {
    await expect(
      validateAttachmentFile(file("../proof.pdf", "application/pdf", Buffer.from("%PDF-")))
    ).rejects.toBeInstanceOf(AttachmentValidationError);
    await expect(
      validateAttachmentFile(file("empty.txt", "text/plain", []))
    ).rejects.toThrow("between 1 byte and 50MB");
    const oversized = {
      name: "large.txt",
      type: "text/plain",
      size: MAX_ATTACHMENT_BYTES + 1,
    } as File;
    await expect(validateAttachmentFile(oversized)).rejects.toThrow("50MB");
    await expect(
      validateAttachmentFile(file("binary.txt", "text/plain", [0x61, 0, 0x62]))
    ).rejects.toThrow("content does not match");
  });

  it("accepts a macro-free workbook and rejects a macro-bearing workbook", async () => {
    const safe = workbookBytes(["[Content_Types].xml", "xl/workbook.xml"]);
    const macro = workbookBytes([
      "[Content_Types].xml",
      "xl/workbook.xml",
      "xl/vbaProject.bin",
    ]);

    await expect(
      validateAttachmentFile(
        file(
          "stock.xlsx",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          safe
        )
      )
    ).resolves.toMatchObject({
      mediaType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    await expect(
      validateAttachmentFile(
        file(
          "macro.xlsx",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          macro
        )
      )
    ).rejects.toThrow("content does not match");
  });
});

describe("attachment storage keys", () => {
  it("binds new keys to environment, tenant, and ticket", () => {
    const path = buildAttachmentStoragePath({
      environment: "Preview/Unsafe",
      customerId: "11111111-1111-4111-8111-111111111111",
      ticketId: "22222222-2222-4222-8222-222222222222",
      fileName: "line photo.png",
    });

    expect(path).toMatch(
      /^attachments\/preview-unsafe\/11111111-1111-4111-8111-111111111111\/22222222-2222-4222-8222-222222222222\/[0-9a-f-]{36}-line_photo\.png$/
    );
  });
});

function workbookBytes(names: string[]) {
  const entries = names.map((name) => {
    const encoded = Buffer.from(name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(encoded.length, 26);
    return Buffer.concat([header, encoded]);
  });
  return Buffer.concat(entries);
}
