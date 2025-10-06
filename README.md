**Overview**

- Automated swap tool that cycles between WETH -> USDC and USDC -> WETH using quotes and transactions returned by a MetaMask Router-compatible quoting service. It supports multiple wallets, validates safety constraints, and logs each step with clear output.

**Key Features**

- Single-chain operation using `CHAIN_ID` for both source and destination.
- Multi-wallet support via `wallets.json` (private key per wallet).
- Safe router enforcement: executes trades only through `0x9dDA6Ef3D919c9bC8885D5560999A3640431e8e6`.
- Balance-driven logic: swap WETH->USDC when WETH ≥ min; swap USDC->WETH when USDC ≥ min.
- No automatic wrap/unwrap; WETH is used directly for swaps.
- Uses ethers v6 and axios.
- Modular functions for clarity and maintenance.

**How It Works**

- For each cycle and for each wallet:
  - Fetch balances of WETH and USDC (ETH shown for info only).
  - If WETH ≥ `ETH_MIN_SWAP`, perform a pair:
    - Swap WETH→USDC.
    - Wait a random delay in `[DELAY_SECONDS_MIN, DELAY_SECONDS_MAX]`.
    - Swap USDC→WETH.
  - Else if USDC ≥ `USDC_MIN_SWAP`, do a single USDC→WETH swap.
  - Each approval/trade is gas-estimated first; transactions wait for 2 confirmations.
  - The main loop repeats every ~60 seconds (per cycle).

The tool calls a hosted quote service and expects a response array similar to the provided sample. It picks the best quote by highest `destTokenAmount`, verifies the trade route matches the secure router, and sends the returned tx data as-is.

**Security Guarantees**

- Router address is strictly enforced and must equal `ROUTER_ADDRESS` (default: MetaMask Router on Base). Quotes pointing elsewhere are rejected.
- Router and token addresses are validated on startup to ensure they are real contracts on the configured chain.

**Requirements**

- Node.js 18+
- A working RPC endpoint for the specified chain (e.g., Base mainnet).
- Internet access to the hosted quote API.

**Installation**

- Copy `.env.example` to `.env` and fill in values.
- Copy `wallets.json.example` to `wallets.json` and fill with your wallets.
- Install dependencies:
  - `npm install`

**Environment Variables**

- `RPC_URL`: JSON-RPC endpoint for the chain.
- `CHAIN_ID`: Single chain ID used for both source and destination.
- `SLIPPAGE`: Slippage tolerance (e.g., `0.01` for 1%).
- `GAS_INCLUDED`: Whether to request gas considerations in quotes (`true`/`false`).
- `RESET_APPROVAL`: Whether to force reset approvals (`true`/`false`).
- `ROUTER_ADDRESS`: Must be `0x9dDA6Ef3D919c9bC8885D5560999A3640431e8e6` for safety.
- `USDC_ADDRESS`: USDC token address on the configured chain.
- `WETH_ADDRESS`: WETH token address on the configured chain.
- `USDC_MIN_SWAP`: Minimum USDC balance to trigger USDC→WETH.
- `ETH_MIN_SWAP`: Minimum amount for WETH→USDC action.
- `GAS_PRICE_MAX_GWEI` (optional): Cap for EIP-1559 `maxFeePerGas` and `maxPriorityFeePerGas`. If set, tx will not exceed this cap.
- `DELAY_SECONDS_MIN` / `DELAY_SECONDS_MAX`: Random per-pair delay window (seconds) between WETH→USDC and USDC→WETH.

Tokens on Base (example):

- `USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- `WETH_ADDRESS=0x4200000000000000000000000000000000000006`

**Wallets**

- `wallets.json` should contain an array of entries like:
  - `[{"address":"0x...","privateKey":"0x..."}]`
- A template is provided at `wallets.json.example`. Do NOT commit `wallets.json` — it is already in `.gitignore`.
- The tool verifies that each private key matches the configured address before performing any action.

**Run**

- `npm start`

The tool will:

- Validate router and token contracts on chain.
- Load wallets.
- Loop through each wallet every 60 seconds and apply the swap rules.

**Notes on ETH/WETH**

- The quote requests use the WETH address for ETH legs. The tool ensures WETH exists for ETH->USDC by wrapping ETH as needed, and unwraps any received WETH back to native ETH after USDC->ETH to complete the cycle in ETH.

**Logs**

- Logs include emoji markers for each step: approvals, trades, waits, and decisions.

**Git**

- A `.gitignore` is included. Initialize and commit:
  - `git init`
  - `git add .`
  - `git commit -m "init: automated ETH<->USDC swap tool"`

**Troubleshooting**

- No quotes: Ensure the quote API is reachable and healthy.
- Router safety: If a quote points to a different router address, it will be rejected.
- Insufficient gas: Ensure the wallet has enough native ETH for gas.
