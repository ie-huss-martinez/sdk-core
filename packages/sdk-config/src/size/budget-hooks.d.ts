/**
 * Starts the record of a new import budget.
 *
 * @param {string} name
 * @returns {BudgetRecord}
 */
export function budgetRecord(name: string): BudgetRecord;
/**
 * The import budgets whose bundle size-limit built without their own
 * `modifyEsbuildConfig`.
 *
 * By count, not by whether the hook ever ran: a configuration can hold a
 * budget and a copy of it with another hook, and the two share one clause.
 *
 * @returns {string[]} Their names.
 */
export function budgetsWithoutTheirHook(): string[];
/**
 * What to print for budgets measured without their own hook.
 *
 * @param {readonly string[]} names
 * @returns {string}
 */
export function lostHookMessage(names: readonly string[]): string;
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
export function tracedImport(clause: string, record: BudgetRecord): TracedImport;
/**
 * An import clause that notes when size-limit builds its budget's bundle:
 * `{ a, b }`, as an object size-limit reads as text.
 */
export type TracedImport = {
    /**
     * The clause, as size-limit writes it
     * after `import`.
     */
    toString: () => string;
    /**
     * The clause as it was given, for a report
     * written as JSON.
     */
    toJSON: () => string;
    /**
     *   As a string's `replace`.
     */
    replace: (pattern: string | RegExp, replacement: string) => string;
};
export type BudgetRecord = {
    /**
     * The budget's name.
     */
    name: string;
    /**
     * How many times size-limit built a bundle from
     * this budget's import clause.
     */
    bundled: number;
    /**
     * How many times the budget's own
     * `modifyEsbuildConfig` ran. One per bundle, when nothing replaced it.
     */
    configured: number;
};
