import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";

import { chooseUsagePing } from "../actions";
import { AboutSection, type UsagePingView } from "./about-section";
import { checkUpdates, updateSettings } from "./actions";

vi.mock("./actions", () => ({ checkUpdates: vi.fn(), updateSettings: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("../actions", () => ({ chooseUsagePing: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));

const updates = { daily: true, available: null };
const ping: UsagePingView = { host: "telemetry.example.com", choice: "on", source: "app", id: "6f1c0e5a-9b1d-4c3e-8f2a-1d2e3f4a5b6c", production: true };
const release = { version: "b".repeat(40), url: `https://github.com/BenVae/dossier/compare/${"a".repeat(40)}...${"b".repeat(40)}` };
const facts = [
  { label: "Version", value: "0.1.0" },
  { label: "Database", value: "PostgreSQL · 9.0 MB" },
];

beforeEach(() => vi.clearAllMocks());

describe("About (E10-9)", () => {
  it("lists the install's facts", () => {
    render(<AboutSection facts={facts} usagePing={ping} updates={updates} />);
    expect(screen.getByRole("heading", { name: "About this install" })).toBeInTheDocument();
    expect(screen.getByText("Free and open source. No accounts, no subscriptions.")).toBeInTheDocument();
    expect(screen.getAllByRole("definition").map((value) => value.textContent)).toEqual(["0.1.0", "PostgreSQL · 9.0 MB"]);
    expect(screen.getByText("PostgreSQL · 9.0 MB")).toHaveClass("font-mono");
    expect(checkUpdates).not.toHaveBeenCalled();
  });

  it("says what the usage ping sends, with the install ID, and switches it off (#172)", async () => {
    const user = userEvent.setup();
    render(<AboutSection facts={facts} usagePing={ping} updates={updates} />);
    const toggle = screen.getByRole("switch", { name: "Send the daily usage ping" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAccessibleDescription(
      "On. Once on each day Dossier is used, the server sends telemetry.example.com this install's ID (6f1c0e5a-9b1d-4c3e-8f2a-1d2e3f4a5b6c) and the version number. Nothing else.",
    );
    await user.click(toggle);
    expect(chooseUsagePing).toHaveBeenCalledWith({ send: false });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAccessibleDescription("Off. Nothing is sent, and this install's ID is forgotten.");
    await user.click(toggle);
    expect(chooseUsagePing).toHaveBeenLastCalledWith({ send: true });
    expect(screen.getByText(/only goes once you agree/)).toHaveTextContent("send the ID to dossier.app@pm.me");
  });

  it("says when nobody has answered yet", () => {
    render(<AboutSection facts={facts} usagePing={{ ...ping, choice: null, source: null }} updates={updates} />);
    expect(screen.getByRole("switch", { name: "Send the daily usage ping" })).toHaveAccessibleDescription("Not answered yet, so nothing is sent.");
  });

  it("leaves the switch to DOSSIER_TELEMETRY while it's set, and off in development", () => {
    const { unmount } = render(<AboutSection facts={facts} usagePing={{ ...ping, choice: "off", source: "env", id: null }} updates={updates} />);
    const toggle = screen.getByRole("switch", { name: "Send the daily usage ping" });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAccessibleDescription("Set with DOSSIER_TELEMETRY=off on the server, which decides while it's set. Change it there.");
    unmount();
    render(<AboutSection facts={facts} usagePing={{ ...ping, production: false }} updates={updates} />);
    expect(screen.getByRole("switch", { name: "Send the daily usage ping" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Send the daily usage ping" })).toHaveAccessibleDescription("Development servers never send it.");
  });

  it("checks for updates daily unless switched off", async () => {
    const user = userEvent.setup();
    render(<AboutSection facts={facts} usagePing={ping} updates={updates} />);
    const toggle = screen.getByRole("switch", { name: "Check for updates daily" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAccessibleDescription(/asks GitHub for the latest commit on BenVae\/dossier's main branch, and the sidebar says when it's newer than this install/);
    await user.click(toggle);
    expect(updateSettings).toHaveBeenCalledWith({ updateCheck: false });
    expect(toggle).toHaveAccessibleDescription("Off. Dossier only checks when you press Check for updates.");
  });

  it("switches back when the change isn't saved", async () => {
    const user = userEvent.setup();
    vi.mocked(updateSettings).mockResolvedValueOnce({ ok: false, error: "You seem to be offline." });
    render(<AboutSection facts={facts} usagePing={ping} updates={updates} />);
    await user.click(screen.getByRole("switch", { name: "Check for updates daily" }));
    expect(toast).toHaveBeenCalledWith("You seem to be offline.");
    expect(screen.getByRole("switch", { name: "Check for updates daily" })).toHaveAttribute("aria-checked", "true");
  });

  it("shows a newer version a check already found, with how to update", () => {
    render(<AboutSection facts={facts} usagePing={ping} updates={{ daily: true, available: release }} />);
    expect(screen.getByRole("status")).toHaveTextContent("A newer version of Ben's Dossier is available.");
    expect(screen.getByRole("status")).toHaveTextContent(
      "To update, run the setup command again in PowerShell:irm https://raw.githubusercontent.com/BenVae/dossier/main/scripts/install-windows.ps1 | iex",
    );
    expect(screen.getByRole("link", { name: "See what's new (opens in a new tab)" })).toHaveAttribute("href", release.url);
    expect(checkUpdates).not.toHaveBeenCalled();
  });

  it("checks for updates when asked", async () => {
    const user = userEvent.setup();
    vi.mocked(checkUpdates).mockResolvedValueOnce({ ok: true, data: { status: "latest" } });
    render(<AboutSection facts={facts} usagePing={ping} updates={updates} />);
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(screen.getByRole("status")).toHaveTextContent("You're on the latest version.");
  });

  it("links a newer version", async () => {
    const user = userEvent.setup();
    vi.mocked(checkUpdates).mockResolvedValueOnce({ ok: true, data: { status: "newer", ...release } });
    render(<AboutSection facts={facts} usagePing={ping} updates={updates} />);
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(screen.getByRole("status")).toHaveTextContent("A newer version of Ben's Dossier is available.");
    expect(screen.getByRole("link", { name: "See what's new (opens in a new tab)" })).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("says when it couldn't check", async () => {
    const user = userEvent.setup();
    vi.mocked(checkUpdates).mockResolvedValueOnce({ ok: true, data: { status: "unknown" } });
    render(<AboutSection facts={facts} usagePing={ping} updates={updates} />);
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't check for updates right now.");
  });

  it("says when this install can't tell, not knowing its own commit", async () => {
    const user = userEvent.setup();
    vi.mocked(checkUpdates).mockResolvedValueOnce({ ok: true, data: { status: "untracked" } });
    render(<AboutSection facts={facts} usagePing={ping} updates={updates} />);
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(screen.getByRole("status")).toHaveTextContent("This install doesn't know which commit it was built from, so it can't tell whether there's a newer one.");
  });
});
