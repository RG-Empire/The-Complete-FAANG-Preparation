import {
  createAuthRequestMessage,
  createAuthVerifyMessageFromChallenge,
  createAppSessionMessage,
  createEIP712AuthMessageSigner,
  createECDSAMessageSigner,
  createGetAssetsMessageV2,
  RPCProtocolVersion,
} from "https://esm.sh/@erc7824/nitrolite@0.5.3";
import {
  createWalletClient,
  custom,
  generatePrivateKey,
  privateKeyToAccount,
} from "https://esm.sh/viem@2.20.1";
import { mainnet } from "https://esm.sh/viem@2.20.1/chains";

const WS_URL = "wss://clearnet.yellow.com/ws";
const SESSION_KEY_STORAGE = "yellowSessionKey";

const connectWalletButton = document.getElementById("connectWallet");
const startSessionButton = document.getElementById("startSession");
const walletStatus = document.getElementById("walletStatus");
const sessionStatus = document.getElementById("sessionStatus");
const walletAddressInput = document.getElementById("walletAddress");
const sessionKeyAddressInput = document.getElementById("sessionKeyAddress");
const applicationIdInput = document.getElementById("applicationId");
const scopeInput = document.getElementById("scope");
const allowanceAssetInput = document.getElementById("allowanceAsset");
const allowanceAmountInput = document.getElementById("allowanceAmount");
const sessionMinutesInput = document.getElementById("sessionMinutes");
const logOutput = document.getElementById("log");

let walletClient;
let walletAddress;
let sessionKey;
let sessionSigner;
let authSigner;
let ws;

const log = (message) => {
  const time = new Date().toLocaleTimeString();
  logOutput.textContent = `[${time}] ${message}\n${logOutput.textContent}`;
};

const setStatus = (el, message) => {
  el.textContent = message;
};

const loadSessionKey = () => {
  const stored = localStorage.getItem(SESSION_KEY_STORAGE);
  if (stored) {
    sessionKey = JSON.parse(stored);
  } else {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    sessionKey = {
      privateKey,
      address: account.address,
    };
    localStorage.setItem(SESSION_KEY_STORAGE, JSON.stringify(sessionKey));
  }
  sessionKeyAddressInput.value = sessionKey.address;
  sessionSigner = createECDSAMessageSigner(sessionKey.privateKey);
};

const connectWallet = async () => {
  if (!window.ethereum) {
    log("No injected wallet found. Install MetaMask or a compatible wallet.");
    return;
  }

  walletClient = createWalletClient({
    chain: mainnet,
    transport: custom(window.ethereum),
  });

  const [address] = await walletClient.requestAddresses();
  walletAddress = address;
  walletAddressInput.value = address;
  setStatus(walletStatus, "Connected");
  log(`Wallet connected: ${address}`);

  loadSessionKey();
};

const connectWebSocket = () =>
  new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      resolve(ws);
      return;
    }

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      log("WebSocket connected to Yellow ClearNode.");
      resolve(ws);
      requestAssets();
    };

    ws.onerror = (error) => {
      log("WebSocket error. Check console for details.");
      reject(error);
    };

    ws.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      const response = message.res;
      if (!response) {
        log("Received non-response message.");
        return;
      }

      const [, method, params] = response;
      log(`Received ${method}.`);

      if (method === "auth_request" || method === "auth_challenge") {
        await verifyAuth(params.challengeMessage);
      }

      if (method === "auth_verify") {
        if (params.success) {
          setStatus(sessionStatus, "Authenticated");
          log("Authentication verified. Creating app session...");
          await createAppSession();
        } else {
          setStatus(sessionStatus, "Auth failed");
          log("Authentication failed.");
        }
      }

      if (method === "create_app_session") {
        setStatus(sessionStatus, `Session started: ${params.appSessionId}`);
        log(`App session created: ${params.appSessionId}`);
      }

      if (method === "get_assets" || method === "assets") {
        if (!allowanceAssetInput.value && params.assets?.length) {
          allowanceAssetInput.value = params.assets[0].symbol;
          log(`Defaulting allowance asset to ${params.assets[0].symbol}`);
        }
      }

      if (method === "error") {
        log(`Error: ${params.error}`);
        setStatus(sessionStatus, "Error");
      }
    };
  });

const requestAssets = async () => {
  const message = createGetAssetsMessageV2();
  ws.send(message);
};

const verifyAuth = async (challengeMessage) => {
  const verifyMessage = await createAuthVerifyMessageFromChallenge(
    authSigner,
    challengeMessage,
  );
  ws.send(verifyMessage);
  log("Sent auth verify message.");
};

const createAppSession = async () => {
  const applicationId = applicationIdInput.value.trim();
  const allowanceAsset = allowanceAssetInput.value.trim();
  const allowanceAmount = allowanceAmountInput.value.trim();

  const definition = {
    application: applicationId,
    protocol: RPCProtocolVersion.NitroRPC_0_4,
    participants: [walletAddress],
    weights: [1],
    quorum: 1,
    challenge: 60,
    nonce: 1,
  };

  const allocations = [
    {
      asset: allowanceAsset,
      amount: allowanceAmount || "0",
      participant: walletAddress,
    },
  ];

  const message = await createAppSessionMessage(sessionSigner, {
    definition,
    allocations,
  });
  ws.send(message);
  log("Sent create_app_session message.");
};

const startSession = async () => {
  if (!walletClient || !walletAddress) {
    log("Connect a wallet first.");
    return;
  }

  setStatus(sessionStatus, "Connecting...");
  await connectWebSocket();

  const applicationId = applicationIdInput.value.trim();
  const scope = scopeInput.value.trim();
  const allowanceAsset = allowanceAssetInput.value.trim();
  const allowanceAmount = allowanceAmountInput.value.trim();
  const minutes = Number(sessionMinutesInput.value || 60);
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + minutes * 60);

  const allowances = [
    {
      asset: allowanceAsset,
      amount: allowanceAmount || "0",
    },
  ];

  authSigner = createEIP712AuthMessageSigner(
    walletClient,
    {
      scope,
      session_key: sessionKey.address,
      expires_at: expiresAt,
      allowances,
    },
    { name: "Nitrolite" },
  );

  const authRequest = await createAuthRequestMessage({
    address: walletAddress,
    session_key: sessionKey.address,
    application: applicationId,
    allowances,
    expires_at: expiresAt,
    scope,
  });

  ws.send(authRequest);
  setStatus(sessionStatus, "Auth request sent");
  log("Sent auth_request message.");
};

connectWalletButton.addEventListener("click", () => {
  connectWallet().catch((error) => {
    log(`Wallet connection failed: ${error.message}`);
  });
});

startSessionButton.addEventListener("click", () => {
  startSession().catch((error) => {
    log(`Session start failed: ${error.message}`);
    setStatus(sessionStatus, "Error");
  });
});
