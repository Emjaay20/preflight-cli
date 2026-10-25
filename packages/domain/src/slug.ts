export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (!slug) throw new Error("name must contain letters or numbers");
  return slug;
}

export function uniqueSlug(name: string, taken: Set<string>): string {
  const base = slugify(name);
  if (!taken.has(base)) return base;
  for (let i = 0; i < 20; i++) {
    const candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("could not allocate a unique slug");
}
