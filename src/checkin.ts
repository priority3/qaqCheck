const BASE_URL = process.env.BASE_URL ?? "https://sign.qaq.al";
const POW_WASM_URL = process.env.POW_WASM_URL ?? `${BASE_URL}/wasm/pow.wasm`;
const TIER = Number(process.env.TIER ?? "4");
const HPS_OVERRIDE = process.env.HPS;
const COOKIE = process.env.COOKIE;
const MODE = (process.env.MODE ?? "challenge-only").toLowerCase();

const BENCH_ROUNDS = Number(process.env.BENCH_ROUNDS ?? "3");
const BENCH_DURATION_MS = Number(process.env.BENCH_DURATION_MS ?? "1200");
const MAX_POW_SECONDS = Number(process.env.MAX_POW_SECONDS ?? "300");
const MIN_SUBMIT_DELAY_MS = Number(process.env.MIN_SUBMIT_DELAY_MS ?? "60000");
const PUSHPLUS_TOKEN = process.env.PUSHPLUS_TOKEN;

const baseHeaders: Record<string, string> = {
  "sec-ch-ua-platform": '"macOS"',
  Referer: `${BASE_URL}/app`,
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
  "sec-ch-ua": '"Not(A:Brand";v="8", "Chromium";v="144"',
  "sec-ch-ua-mobile": "?0",
  Accept: "application/json"
};

if (COOKIE) {
  baseHeaders.Cookie = COOKIE;
}

type FetchResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  text: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function pushplus(title: string, content: string): Promise<void> {
  if (!PUSHPLUS_TOKEN) return;
  try {
    const res = await fetch("http://www.pushplus.plus/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: PUSHPLUS_TOKEN, title, content, template: "html" })
    });
    const data = await res.json() as { code?: number; msg?: string };
    if (data.code === 200) {
      console.log("[pushplus] notification sent");
    } else {
      console.warn(`[pushplus] failed: ${data.msg}`);
    }
  } catch (e) {
    console.warn(`[pushplus] error: ${e instanceof Error ? e.message : e}`);
  }
}

async function fetchJson<T>(
  path: string,
  options: RequestInit = {}
): Promise<FetchResult<T>> {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const headers = { ...baseHeaders, ...(options.headers || {}) } as Record<
    string,
    string
  >;

  const response = await fetch(url, { ...options, headers });
  const text = await response.text();
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }

  return { ok: response.ok, status: response.status, data, text };
}

