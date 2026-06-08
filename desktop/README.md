# OPC Desktop

Electron shell for the bundled OPC CLI.

## Runtime boundaries

- `electron/main.cjs`: Electron lifecycle, IPC, provider bridge startup.
- `electron/cliRunner.cjs`: launches `package/cli.js` in `stream-json` mode.
- `electron/providerBridge.cjs`: local Anthropic-compatible endpoint used by the CLI.
- `electron/providerConfig.cjs`: reads runtime provider profiles from Application Support.
- `electron/memoryStore.cjs`: durable memory injected through `--append-system-prompt`.
- `renderer/`: chat UI, model selector, diagnostics, logs and prompt context.

## Local workflow

```sh
npm --prefix desktop test
./script/build_and_run.sh --verify
```

The installed app is `/Applications/OPC.app`.

Generated artifacts are intentionally ignored:

- `desktop/node_modules/`
- `desktop/dist/`

The icon assets under `desktop/build/` are source assets and should stay versioned.
