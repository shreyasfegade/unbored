/** The Watch Together page against the in-memory room service and the real engine. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { servePack } from "../test/servePack";
import { setCatalogForTests } from "../engine/pack";
import { setReadyForTests } from "../engine/host";
import { RoomClient } from "./room";
import { memoryBackend } from "./transport";
import { setRoomBackendForTests } from "./useRoom";
import TogetherPage from "../pages/TogetherPage";

let backend: ReturnType<typeof memoryBackend>;

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/together/:code?" element={<TogetherPage />} />
        <Route path="/" element={<p>home</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setCatalogForTests(null);
  setReadyForTests(null);
  servePack();
  backend = memoryBackend();
  setRoomBackendForTests(backend);
});

afterEach(() => setRoomBackendForTests(undefined));

describe("Watch Together page", () => {
  it("opens a room, shows who's in it, and shares a pick", async () => {
    const user = userEvent.setup();
    renderAt("/together");
    await user.type(screen.getByLabelText("Your name"), "Ana");
    await user.click(screen.getByRole("button", { name: /start a room/i }));
    const code = (await screen.findByText(/^[A-HJ-NP-Z2-9]{4}$/)).textContent!;

    // A second person joins from another browser.
    const ben = new RoomClient(backend, code, { member_id: "ben", name: "Ben", favourite_ids: ["tmdb_27205"], joined_at: Date.now() + 1 }, () => {});
    await ben.start();
    await screen.findByText("Ben");
    expect(screen.getByText(/2 in the room/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /find something for all of us/i }));
    await waitFor(() => expect(ben.snapshot.pick).not.toBeNull(), { timeout: 10000 });
    expect(ben.snapshot.pick!.by).toBe("Ana");
  }, 20000);

  it("explains an expired code", async () => {
    renderAt("/together/ZZZZ");
    await userEvent.setup().click(screen.getByRole("button", { name: /join room/i }));
    expect(await screen.findByText(/that room has closed/i)).toBeInTheDocument();
  });

  it("says so when the room service isn't configured", async () => {
    setRoomBackendForTests(null);
    renderAt("/together");
    expect(screen.getByText(/isn.t set up on this copy/i)).toBeInTheDocument();
  });
});
