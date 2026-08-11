import { Component, type ErrorInfo, type ReactNode } from "react";

type PortalThreadErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
  resetKey: string;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
};

type PortalThreadErrorBoundaryState = {
  failed: boolean;
};

export class PortalThreadErrorBoundary extends Component<
  PortalThreadErrorBoundaryProps,
  PortalThreadErrorBoundaryState
> {
  state: PortalThreadErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): PortalThreadErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
  }

  componentDidUpdate(previousProps: PortalThreadErrorBoundaryProps): void {
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
