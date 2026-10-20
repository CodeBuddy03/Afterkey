/**
 * Minimal .env loader for standalone scripts (Next.js loads env files itself).
 * Order: .env.local then .env (existing process env always wins).
 */
import fs from "fs";
import path from "path";

export function loadEnv(cwd: string = process.cwd()): void {
  for (const file of [".env.local", ".env"]) {
    const p = path.join(cwd, file);
    try {
      const text = fs.readFileSync(p, "utf8");
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        if (key in process.env) continue;
        let value = line.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    } catch {
      /* file absent */
    }
  }
}
