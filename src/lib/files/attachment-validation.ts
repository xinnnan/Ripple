import { randomUUID } from "node:crypto";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILE_NAME_LENGTH,
} from "./attachment-contract";

export { MAX_ATTACHMENT_BYTES } from "./attachment-contract";

type AttachmentKind =
  | "jpeg"
  | "png"
  | "gif"
  | "webp"
  | "mp4"
  | "quicktime"
  | "pdf"
  | "text"
  | "csv"
  | "xlsx"
  | "xls";

interface AttachmentRule {
  kind: AttachmentKind;
  mediaType: string;
  declaredTypes: readonly string[];
}

export interface ValidatedAttachmentFile {
  bytes: Uint8Array;
  fileName: string;
  mediaType: string;
}

export class AttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentValidationError";
  }
}

const RULES: Record<string, AttachmentRule> = {
  jpg: {
    kind: "jpeg",
    mediaType: "image/jpeg",
    declaredTypes: ["", "image/jpeg"],
  },
  jpeg: {
    kind: "jpeg",
    mediaType: "image/jpeg",
    declaredTypes: ["", "image/jpeg"],
  },
  png: {
    kind: "png",
    mediaType: "image/png",
    declaredTypes: ["", "image/png"],
  },
  gif: {
    kind: "gif",
    mediaType: "image/gif",
    declaredTypes: ["", "image/gif"],
  },
  webp: {
    kind: "webp",
    mediaType: "image/webp",
    declaredTypes: ["", "image/webp"],
  },
  mp4: {
    kind: "mp4",
    mediaType: "video/mp4",
    declaredTypes: ["", "video/mp4", "application/octet-stream"],
  },
  mov: {
    kind: "quicktime",
    mediaType: "video/quicktime",
    declaredTypes: ["", "video/quicktime", "application/octet-stream"],
  },
  pdf: {
    kind: "pdf",
    mediaType: "application/pdf",
    declaredTypes: ["", "application/pdf"],
  },
  txt: {
    kind: "text",
    mediaType: "text/plain",
    declaredTypes: ["", "text/plain", "application/octet-stream"],
  },
  log: {
    kind: "text",
    mediaType: "text/plain",
    declaredTypes: [
      "",
      "text/plain",
      "text/log",
      "application/octet-stream",
    ],
  },
  csv: {
    kind: "csv",
    mediaType: "text/csv",
    declaredTypes: [
      "",
      "text/csv",
      "text/plain",
      "application/csv",
      "application/vnd.ms-excel",
    ],
  },
  xlsx: {
    kind: "xlsx",
    mediaType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    declaredTypes: [
      "",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/zip",
      "application/octet-stream",
    ],
  },
  xls: {
    kind: "xls",
    mediaType: "application/vnd.ms-excel",
    declaredTypes: [
      "",
      "application/vnd.ms-excel",
      "application/octet-stream",
    ],
  },
};

export async function validateAttachmentFile(
  file: File
): Promise<ValidatedAttachmentFile> {
  const fileName = file.name;
  if (
    fileName !== fileName.trim() ||
    fileName.length < 3 ||
    fileName.length > MAX_ATTACHMENT_FILE_NAME_LENGTH ||
    /[\\/\u0000-\u001f\u007f]/.test(fileName) ||
    fileName.includes("..")
  ) {
    throw new AttachmentValidationError(
      "File name must be 3–255 safe characters without paths or control characters"
    );
  }

  if (file.size < 1 || file.size > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentValidationError(
      "File size must be between 1 byte and 50MB"
    );
  }

  const extensionSeparator = fileName.lastIndexOf(".");
  if (extensionSeparator <= 0 || extensionSeparator === fileName.length - 1) {
    throw new AttachmentValidationError("File extension is required");
  }
  const extension = fileName.slice(extensionSeparator + 1).toLowerCase();
  const rule = RULES[extension];
  if (!rule) {
    throw new AttachmentValidationError("File extension is not allowed");
  }

  const declaredType = file.type.toLowerCase().trim();
  if (!rule.declaredTypes.includes(declaredType)) {
    throw new AttachmentValidationError(
      "Declared file type does not match the file extension"
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || !contentMatches(rule.kind, bytes)) {
    throw new AttachmentValidationError(
      "File content does not match the allowed file type"
    );
  }

  return { bytes, fileName, mediaType: rule.mediaType };
}

export function buildAttachmentStoragePath(args: {
  customerId: string;
  ticketId: string;
  fileName: string;
  environment?: string;
}) {
  const environment = (
    args.environment ||
    process.env.VERCEL_ENV ||
    process.env.NODE_ENV ||
    "local"
  )
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .slice(0, 32) || "local";
  const storageName = args.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `attachments/${environment}/${args.customerId}/${args.ticketId}/${randomUUID()}-${storageName}`;
}

function contentMatches(kind: AttachmentKind, bytes: Uint8Array) {
  switch (kind) {
    case "jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "png":
      return startsWith(bytes, [
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
    case "gif":
      return (
        ascii(bytes, 0, 6) === "GIF87a" ||
        ascii(bytes, 0, 6) === "GIF89a"
      );
    case "webp":
      return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
    case "mp4":
      return bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp";
    case "quicktime":
      return (
        bytes.length >= 12 &&
        ["ftyp", "moov", "mdat", "wide", "free"].includes(ascii(bytes, 4, 4))
      );
    case "pdf":
      return ascii(bytes, 0, 5) === "%PDF-";
    case "text":
    case "csv":
      return isUtf8Text(bytes);
    case "xlsx":
      return isMacroFreeWorkbook(bytes);
    case "xls":
      return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  }
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return (
    bytes.length >= signature.length &&
    signature.every((value, index) => bytes[index] === value)
  );
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  if (bytes.length < offset + length) return "";
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function isUtf8Text(bytes: Uint8Array) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  return bytes.every(
    (value) =>
      value >= 0x20 || value === 0x09 || value === 0x0a || value === 0x0d
  );
}

function isMacroFreeWorkbook(bytes: Uint8Array) {
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return false;
  const entries = zipLocalEntryNames(bytes);
  return (
    entries.includes("[Content_Types].xml") &&
    entries.some((entry) => entry.startsWith("xl/")) &&
    !entries.some((entry) => entry.toLowerCase().endsWith("vbaproject.bin"))
  );
}

function zipLocalEntryNames(bytes: Uint8Array) {
  const names: string[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: false });
  for (let offset = 0; offset + 30 <= bytes.length; offset += 1) {
    if (
      bytes[offset] !== 0x50 ||
      bytes[offset + 1] !== 0x4b ||
      bytes[offset + 2] !== 0x03 ||
      bytes[offset + 3] !== 0x04
    ) {
      continue;
    }
    const nameLength = bytes[offset + 26] | (bytes[offset + 27] << 8);
    const extraLength = bytes[offset + 28] | (bytes[offset + 29] << 8);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    if (nameLength < 1 || nameEnd + extraLength > bytes.length) continue;
    names.push(decoder.decode(bytes.subarray(nameStart, nameEnd)));
    offset = nameEnd + extraLength - 1;
  }
  return names;
}
