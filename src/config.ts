/** REQ-12 / REQ-13 / REQ-14: run modes and dials. */
export type RunMode = "interactive" | "autonomous";

export interface HelmConfig {
  /** Interactive (human checkpoints) vs Autonomous (one artifact back). */
  readonly mode: RunMode;
  /** team-mode: multi-agent producer/critic gating vs single-agent pass. */
  readonly teamMode: boolean;
  /** optimise-mode: report counterfactual token savings. */
  readonly optimise: boolean;
}

export const defaultConfig = (): HelmConfig => ({
  mode: "interactive",
  teamMode: true,
  optimise: true,
});
