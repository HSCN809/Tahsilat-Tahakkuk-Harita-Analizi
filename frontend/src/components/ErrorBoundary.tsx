import React from 'react';
import { AlertTriangle } from 'lucide-react';

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
        <main className="min-h-dvh bg-[#F7F5F0] text-[#1E242B] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-[#D9D4C9] border-t-2 border-t-[#9E2A2B] p-8 flex flex-col gap-4 text-center">
            <div className="p-3 bg-[#F9EDED] text-[#9E2A2B] border border-[#E8C5C5] rounded-[4px] mx-auto">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h1 className="text-lg font-bold text-[#1E242B]">Beklenmeyen Hata</h1>
            <p className="text-sm text-[#525A63]">
              Uygulamada bir sorun oluştu. Sayfayı yenilemeyi veya aşağıdaki düğmeye basmayı deneyin.
            </p>
            {this.state.error && (
              <pre
                role="region"
                aria-label="Hata detayı"
                tabIndex={0}
                className="text-xs text-[#9E2A2B] bg-[#FCFBF8] border border-[#D9D4C9] rounded-[2px] p-3 overflow-auto max-h-32 text-left"
              >
                <code>{this.state.error.message}</code>
              </pre>
            )}
            <button
              type="button"
              onClick={this.handleRetry}
              className="mt-2 px-4 py-2.5 bg-[#9E2A2B] hover:bg-[#822021] text-white text-sm font-semibold rounded-[4px] transition-colors duration-150 cursor-pointer"
            >
              Tekrar Dene
            </button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
