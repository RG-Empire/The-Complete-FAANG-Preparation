# ERC-7824 Yellow Session Starter

This tiny web app connects a wallet, authenticates with Yellow ClearNode (ERC-7824 / Nitrolite), and creates a simple application session.

## What it does

1. Connects your injected wallet (MetaMask or compatible).
2. Creates (or reuses) a session key stored in `localStorage`.
3. Sends an `auth_request`, signs the EIP-712 challenge, and verifies authentication.
4. Sends `create_app_session` with a basic single-participant definition.

## Run locally

From this folder:

```bash
python -m http.server 5173
```

Then open [http://localhost:5173](http://localhost:5173).

## Notes

- The app uses the public Yellow ClearNode websocket: `wss://clearnet.yellow.com/ws`.
- Allowance asset defaults to the first asset returned by `get_assets`.
- You can tweak the application ID, scope, allowance, or session duration in the UI.
