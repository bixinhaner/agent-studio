import type { ChatClusterView } from "./cluster.js";
import { inFlightForwardCount } from "./forwarding.js";

export type ChatRetirementPhase = "active" | "retiring" | "exiting";

/**
 * A blue-green chat slot retires when the deploy writes its slot drain file
 * while a peer is ready to take over. Retiring keeps every in-flight run on
 * this release, stops taking new work, and exits once idle so PM2 leaves the
 * slot stopped. Runs still active after the limit are interrupted with a
 * "system update" result the user can retry.
 *
 * Without a ready peer a drain file keeps the single-instance behavior: new
 * work is rejected and the process never exits by itself.
 */
export class ChatRetirementController {
  private phase: ChatRetirementPhase = "active";
  private retiringSince?: number;
  private drainReason?: string;
  private peerReady = false;
  private idleChecks = 0;
  private peerLostChecks = 0;
  private timer?: NodeJS.Timeout;
  private polling?: Promise<void>;

  constructor(
    private readonly options: {
      cluster: ChatClusterView;
      readDrainReason(): Promise<string | undefined>;
      busyCount(): number;
      retireMaxMs: number;
      onRetireStart(): void | Promise<void>;
      onRetireCancel(): void | Promise<void>;
      /** Runs on every poll while retiring, e.g. to hand idle thread state to the peer. */
      onRetiringPoll?(): void | Promise<void>;
      exit(input: { interruptRemaining: boolean; reason: string }): Promise<void>;
      pollMs?: number;
      now?: () => number;
      logger?: Pick<Console, "info" | "warn">;
    }
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), this.options.pollMs ?? 2000);
    this.timer.unref();
    void this.poll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Forward new work to the peer instead of handling or rejecting it here. */
  isRetiring(): boolean {
    return this.phase !== "active";
  }

  /** Readiness for Caddy: a retiring slot stops receiving traffic; a lone slot keeps it even while drained. */
  isReady(): boolean {
    return this.phase === "active";
  }

  /** Drain reason shown to users: only when no peer can take the work. */
  userFacingDrainReason(): string | undefined {
    return this.drainReason && !this.peerReady ? this.drainReason : undefined;
  }

  /** Any drain, including handover; background workers stop claiming new work. */
  claimBlockReason(): string | undefined {
    return this.drainReason;
  }

  snapshot() {
    const now = (this.options.now ?? Date.now)();
    return {
      phase: this.phase,
      retiring_since: this.retiringSince ? new Date(this.retiringSince).toISOString() : undefined,
      retire_deadline: this.retiringSince ? new Date(this.retiringSince + this.options.retireMaxMs).toISOString() : undefined,
      retiring_for_ms: this.retiringSince ? Math.max(0, now - this.retiringSince) : undefined
    };
  }

  /** Evaluates the drain state now; concurrent callers share the in-flight evaluation. */
  poll(): Promise<void> {
    if (this.phase === "exiting") return Promise.resolve();
    if (!this.polling) {
      this.polling = this.evaluate()
        .catch((error) => {
          this.options.logger?.warn("chat retirement poll failed", error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          this.polling = undefined;
        });
    }
    return this.polling;
  }

  private async evaluate(): Promise<void> {
    const now = (this.options.now ?? Date.now)();
    this.drainReason = await this.options.readDrainReason();
    this.peerReady = this.drainReason ? Boolean(await this.options.cluster.readyPeer(0)) : false;

    if (!this.drainReason) {
      // The deploy aborted the switch; resume serving.
      if (this.phase === "retiring") await this.cancelRetirement("drain file removed");
      return;
    }
    if (this.phase === "active") {
      if (!this.peerReady) return;
      this.phase = "retiring";
      this.retiringSince = now;
      this.idleChecks = 0;
      this.peerLostChecks = 0;
      this.options.logger?.info("chat instance retiring; handing new work to peer");
      await this.options.onRetireStart();
    }

    if (!this.peerReady) {
      // The new slot went away after the switch: take traffic back instead of
      // leaving Caddy without a healthy upstream. Require a few polls so a
      // slow status response does not flap the handover.
      this.peerLostChecks += 1;
      if (this.peerLostChecks >= 3) await this.cancelRetirement("peer is no longer ready");
      return;
    }
    this.peerLostChecks = 0;

    try {
      await this.options.onRetiringPoll?.();
    } catch (error) {
      this.options.logger?.warn("chat retirement poll hook failed", error instanceof Error ? error.message : String(error));
    }

    const busy = this.options.busyCount() + inFlightForwardCount();
    this.idleChecks = busy === 0 ? this.idleChecks + 1 : 0;
    // Two consecutive idle polls avoid exiting between a request's acceptance and its run registration.
    if (this.idleChecks >= 2) {
      this.phase = "exiting";
      await this.options.exit({ interruptRemaining: false, reason: "retired after finishing in-flight work" });
      return;
    }
    if (this.retiringSince !== undefined && now - this.retiringSince >= this.options.retireMaxMs) {
      this.phase = "exiting";
      this.options.logger?.warn("chat retirement limit reached; interrupting remaining work", { busy });
      await this.options.exit({ interruptRemaining: true, reason: "retirement limit reached" });
    }
  }

  private async cancelRetirement(reason: string): Promise<void> {
    this.phase = "active";
    this.retiringSince = undefined;
    this.idleChecks = 0;
    this.peerLostChecks = 0;
    this.options.logger?.warn("chat retirement cancelled", { reason });
    await this.options.onRetireCancel();
  }
}
