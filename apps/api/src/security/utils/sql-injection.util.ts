const SQL_INJECTION_PATTERNS = [
  /(\bunion\b[\s\S]{0,40}\bselect\b)/i,
  /(\bdrop\b\s+\btable\b)/i,
  /(\binsert\b\s+\binto\b)/i,
  /(\bdelete\b\s+\bfrom\b)/i,
  /(\bupdate\b[\s\S]{0,40}\bset\b)/i,
  /(\bor\b\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?)/i,
  /(;[\s\S]*--)/,
  /(\/\*[\s\S]*\*\/)/,
];

export function containsSqlInjectionPattern(value: string) {
  return SQL_INJECTION_PATTERNS.some((pattern) => pattern.test(value));
}

export function assertNoSqlInjection(value: unknown, path = "request") {
  if (typeof value === "string") {
    if (containsSqlInjectionPattern(value)) {
      throw new Error(`Possível SQL injection detectado em ${path}.`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSqlInjection(item, `${path}[${index}]`));
    return;
  }

  if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, nested]) =>
      assertNoSqlInjection(nested, `${path}.${key}`),
    );
  }
}
