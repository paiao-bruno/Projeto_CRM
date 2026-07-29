import sanitizeHtml from "sanitize-html";

export function sanitizePlainText(value: string) {
  return sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: "discard",
  }).trim();
}

export function sanitizeUnknownValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizePlainText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUnknownValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        sanitizeUnknownValue(nested),
      ]),
    );
  }

  return value;
}
