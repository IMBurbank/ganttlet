import React from 'react';

interface DataSafeErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  panelName?: string;
}

interface DataSafeErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary that keeps sync providers (TaskStoreProvider, UIStoreProvider)
 * mounted when a rendering error occurs. Inner boundaries can wrap individual
 * panels so one panel crash doesn't take down the others.
 */
export class DataSafeErrorBoundary extends React.Component<
  DataSafeErrorBoundaryProps,
  DataSafeErrorBoundaryState
> {
  constructor(props: DataSafeErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): DataSafeErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(
      `DataSafeErrorBoundary caught error${this.props.panelName ? ` in ${this.props.panelName}` : ''}:`,
      error,
      errorInfo
    );
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center p-8 gap-4 text-text-secondary">
          <p className="text-sm">
            {this.props.panelName
              ? `The ${this.props.panelName} encountered an error.`
              : 'Something went wrong.'}
          </p>
          <p className="text-xs text-text-muted">{this.state.error?.message}</p>
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 text-sm bg-surface-overlay hover:bg-surface-raised rounded border border-border-default transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
