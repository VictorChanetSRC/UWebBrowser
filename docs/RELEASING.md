# Releasing UWebBrowser

## How the pipeline works

`.github/workflows/release.yml` runs on every push to `main` (except
doc-only changes: `*.md`, `docs/`, `brand/`, `LICENSE`) and **always ships a
release**. The version is resolved in this order:

1. **Manual bump** — if `version` in `src-tauri/tauri.conf.json` has no
   `v<version>` tag yet, that exact version is released.
2. **Commit message** — if the pushed commit message contains
   `release: X.Y.Z` (e.g. `git commit -m "new tab engine, release: 0.2.0"`),
   that version is used. Fails if the tag already exists.
3. **Auto patch bump** — otherwise CI bumps the patch version to the next
   free one (`0.1.0` → `0.1.1`).

For 2 and 3, CI updates `tauri.conf.json`, `package.json` and
`src-tauri/Cargo.toml`, commits `chore: release vX.Y.Z` back to `main`, and
builds from that commit — so the repo always matches what users run.
(`git pull` after a release to get the bump commit locally.) The bump
commit cannot retrigger the workflow: pushes made with the built-in
`GITHUB_TOKEN` never start new workflow runs.

The build itself: Windows NSIS installer, signed with Azure Trusted
Signing, updater artifact signed with the Tauri updater key, published as
GitHub Release `v<version>` together with `latest.json` (consumed by the
in-app auto-updater).

Note: if you ever protect the `main` branch, allow the default
`GITHUB_TOKEN` to push (or the auto-bump commit will be rejected).

## One-time setup

### 1. Updater signing key

The updater keypair is the **sole root of trust for auto-updates** — anyone
holding the private key can sign an update that every install silently accepts
(installs run in `passive` mode). Treat it accordingly:

- **Protect it with a password.** Generate with
  `npm run tauri signer generate -- -w <path-to-key>` and set a passphrase when
  prompted (avoid the passwordless key the project shipped with — rotate to a
  password-protected one when convenient; a rotation only affects *future*
  updates, existing installs keep validating against the embedded public key
  until they take an update signed by the new key, so plan the cutover).
- **Don't leave the raw `.key` unencrypted on disk.** Keep it in a secrets
  manager and pull it out only to configure CI.
- Back it up somewhere safe — **if you lose it, existing installs can never
  auto-update again** and users must manually reinstall.

The public key is embedded in `tauri.conf.json`. Add these GitHub secrets
(repo → Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Full contents of the `.key` file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The passphrase you set (leave unset only for a legacy passwordless key) |

### 2. Azure Trusted Signing (~$9.99/month)

Trusted Signing replaces buying an EV/OV certificate (~$300+/yr). The Basic
SKU is $9.99/month and includes 5,000 signatures/month.

**Eligibility for a Public Trust certificate:**
- **Organization**: needs 3+ years of verifiable business history
  (registration records, tax ID). Newer orgs are not eligible for public
  trust yet.
- **Individual**: individual identity validation is also offered (government
  ID verification). Availability has been rolling out gradually — check the
  current state in the Azure portal when you onboard.

**Setup steps (Azure portal):**

1. Create a **Trusted Signing account** resource (pick a region close to
   you, e.g. *West Europe* → endpoint `https://weu.codesigning.azure.net`).
   Choose the **Basic** SKU.
2. In the resource, complete **Identity validation** (this is the part that
   can take days — do it early). You'll need business registration details
   or personal ID depending on the validation type.
3. Once validated, create a **Certificate profile** of type
   **Public Trust**, linked to that identity.
4. Create a service principal for CI:
   - Microsoft Entra ID → **App registrations** → *New registration* (name
     it e.g. `uwebbrowser-ci`).
   - Copy the **Directory (tenant) ID** and **Application (client) ID**.
   - Under *Certificates & secrets*, create a **client secret**; copy its
     value immediately.
5. Back on the Trusted Signing account → **Access control (IAM)** → assign
   the role **Trusted Signing Certificate Profile Signer** to that app
   registration.

**Add these GitHub secrets:**

| Secret | Value |
| --- | --- |
| `AZURE_TENANT_ID` | Directory (tenant) ID |
| `AZURE_CLIENT_ID` | Application (client) ID |
| `AZURE_CLIENT_SECRET` | The client secret value |
| `AZURE_ENDPOINT` | Region endpoint, e.g. `https://weu.codesigning.azure.net` |
| `AZURE_CODE_SIGNING_NAME` | Name of the Trusted Signing account resource |
| `AZURE_CERT_PROFILE_NAME` | Name of the certificate profile |

Until the `AZURE_*` secrets exist, the workflow still runs and publishes
**unsigned** builds (it prints a warning). Add the secrets and re-run to
get signed builds — no workflow changes needed.

Signing happens through [`trusted-signing-cli`](https://github.com/Levminer/trusted-signing-cli),
injected in CI via a `--config` overlay so local `tauri build` never tries
to reach Azure.

## Auto-updates

- The app checks `https://github.com/VictorChanetSRC/UWebBrowser/releases/latest/download/latest.json`
  5 seconds after startup (`src/lib/updater.ts`), prompts the user, installs
  with NSIS *passive* mode, and offers a restart. Dev builds never check.
- Update packages are verified against the public key in `tauri.conf.json`
  before installing — GitHub compromise alone can't push a malicious update.
- **The repository (or at least its releases) must be publicly accessible**;
  release assets of a private repo return 404 without authentication, so
  auto-update would silently do nothing.

## Notes

- Only the NSIS `-setup.exe` is published (`--bundles nsis`). Add `msi` to
  the `args` in the workflow if you also want an MSI (note: MSI can't be
  auto-updated across downgrades and is generally the weaker updater target).
- Even signed, brand-new certificates start with little SmartScreen
  reputation; Trusted Signing certs generally clear SmartScreen quickly, but
  a few "unrecognized app" warnings early on are normal.
- CI never sees the raw certificate: Azure signs hashes remotely, and the
  short-lived (72h) certs Trusted Signing issues are rotated automatically.
