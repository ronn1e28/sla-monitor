import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cleanCsv } from "../supabase/functions/process-upload/clean.ts";

const dir = process.argv[2] ?? "sample-data";
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".csv"))
  .map((f) => join(dir, f));

for (const file of files) {
  const { rows, rejected, report } = cleanCsv(readFileSync(file, "utf8"));
  console.log(`\n=== ${file}`);
  console.log(report);

  const perService: Record<string, number> = {};
  for (const r of rows) perService[r.service_id] = (perService[r.service_id] ?? 0) + 1;
  console.log("rows per service:", perService);
  console.log("rejected sample:", rejected.slice(0, 3));
}