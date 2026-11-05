import { Component, type ReactNode } from "react";

/** Keeps one broken view (a font, a bad node) from blanking the whole studio. */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[brusshy] ${this.props.label} crashed:`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" data-ui>
        <div className="label">{this.props.label} hit an error</div>
        <p className="muted">{this.state.error.message}</p>
        <button className="btn small" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
