import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function readLatamTvPoster(slug: string): Promise<Buffer | null> {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) return null;
  try {
    return await readFile(resolve(process.cwd(), "assets", "latam-tv", "posters", `${slug}.png`));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
