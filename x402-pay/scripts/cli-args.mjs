// Shared CLI argument parsing for the x402-pay scripts.
//
// makeGetArg(args) returns a getArg(name) that reads the value following a flag.
// A missing value — or one that is actually the next flag (starts with `--`) — is
// treated as absent. No real flag value in these scripts starts with `--`, so this
// prevents e.g. `--refund --wallet 0x…` from silently using `--wallet` as the value.
export function makeGetArg(args) {
  return (name) => {
    const idx = args.indexOf(name);
    if (idx === -1) return null;
    const val = args[idx + 1];
    return val === undefined || val.startsWith('--') ? null : val;
  };
}
