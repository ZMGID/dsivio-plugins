import test from "node:test";
import assert from "node:assert/strict";
import { BuildMachine } from "./machine.ts";
import type { ExecutionDefinition, Fact } from "./graph.ts";

const type = "test@1#Text";
function definition(): ExecutionDefinition {
  return { schema: "dsivio-video.definition/1", author: "author", run: "run", targets: ["final"], seeds: { source: { type, data: "hello" } }, forwarded: {}, reused: {}, modules: ["test@1"], steps: [
    { key: "a", producer: "test@1#copy", label: "a", inputs: { text: "source" }, results: { text: "a.text" }, resultTypes: { text: type } },
    { key: "b", producer: "test@1#need", label: "b", inputs: { text: "source" }, results: { text: "b.text" }, resultTypes: { text: type } },
    { key: "c", producer: "test@1#join", label: "c", inputs: { parts: ["a.text", "b.text"] }, results: { text: "c.text" }, resultTypes: { text: type } },
  ], outputs: { final: { record: "c.text", type } } };
}
const a: Fact = { kind: "produced", command: "produce:a", outputs: { text: { type, data: "a" } }, needs: {} };
const b: Fact = { kind: "produced", command: "produce:b", outputs: {}, needs: { text: { capability: "test/text", request: { text: "b" } } } };
const fulfil: Fact = { kind: "fulfilled", command: "fulfil:b.text", value: { type, data: "b" } };
const c: Fact = { kind: "produced", command: "produce:c", outputs: { text: { type, data: "ab" } }, needs: {} };

test("facts unlock independent commands, typed inputs, and replay deterministically", () => {
  const machine = new BuildMachine(definition());
  assert.deepEqual(machine.ready().map((command) => command.key), ["produce:a", "produce:b"]);
  assert.throws(() => machine.accept(c), { code: "MACHINE_INPUT_PENDING" });
  machine.accept(b);
  assert.deepEqual(machine.ready().map((command) => command.key), ["produce:a", "fulfil:b.text"]);
  machine.accept(fulfil);
  assert.deepEqual(machine.ready().map((command) => command.key), ["produce:a"]);
  machine.accept(a);
  assert.deepEqual(machine.inputsFor("c"), { parts: [{ type, data: "a" }, { type, data: "b" }] });
  machine.accept(c);
  assert.equal(machine.state, "complete");
  assert.deepEqual(machine.ready(), []);
  assert.deepEqual(machine.valueOf("c.text"), { type, data: "ab" });
  const replay = new BuildMachine(definition());
  for (const fact of [a, b, fulfil, c]) replay.accept(fact);
  assert.equal(replay.state, machine.state);
  assert.deepEqual(replay.valueOf("c.text"), machine.valueOf("c.text"));
});

test("facts enforce command kind, exact ports, exact types and single fulfil", () => {
  const machine = new BuildMachine(definition());
  assert.throws(() => machine.accept({ kind: "fulfilled", command: "produce:a", value: { type, data: "a" } }), { code: "MACHINE_FACT_KIND" });
  assert.throws(() => machine.accept({ kind: "produced", command: "produce:a", outputs: {}, needs: {} }), { code: "MACHINE_PORT_BINDING_MISMATCH" });
  assert.throws(() => machine.accept({ kind: "produced", command: "produce:a", outputs: { text: { type: "other@1#Text", data: "a" } }, needs: {} }), { code: "MACHINE_OUTPUT_TYPE_MISMATCH" });
  assert.throws(() => machine.accept({ kind: "fulfilled", command: "fulfil:missing.text", value: { type, data: "a" } }), { code: "MACHINE_UNKNOWN_COMMAND" });
  machine.accept(b);
  assert.throws(() => machine.accept({ kind: "fulfilled", command: "fulfil:b.text", value: { type: "other@1#Text", data: "a" } }), { code: "MACHINE_OUTPUT_TYPE_MISMATCH" });
  machine.accept(fulfil);
  assert.throws(() => machine.accept(fulfil), { code: "MACHINE_DUPLICATE_FACT" });
});

test("validation has no effect; failure stops new work but accepts an in-flight fulfil", () => {
  const machine = new BuildMachine(definition());
  machine.validate(a);
  assert.equal(machine.valueOf("a.text"), undefined);
  machine.accept(b);
  machine.accept({ kind: "failed", command: "produce:a", code: "TEST_FAILED", message: "failure" });
  assert.equal(machine.state, "failed");
  assert.deepEqual(machine.ready(), []);
  machine.accept(fulfil);
  assert.deepEqual(machine.valueOf("b.text"), { type, data: "b" });
  assert.equal(machine.state, "failed");
});
