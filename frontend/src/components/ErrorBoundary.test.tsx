import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ErrorBoundary } from "./ErrorBoundary";
import { isChunkLoadError } from "../lib/lazyRetry";

function Bomb({ error }: { error: Error }): never {
  throw error;
}

describe("ErrorBoundary", () => {
  it("contains a crash and recovers on retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Flaky() {
      const [broken, setBroken] = useState(true);
      return (
        <ErrorBoundary label="t" onReset={() => setBroken(false)}>
          {broken ? <Bomb error={new Error("boom")} /> : <p>recovered</p>}
        </ErrorBoundary>
      );
    }
    render(<Flaky />);
    expect(screen.getByRole("alert")).toHaveTextContent(/hit a problem/);
    await userEvent.setup().click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });

  it("asks for a reload when a deploy replaced the page's code", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb error={new TypeError("Failed to fetch dynamically imported module: /assets/HomePage-x.js")} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();
  });

  it("recognises chunk-load errors across browsers", () => {
    expect(isChunkLoadError(new Error("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
  });
});
