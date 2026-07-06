import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Rendered instead of the children after a render error. Given a `reset`
   *  that clears the error so the subtree can try mounting again. */
  fallback?: (reset: () => void) => ReactNode;
};

type State = { error: Error | null };

/** Catches render-time throws in its subtree so one broken view or widget can't
 *  blank the whole browser. Without a boundary, a single exception unmounts the
 *  entire app — tabs, toolbar and all — leaving the user no way back. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Surface it for debugging without taking the UI down with it.
    console.error("UI error boundary caught:", error);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.reset);
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-[13px] text-ink-300">
          Something went wrong rendering this view.
        </p>
        <button
          onClick={this.reset}
          className="rounded-lg border border-ink-800 bg-ink-900 px-3 py-1.5 text-[12.5px] text-ink-200 transition-colors hover:bg-ink-800"
        >
          Try again
        </button>
      </div>
    );
  }
}
