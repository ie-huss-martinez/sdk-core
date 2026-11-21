// Notices an import budget that was measured without importBudget's own
// esbuild settings (sdk-core ADR 0056). Internal to the size tools: it isn't
// part of the package's API.
//
// A configuration that writes `{ ...importBudget(…), modifyEsbuildConfig }`
// replaces the budget's hook rather than adding to it. The bundle is then
// built as a script, without the production define, with the package's
// tsconfig.json, and with every unused name still counted, and nothing in
// the number says so.

/**
 * @typedef {object} BudgetRecord
 * @property {string} name The budget's name.
 * @property {number} bundled How many times size-limit built a bundle from
 *   this budget's import clause.
 * @property {number} configured How many times the budget's own
 *   `modifyEsbuildConfig` ran. One per bundle, when nothing replaced it.
 */

/** Every import budget this process made. */
/** @type {BudgetRecord[]} */
const BUDGETS = [];

let watching = false;

/**
 * Starts the record of a new import budget.
 *
 * @param {string} name
 * @returns {BudgetRecord}
 */
export function budgetRecord(name) {
  const record = { name, bundled: 0, configured: 0 };
  BUDGETS.push(record);
  return record;
}

/**
 * The import budgets whose bundle size-limit built without their own
 * `modifyEsbuildConfig`.
 *
 * By count, not by whether the hook ever ran: a configuration can hold a
 * budget and a copy of it with another hook, and the two share one clause.
 *
 * @returns {string[]} Their names.
 */
export function budgetsWithoutTheirHook() {
  return BUDGETS.filter(({ bundled, configured }) => bundled > configured).map(({ name }) => name);
}

/**
 * What to print for budgets measured without their own hook.
 *
 * @param {readonly string[]} names
 * @returns {string}
 */
export function lostHookMessage(names) {
  return [
    `${names.length === 1 ? "An import budget was" : `${names.length} import budgets were`} measured without importBudget's own esbuild settings (sdk-core ADR 0056): ${names.join(", ")}.`,
    "  A configuration that writes { ...importBudget(…), modifyEsbuildConfig } replaces them.",
    "  Pass the function to importBudget instead, which runs it after its own: importBudget({ …, modifyEsbuildConfig }).",
    "",
  ].join("\n");
}

/**
 * Fails the process, as it ends, if a budget was measured without its hook.
 * size-limit has printed its results by then, as if all were well.
 */
function watchForLostHooks() {
  if (watching) {
    return;
  }
  watching = true;
  process.once("exit", () => {
    const names = budgetsWithoutTheirHook();
    if (names.length > 0) {
      process.stderr.write(`\n${lostHookMessage(names)}`);
      process.exitCode = 1;
    }
  });
}

/**
 * An import clause that notes when size-limit builds its budget's bundle:
 * `{ a, b }`, as an object size-limit reads as text.
 *
 * @typedef {object} TracedImport
 * @property {() => string} toString The clause, as size-limit writes it
 *   after `import`.
 * @property {() => string} toJSON The clause as it was given, for a report
 *   written as JSON.
 * @property {(pattern: string | RegExp, replacement: string) => string} replace
 *   As a string's `replace`.
 */

/**
 * Makes an import clause that notes when size-limit builds its budget's
 * bundle. size-limit copies a check's fields into objects of its own, and
 * a configuration may copy them first, so nothing put on the check itself
 * is sure to survive. The clause does: it's passed on by reference until
 * size-limit writes the bundle's entry from it, which it does only for a
 * check it really runs. It reads the names out of the clause with
 * `replace` as it does, and that's the moment noted here.
 *
 * @param {string} clause
 * @param {BudgetRecord} record
 * @returns {TracedImport}
 */
export function tracedImport(clause, record) {
  // size-limit writes `import * as all` for the clause `*`, which it finds
  // by comparing with the text `"*"`. An object is never equal to that, so
  // the clause says what size-limit would have written, itself.
  const everything = clause.trim() === "*";
  return {
    toString: () => (everything ? "* as all" : clause),
    toJSON: () => clause,
    replace(pattern, replacement) {
      record.bundled += 1;
      watchForLostHooks();
      return everything ? "all" : clause.replace(pattern, replacement);
    },
  };
}
