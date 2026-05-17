import { test, expect } from "@playwright/test";
import { createHmac, createHash } from "node:crypto";
import {
  getAuthorizedTokenPrefix,
  getUnauthorizedResponse,
  hasConfiguredAuth,
} from "../src/http-auth.js";

function signedToken(secret: string, nonce = "test-nonce") {
  const payload = `eas_live_${nonce}`;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

test.describe("HTTP MCP auth", () => {
  test("fast-fails anonymous requests before the MCP transport can open SSE", () => {
    const response = getUnauthorizedResponse("https://example.com/mcp", "GET");

    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toContain("Bearer");
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).toContain("Hosted MCP access token required");
  });

  test("accepts a signed bearer token generated from the shared signing secret", () => {
    const token = signedToken("test-secret");
    const prefix = getAuthorizedTokenPrefix({
      url: "https://example.com/mcp",
      authorization: `Bearer ${token}`,
      env: { MCP_TOKEN_SIGNING_SECRET: "test-secret" },
    });

    expect(prefix).toBe("eas_live_test-nonc");
  });

  test("accepts a token query parameter for clients that cannot set auth headers", () => {
    const token = signedToken("test-secret", "query-token");
    const prefix = getAuthorizedTokenPrefix({
      url: `https://example.com/mcp?token=${encodeURIComponent(token)}`,
      authorization: undefined,
      env: { MCP_TOKEN_SIGNING_SECRET: "test-secret" },
    });

    expect(prefix).toBe("eas_live_query-tok");
  });

  test("rejects invalid signed tokens", () => {
    const token = signedToken("wrong-secret");
    const prefix = getAuthorizedTokenPrefix({
      url: "https://example.com/mcp",
      authorization: `Bearer ${token}`,
      env: { MCP_TOKEN_SIGNING_SECRET: "test-secret" },
    });

    expect(prefix).toBeNull();
  });

  test("accepts pre-hashed tokens for emergency/manual issuance", () => {
    const token = "eas_live_manual_token";
    const hash = createHash("sha256").update(token).digest("hex");
    const prefix = getAuthorizedTokenPrefix({
      url: "https://example.com/mcp",
      authorization: `Bearer ${token}`,
      env: { MCP_ACCESS_TOKEN_HASHES: hash },
    });

    expect(prefix).toBe("eas_live_manual_to");
  });

  test("requires at least one configured auth source", () => {
    expect(hasConfiguredAuth({})).toBe(false);
    expect(hasConfiguredAuth({ MCP_TOKEN_SIGNING_SECRET: "test-secret" })).toBe(true);
  });
});