function normalizeHps(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function medianNumber(values: number[]) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function bytesToHex(bytes: Uint8Array) {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

type PowWasm = {
  memory: WebAssembly.Memory;
  alloc: (len: number) => number;
  dealloc: (ptr: number, len: number) => void;
  hash_with_nonce: (
    ptr: number,
    len: number,
    nonce: bigint,
    outPtr: number
  ) => number;
};

let wasm: PowWasm | null = null;

async function initWasm() {
  if (wasm) return wasm;
  const res = await fetch(POW_WASM_URL, { headers: baseHeaders });
  if (!res.ok) {
    throw new Error(`Failed to load wasm: ${res.status}`);
  }
  const bytes = await res.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports as unknown as PowWasm;
  if (!exports?.memory || !exports?.alloc || !exports?.dealloc) {
    throw new Error("Invalid wasm exports");
  }
  wasm = exports;
  return wasm;
}

async function benchOnce(durationMs: number) {
  const engine = await initWasm();
  const encoder = new TextEncoder();
  const challengeBytes = encoder.encode("bench");
  const challengePtr = engine.alloc(challengeBytes.length);
  let mem = new Uint8Array(engine.memory.buffer);
  mem.set(challengeBytes, challengePtr);

  const outPtr = engine.alloc(32);
  let nonce = 0;
  const start = performance.now();
  let lastYield = start;

  while (performance.now() - start < durationMs) {
    engine.hash_with_nonce(challengePtr, challengeBytes.length, BigInt(nonce), outPtr);
    nonce += 1;
    const now = performance.now();
    if (now - lastYield >= 16) {
      lastYield = now;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const elapsed = performance.now() - start;
  engine.dealloc(challengePtr, challengeBytes.length);
  engine.dealloc(outPtr, 32);
  return normalizeHps(elapsed > 0 ? Math.round((nonce / elapsed) * 1000) : 0);
}

async function runBench() {
  if (HPS_OVERRIDE) {
    return normalizeHps(Number(HPS_OVERRIDE));
  }
  const samples: number[] = [];
  for (let i = 0; i < BENCH_ROUNDS; i += 1) {
    const sample = await benchOnce(BENCH_DURATION_MS);
    if (sample) samples.push(sample);
  }
  return medianNumber(samples);
}

type ChallengePayload = {
  challengeId: string | number;
  challenge: string;
  difficulty: number;
};

async function solvePow(challenge: string, difficulty: number) {
  const engine = await initWasm();
  const encoder = new TextEncoder();
  const challengeBytes = encoder.encode(challenge);
  const challengePtr = engine.alloc(challengeBytes.length);
  let mem = new Uint8Array(engine.memory.buffer);
  mem.set(challengeBytes, challengePtr);

  const outPtr = engine.alloc(32);
  let nonce = 0;
  const start = performance.now();
  let lastYield = start;

  while (true) {
    const leading = engine.hash_with_nonce(
      challengePtr,
      challengeBytes.length,
      BigInt(nonce),
      outPtr
    );
    if (leading >= difficulty) {
      mem = new Uint8Array(engine.memory.buffer);
      const hashBytes = mem.slice(outPtr, outPtr + 32);
      engine.dealloc(challengePtr, challengeBytes.length);
      engine.dealloc(outPtr, 32);
      return { nonce, leading, hash: bytesToHex(hashBytes) };
    }

    nonce += 1;
    const now = performance.now();
    if (now - start > MAX_POW_SECONDS * 1000) {
      engine.dealloc(challengePtr, challengeBytes.length);
      engine.dealloc(outPtr, 32);
      throw new Error(`PoW timeout after ${MAX_POW_SECONDS}s`);
    }
    if (now - lastYield >= 16) {
      lastYield = now;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

async function main() {
  if (!COOKIE) {
    console.warn("[warn] COOKIE is empty; request may fail.");
  }

  const me = await fetchJson<{
    signedInToday: boolean;
    isTest: boolean;
    user: { name: string; username: string };
  }>("/api/me");

  if (!me.ok) {
    throw new Error(`GET /api/me failed: ${me.status} ${me.text}`);
  }

  if (me.data?.signedInToday && !me.data?.isTest) {
    console.log("[info] already signed in today; exiting.");
    await pushplus("qaq 签到提醒", "今日已签到，无需重复操作。");
    return;
  }

  const hps = await runBench();
  if (!hps) {
    throw new Error("Bench failed; hps is 0");
  }
  console.log(`[info] bench hps=${hps.toLocaleString()} H/s`);

  const challengeRes = await fetchJson<ChallengePayload>(
    `/api/pow/challenge?tier=${encodeURIComponent(String(TIER))}&hps=${encodeURIComponent(String(hps))}`
  );

  if (!challengeRes.ok || !challengeRes.data) {
    throw new Error(`challenge failed: ${challengeRes.status} ${challengeRes.text}`);
  }

  console.log("[info] challenge response", challengeRes.data);
  const challengeReceivedAt = Date.now();

  if (MODE !== "full") {
    console.log(`[info] mode=${MODE}; skipping pow/submit.`);
    return;
  }

  const { challengeId, challenge, difficulty } = challengeRes.data;
  if (!challengeId || !challenge || typeof difficulty !== "number") {
    throw new Error("challenge payload missing fields");
  }

  console.log(`[info] challenge received; difficulty=${difficulty}`);

  const result = await solvePow(challenge, difficulty);
  console.log(`[info] pow solved; nonce=${result.nonce} leading=${result.leading}`);

  const elapsedSinceChallenge = Date.now() - challengeReceivedAt;
  if (elapsedSinceChallenge < MIN_SUBMIT_DELAY_MS) {
    const waitMs = MIN_SUBMIT_DELAY_MS - elapsedSinceChallenge;
    console.log(`[info] waiting ${waitMs}ms before submit`);
    await sleep(waitMs);
  }

  const submitRes = await fetchJson<{ rewardFinal?: number; notes?: string }>(
    "/api/pow/submit",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeId,
        nonce: result.nonce,
        tier: TIER
      })
    }
  );

  if (!submitRes.ok) {
    const msg = `submit failed: ${submitRes.status} ${submitRes.text}`;
    await pushplus("qaq 签到失败", msg);
    throw new Error(msg);
  }

  const reward = (submitRes.data as { rewardFinal?: number })?.rewardFinal;
  const notes = (submitRes.data as { notes?: string })?.notes;
  const successMsg = [
    "<b>签到成功</b>",
    reward != null ? `奖励: ${reward}` : "",
    notes ? `备注: ${notes}` : "",
    `难度: ${difficulty}`,
    `Nonce: ${result.nonce}`,
    `HPS: ${hps.toLocaleString()} H/s`
  ].filter(Boolean).join("<br>");

  await pushplus("qaq 签到成功", successMsg);
  console.log("[info] submit ok", submitRes.data ?? submitRes.text);
}

main().catch(async (error) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${msg}`);
  await pushplus("qaq 签到异常", msg);
  process.exit(1);
});
