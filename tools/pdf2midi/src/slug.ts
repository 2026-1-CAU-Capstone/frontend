import { createHash } from "node:crypto";
import path from "node:path";

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80);
}

export function buildSlug(absSourcePath: string, relFromInput: string): string {
  const base = path.basename(absSourcePath, path.extname(absSourcePath));
  const slug = slugify(base) || "score";
  const hash = createHash("sha1")
    .update(relFromInput)
    .digest("hex")
    .slice(0, 8);
  return `${slug}-${hash}`;
}
