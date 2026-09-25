/**
 * Batch entry point (Section 9 / Appendix B):
 *
 *   npm run evaluate -- --input cases.json --output kits.json
 *
 * Reads GEMINI_API_KEY (and optional GEMINI_* tuning) from the environment or
 * from .env.local / .env. Needs no database. Private and loopback company URLs
 * are allowed here, because evaluation sites may be served from localhost.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { config } from "dotenv";
import { runBatch, type BatchOutput } from "@/batch/run-batch";
import { createLlmFromEnv } from "@/llm/from-env";

config({ path: [".env.local", ".env"], quiet: true });

const log = (message: string) => process.stderr.write(`${message}\n`);

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { input: { type: "string", short: "i" }, output: { type: "string", short: "o" } },
    allowPositionals: false,
  });
  if (!values.input || !values.output) {
    log("Usage: npm run evaluate -- --input <cases.json> --output <kits.json>");
    return 2;
  }
  if (!process.env.GEMINI_API_KEY) {
    log("GEMINI_API_KEY is not set. Put it in the environment or in .env (see .env.example).");
    return 2;
  }

  const inputPath = path.resolve(values.input);
  const outputPath = path.resolve(values.output);
  let cases: unknown;
  try {
    cases = JSON.parse(await readFile(inputPath, "utf8"));
  } catch (err) {
    log(`Could not read ${inputPath}: ${(err as Error).message}`);
    return 2;
  }
  if (!Array.isArray(cases)) {
    log(`${inputPath} must contain a JSON array of cases.`);
    return 2;
  }

  const started = Date.now();
  const seconds = (ms: number) => `${(ms / 1000).toFixed(0)}s`;
  // Written after every case, so a run that is interrupted still leaves the finished kits on disk.
  const save = (output: BatchOutput) => writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  let pendingSave: Promise<void> = Promise.resolve();

  const output = await runBatch(
    cases,
    { llm: createLlmFromEnv(), urlPolicy: { allowPrivate: true } },
    (event) => {
      if (event.type === "case-start") log(`[${event.index + 1}/${event.total}] ${event.id}`);
      if (event.type === "step") log(`    ${event.step.label}…`);
      if (event.type === "case-end") {
        const { entry } = event;
        const detail =
          entry.status === "ok"
            ? `${entry.kit.role.requirements.length} requirements, ${entry.kit.questions.length} questions, ${entry.kit.coverage.uncovered_requirement_ids.length} uncovered`
            : `${entry.error.code}: ${entry.error.message}`;
        log(`    → ${entry.status} in ${seconds(event.ms)}${event.reused ? " (identical to an earlier case; kit reused)" : ""} — ${detail}`);
      }
    },
    (partial) => {
      pendingSave = pendingSave.then(() => save(partial));
    },
  );
  await pendingSave;
  await save(output);

  const ok = output.kits.filter((k) => k.status === "ok").length;
  log(`\nDone in ${seconds(Date.now() - started)}: ${ok} ok, ${output.kits.length - ok} failed. Wrote ${outputPath}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    log(`Unexpected error: ${(err as Error).stack ?? err}`);
    process.exit(1);
  },
);
