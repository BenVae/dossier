// Where Dossier's releases are published, for the update check and its
// notice (update-check.ts, the sidebar). Safe to use in the browser.

export const RELEASES_REPOSITORY = "AienTech/dossier";
/** The repository's page, for credits and support (the sidebar). */
export const REPOSITORY_URL = `https://github.com/${RELEASES_REPOSITORY}`;
/** How to update, in the wiki. */
export const UPGRADE_GUIDE_URL = `${REPOSITORY_URL}/wiki/Upgrading`;

// This fork publishes no releases. Its update check compares the commit an
// install was built from with the latest on the fork's main branch, and an
// install updates by running the setup script (scripts/install-windows.ps1)
// again. What's particular to the fork is here, to keep merges from
// AienTech/dossier simple.
export const UPDATES_REPOSITORY = "BenVae/dossier";
/** What the update notice calls the fork's Dossier. */
export const UPDATES_NAME = "Ben's Dossier";
/** The setup script, run again in PowerShell: it updates and keeps the data and password. */
export const UPDATE_COMMAND = `irm https://raw.githubusercontent.com/${UPDATES_REPOSITORY}/main/scripts/install-windows.ps1 | iex`;

/** A published release: its version, without the "v", and its page on GitHub. */
export type Release = { version: string; url: string };
