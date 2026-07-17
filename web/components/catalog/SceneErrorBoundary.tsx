"use client";

import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class SceneErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-paper">
          <div className="text-center space-y-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-quiet">
              the agent field needs webgl
            </p>
            <p className="font-serif text-sm italic text-ink-soft max-w-xs">
              Your browser or device doesn&rsquo;t support the 3D scene. The
              rest of Ligis remains available without it.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
