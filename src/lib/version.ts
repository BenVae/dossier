import packageJson from "../../package.json";

/** The app version from package.json, shown in the sidebar and in Settings → About. */
export const appVersion: string = packageJson.version;

/** A full commit SHA, as GitHub gives it. */
export const isCommit = (value: string) => /^[0-9a-f]{40}$/.test(value);

/**
 * The commit this build was made from, for the update check: DOSSIER_COMMIT,
 * which the Dockerfile keeps from the setup script. Null when it's unknown,
 * as in development or an image built some other way.
 */
export const appCommit: string | null = isCommit(process.env.DOSSIER_COMMIT ?? "") ? process.env.DOSSIER_COMMIT! : null;
