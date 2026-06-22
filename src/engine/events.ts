/**
 * Live progress channel. The orchestrator emits `RunEvent`s at each step; the CLI
 * renders them (spinner + elapsed). Defaults to a no-op so the engine stays silent
 * when nobody is listening (tests, library use).
 */
export interface RunEvent {
  /** begin = a step started (spinner), end = it finished, info = a one-line note. */
  readonly kind: "begin" | "end" | "info";
  readonly label: string;
  readonly icon?: string;
  readonly status?: "ok" | "warn" | "error";
}

export type Reporter = (event: RunEvent) => void;

export const noopReporter: Reporter = () => {};
