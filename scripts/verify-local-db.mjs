// Runs every supabase/verification/*.sql matrix against the local Supabase
// database started by `supabase start`. Each matrix runs in a transaction and
// rolls back, so this never leaves data behind.
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = readFileSync(path.join(root, "supabase/config.toml"), "utf8");
const projectId = config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
if (!projectId) throw new Error("supabase/config.toml has no project_id");
const container = `supabase_db_${projectId}`;

const running = execFileSync("docker", ["ps", "--format", "{{.Names}}"], {
  encoding: "utf8",
}).split("\n");
if (!running.includes(container)) {
  console.error(`Local database ${container} is not running. Run \`supabase start\`.`);
  process.exit(1);
}

const dir = path.join(root, "supabase/verification");
const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
let passed = 0;
for (const file of files) {
  const result = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres"],
    { input: readFileSync(path.join(dir, file)), encoding: "utf8" }
  );
  const output = `${result.stdout}${result.stderr}`;
  const passes = output.match(/PASS: /g)?.length ?? 0;
  const failure = output.split("\n").find((line) => /ERROR|FAIL:/.test(line));
  if (result.status !== 0 || failure) {
    console.error(`FAIL ${file}: ${failure ?? `psql exited ${result.status}`}`);
    process.exit(1);
  }
  passed += passes;
  console.log(`PASS ${file} (${passes} assertions)`);
}
console.log(`Local database verification passed: ${passed} assertions.`);
