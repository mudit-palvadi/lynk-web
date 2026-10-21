import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = join(repoRoot, ".github", "workflows", "ci.yml");

const workflow = readFileSync(workflowPath, "utf8");

// The workflow is the only thing standing between a broken website and main,
// and a workflow fails silently: delete a step, add continue-on-error, or
// narrow the trigger to a branch nobody pushes to, and every pull request
// turns green without anything being tested.

test("the workflow exists", () => {
  assert.ok(workflow.length > 0, "the CI workflow is empty");
});

test("it runs on every push to main", () => {
  assert.match(workflow, /push:/);
  assert.match(workflow, /branches: \[main\]/);
});

test("it runs on every pull request", () => {
  assert.match(
    workflow,
    /pull_request:/,
    "without a pull_request trigger a change can reach main without ever being tested",
  );
});

test("it cancels a superseded run for the same ref", () => {
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /cancel-in-progress: true/);
});

test("no step is allowed to continue on error", () => {
  assert.doesNotMatch(
    workflow,
    /continue-on-error/,
    "a step with continue-on-error cannot fail the run, so the pipeline would report green while the check it performs is broken",
  );
});

test("the token is read-only", () => {
  assert.match(workflow, /permissions:/);
  assert.match(workflow, /contents: read/);
});

test("it runs the test suite", () => {
  assert.match(workflow, /node --test/);
});

test("it pins the node version", () => {
  assert.match(workflow, /node-version:/);
  assert.match(workflow, /'22'/);
});
