import type { RigorLevel } from "./triage";

/** REQ-14: the Ledger powers optimise-mode (token accounting + counterfactuals). */
export interface LedgerEntry {
  readonly team: string;
  readonly artifact: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly rigor: RigorLevel;
  /** A saving Helm could have taken but did not — surfaced by optimise-mode. */
  readonly potentialSavings?: { readonly tokens: number; readonly reason: string };
}

export interface Ledger {
  readonly entries: readonly LedgerEntry[];
}

export const emptyLedger = (): Ledger => ({ entries: [] });

/** Immutable append. */
export const record = (ledger: Ledger, entry: LedgerEntry): Ledger => ({
  entries: [...ledger.entries, entry],
});

export const tokensOf = (entry: LedgerEntry): number => entry.inputTokens + entry.outputTokens;

export const totalTokens = (ledger: Ledger): number =>
  ledger.entries.reduce((sum, e) => sum + tokensOf(e), 0);

export interface SavingsReport {
  readonly spentTokens: number;
  readonly potentialTokens: number;
  readonly reasons: readonly string[];
}

/** "How much you could save" — counterfactual savings left on the table. */
export const savingsReport = (ledger: Ledger): SavingsReport => {
  const withSavings = ledger.entries.filter((e) => e.potentialSavings !== undefined);
  const potentialTokens = withSavings.reduce(
    (sum, e) => sum + (e.potentialSavings?.tokens ?? 0),
    0,
  );
  return {
    spentTokens: totalTokens(ledger),
    potentialTokens,
    reasons: withSavings.map((e) => e.potentialSavings!.reason),
  };
};
