import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('ErrorBoundary yakaladı:', error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-slate-900/60 border border-rose-500/20 rounded-2xl p-8 flex flex-col gap-4 text-center">
            <div className="p-3 bg-rose-500/10 text-rose-400 rounded-xl mx-auto">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h1 className="text-lg font-bold text-slate-100">Beklenmeyen Hata</h1>
            <p className="text-sm text-slate-400">
              Uygulamada bir sorun oluştu. Sayfayı yenilemeyi veya aşağıdaki butona basmayı deneyin.
            </p>
            {this.state.error && (
              <pre className="text-xs text-rose-400/70 bg-slate-950/60 rounded-lg p-3 overflow-auto max-h-32 text-left">
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={this.handleRetry}
              className="mt-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer"
            >
              Tekrar Dene
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
