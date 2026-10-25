/** Browser acceptance uses the same actions, with explicit non-human lineage. */
export function automation() { return typeof navigator !== "undefined" && navigator.webdriver ? { automation: true } : {}; }
