# TETHER CLI

TETHER packages Codex and the browser adapter behind one command. The adapter
is part of this npm package: users do not install or start it separately.

## Install

From an authenticated terminal, install the private GitHub repository:

```powershell
npm install --global git+https://github.com/RaphaelBlaster/tether-suite.git
```

Then start TETHER from any project directory:

```powershell
tether
```

That command automatically:

1. starts the embedded adapter on `127.0.0.1:8766`;
2. waits until the adapter passes its TETHER health check;
3. starts the bundled Codex dependency with the TETHER Responses provider;
4. stops the adapter when Codex exits (unless an adapter was already running).

All normal Codex arguments are forwarded. For example:

```powershell
tether -C "C:\path\to\project"
```

## Load the extension once

Print the exact unpacked-extension directory installed with the CLI:

```powershell
tether extension-path
```

Open `brave://extensions` or `chrome://extensions`, enable Developer mode,
choose **Load unpacked**, and select that printed directory. After this
one-time step, running `tether` is enough.

Runtime state is stored in `%USERPROFILE%\.tether`; it is not written into the
user's project directory.

## Development checks

```powershell
npm install
npm test
npm run pack:check
```

The repository retains `adapter/`, `extension/`, and `codex-cli/` as source
snapshots, while the root npm package is the installable product.
