import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type AuthEnv = Record<string, string | undefined>;

export type AuthCheckInput = {
  url?: string;
  authorization?: string | string[];
  env?: AuthEnv;
};

export type HttpAuthResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

const TOKEN_PREFIX_LENGTH = 18;

export function hasConfiguredAuth(env: AuthEnv = process.env): boolean {
  return Boolean(
    env.MCP_TOKEN_SIGNING_SECRET?.trim() ||
      env.MCP_ACCESS_TOKEN_HASHES?.trim() ||
      env.MCP_ACCESS_TOKENS?.trim(),
  );
}

export function getUnauthorizedResponse(originUrl: string, method = "POST"): HttpAuthResponse {
  const isGet = method.toUpperCase() === "GET";
  return {
    status: 401,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "www-authenticate": `Bearer realm="education-agent-skills", error="invalid_token", error_description="Hosted MCP access token required"`,
      "x-mcp-auth": isGet ? "required-fast-fail" : "required",
    },
    body: JSON.stringify({
      error: "Hosted MCP access token required",
      message:
        "This hosted MCP endpoint now requires an access token. Request one via the hosted access form, or use the free local/plugin installation options.",
      requestAccess: "https://docs.google.com/forms/d/e/1FAIpQLSdW1EdcmtjSPPq68Hx-bdth5hO2KNyjhAwEV9Ld0EwWL1Gr8Q/viewform",
      resource: originUrl,
    }),
  };
}

export function getAuthorizedTokenPrefix(input: AuthCheckInput): string | null {
  const env = input.env ?? process.env;
  const token = extractToken(input.url, input.authorization);
  if (!token || !hasConfiguredAuth(env)) return null;
  if (isSignedTokenValid(token, env.MCP_TOKEN_SIGNING_SECRET)) {
    return token.slice(0, TOKEN_PREFIX_LENGTH);
  }
  if (isHashTokenValid(token, env.MCP_ACCESS_TOKEN_HASHES)) {
    return token.slice(0, TOKEN_PREFIX_LENGTH);
  }
  if (isPlainTokenValid(token, env.MCP_ACCESS_TOKENS)) {
    return token.slice(0, TOKEN_PREFIX_LENGTH);
  }
  return null;
}

export function extractToken(url?: string, authorization?: string | string[]): string | null {
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;
  if (!url) return null;
  try {
    const parsed = new URL(url, "https://example.invalid");
    return parsed.searchParams.get("token")?.trim() || null;
  } catch {
    return null;
  }
}

function isSignedTokenValid(token: string, secret?: string): boolean {
  const cleanSecret = secret?.trim();
  if (!cleanSecret) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!payload.startsWith("eas_live_") || !signature) return false;
  const expected = createHmac("sha256", cleanSecret).update(payload).digest("base64url");
  return safeEqual(signature, expected);
}

function isHashTokenValid(token: string, hashes?: string): boolean {
  const allowed = splitList(hashes);
  if (allowed.length === 0) return false;
  const digest = createHash("sha256").update(token).digest("hex");
  return allowed.some((hash) => safeEqual(digest, hash));
}

function isPlainTokenValid(token: string, tokens?: string): boolean {
  const allowed = splitList(tokens);
  if (allowed.length === 0) return false;
  return allowed.some((allowedToken) => safeEqual(token, allowedToken));
}

function splitList(raw?: string): string[] {
  return (raw ?? "")
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}
