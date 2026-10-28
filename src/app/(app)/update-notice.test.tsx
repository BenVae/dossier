import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import { copyText } from "@/lib/copy-text";
import { UPDATE_COMMAND } from "@/lib/releases";
import { dismissUpdate } from "@/lib/update-actions";

import { SidebarFrame } from "./sidebar-frame";
import { UpdateNotice } from "./update-notice";

vi.mock("@/lib/update-actions", () => ({ dismissUpdate: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/copy-text", () => ({ copyText: vi.fn(async () => true) }));

const latest = "b".repeat(40);
const release = { version: latest, url: `https://github.com/BenVae/dossier/compare/${"a".repeat(40)}...${latest}` };
const TITLE = "A newer version of Ben's Dossier is out";
const renderNotice = () =>
  render(
    <aside>
      <UpdateNotice release={release} />
      <div>
        <button type="button">Sign out</button>
      </div>
    </aside>,
  );

beforeEach(() => vi.clearAllMocks());

describe("UpdateNotice", () => {
  it("says a newer version is out, with what's new and the setup command that updates", async () => {
    const user = userEvent.setup();
    renderNotice();
    const notice = screen.getByRole("region", { name: TITLE });
    expect(notice).toHaveTextContent("To update, run the setup command again in PowerShell. It keeps your data and password.");
    expect(notice).toHaveTextContent(UPDATE_COMMAND);
    expect(UPDATE_COMMAND).toBe("irm https://raw.githubusercontent.com/BenVae/dossier/main/scripts/install-windows.ps1 | iex");
    expect(screen.getByRole("link", { name: "What's new (opens in a new tab)" })).toHaveAttribute("href", release.url);
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(copyText).toHaveBeenCalledWith(UPDATE_COMMAND);
    expect(toast).toHaveBeenCalledWith("Copied the setup command.");
  });

  it("goes with Not now, until main moves on again, and focus moves on", async () => {
    const user = userEvent.setup();
    renderNotice();
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(dismissUpdate).toHaveBeenCalledWith({ version: latest });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveFocus();
  });

  it("comes back when that isn't saved", async () => {
    const user = userEvent.setup();
    vi.mocked(dismissUpdate).mockResolvedValueOnce({ ok: false, error: "You seem to be offline." });
    renderNotice();
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(toast).toHaveBeenCalledWith("You seem to be offline.");
    expect(screen.getByRole("region", { name: TITLE })).toBeInTheDocument();
  });

  it("is an icon with a dot in the collapsed sidebar, which opens it on the notice", async () => {
    const user = userEvent.setup();
    render(
      <SidebarFrame initialCollapsed brand={<span>Dossier</span>}>
        <UpdateNotice release={release} />
      </SidebarFrame>,
    );
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: TITLE }));
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: TITLE })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "What's new (opens in a new tab)" })).toHaveFocus();
    expect(document.cookie).toContain("dossier_sidebar=expanded");
    document.cookie = "dossier_sidebar=; max-age=0; path=/";
  });
});
