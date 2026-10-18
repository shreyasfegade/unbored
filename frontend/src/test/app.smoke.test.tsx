/**
 * Smoke tests for the two things that broke in production without anyone
 * noticing: the pick never rendered, and route changes left the previous page
 * mounted. Both were caused by content being gated on animations that never
 * finished, so these assert the *outcome* (content is on screen) rather than
 * any animation detail.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { servePack } from "./servePack";

async function renderApp() {
  localStorage.setItem(
    "unbored-taste",
    JSON.stringify({ state: { hasCompletedOnboarding: true, favouriteIds: ["tmdb_27205"] }, version: 0 }),
  );
  const { default: App } = await import("../App");
  return render(<App />);
}

beforeEach(() => {
  vi.resetModules();
  servePack();
});

describe("the pick flow", () => {
  it("shows the recommended title after choosing a mood and a time", async () => {
    const user = userEvent.setup();
    await renderApp();

    // HomePage is code-split, so give the chunk time to resolve. Mood and time
    // are radios, not buttons.
    const wait = { timeout: 8000 };
    await user.click(await screen.findByRole("radio", { name: /thrilled/i }, wait));
    await user.click(await screen.findByRole("radio", { name: /90\+ min/i }, wait));
    await user.click(await screen.findByRole("button", { name: /find my pick/i }, wait));

    // The reveal is staged over a couple of seconds; what matters is that it
    // arrives at all, which is exactly what regressed. The engine is the real
    // one, running on the real pack, so read the pick it chose.
    const { useRecommendationStore } = await import("../stores/recommendationStore");
    await waitFor(() => expect(useRecommendationStore.getState().primary).not.toBeNull(), { timeout: 10000 });
    const title = useRecommendationStore.getState().primary!.media.title;
    await waitFor(() => expect(screen.getAllByText(title).length).toBeGreaterThan(0), { timeout: 10000 });
    expect(screen.queryByText(/How are you feeling/i)).not.toBeInTheDocument();
  }, 20000);
});

describe("route changes", () => {
  it("leaves exactly one page mounted", async () => {
    const user = userEvent.setup();
    await renderApp();

    expect(await screen.findByText(/How are you feeling/i, {}, { timeout: 8000 })).toBeInTheDocument();

    // Via the bottom nav, which is now how every mode is reached.
    await user.click(screen.getByRole("link", { name: /^library$/i }));

    // Match the page heading, not the header link that shares its label.
    await screen.findByRole("heading", { name: /your library/i }, { timeout: 8000 });
    // The old page must be gone, not merely faded out and left in the tree.
    expect(screen.queryByText(/How are you feeling/i)).not.toBeInTheDocument();
  }, 20000);
});
