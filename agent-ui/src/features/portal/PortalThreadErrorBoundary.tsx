import { Component, type ErrorInfo, type ReactNode } from "react";

type PortalThreadErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode | ((actions: { retry: () => void }) => ReactNode);
  resetKey: string;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Automatic re-renders per reset key before the fallback stays; races usually settle by then. */
  autoRetryLimit?: number;
  autoRetryDelayMs?: number;
};

type PortalThreadErrorBoundaryState = {
  failed: boolean;
};

export class PortalThreadErrorBoundary extends Component<
  PortalThreadErrorBoundaryProps,
  PortalThreadErrorBoundaryState
> {
  state: PortalThreadErrorBoundaryState = { failed: false };

  private autoRetries = 0;

  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError(): PortalThreadErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
    const limit = this.props.autoRetryLimit ?? 0;
    if (this.autoRetries >= limit) return;
    this.autoRetries += 1;
    this.clearRetryTimer();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.setState({ failed: false });
    }, this.props.autoRetryDelayMs ?? 400);
  }

  componentDidUpdate(previousProps: PortalThreadErrorBoundaryProps): void {
    if (previousProps.resetKey === this.props.resetKey) return;
    this.autoRetries = 0;
    this.clearRetryTimer();
    if (this.state.failed) this.setState({ failed: false });
  }

  componentWillUnmount(): void {
    this.clearRetryTimer();
  }

  private clearRetryTimer(): void {
    if (this.retryTimer === undefined) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private retry = (): void => {
    this.clearRetryTimer();
    this.setState({ failed: false });
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const { fallback } = this.props;
    return typeof fallback === "function" ? fallback({ retry: this.retry }) : fallback;
  }
}
