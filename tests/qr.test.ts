import { describe, expect, it } from "vitest";
import {
  createPairingUri,
  generateQrMatrix,
  generateQrSvg,
  parsePairingPayload
} from "../src/peer-sync/qr";

describe("peer-sync QR code generator and payload parser", () => {
  it("creates and parses pairing URIs accurately", () => {
    const uri = createPairingUri("192.168.1.50", 43887, "A9F2-81C4-DE90");
    expect(uri).toBe("obsidian://temperans-pair?host=192.168.1.50&port=43887&code=A9F2-81C4-DE90");

    const parsed = parsePairingPayload(uri);
    expect(parsed).toEqual({
      url: "http://192.168.1.50:43887",
      secret: "A9F2-81C4-DE90"
    });

    const legacyUri = "temperans-sync://192.168.1.50:43887?code=A9F2-81C4-DE90";
    expect(parsePairingPayload(legacyUri)).toEqual({
      url: "http://192.168.1.50:43887",
      secret: "A9F2-81C4-DE90"
    });
  });

  it("parses JSON pairing payloads", () => {
    const json = JSON.stringify({
      url: "http://192.168.1.20:43887",
      code: "MY-SECRET-123"
    });
    expect(parsePairingPayload(json)).toEqual({
      url: "http://192.168.1.20:43887",
      secret: "MY-SECRET-123"
    });
  });

  it("parses URL with hash fragment", () => {
    const urlWithHash = "http://192.168.1.30:43887#SECRET-XYZ";
    expect(parsePairingPayload(urlWithHash)).toEqual({
      url: "http://192.168.1.30:43887",
      secret: "SECRET-XYZ"
    });
  });

  it("generates a valid QR code matrix and SVG string", () => {
    const payload = createPairingUri("192.168.1.50", 43887, "TEST-CODE");
    const matrix = generateQrMatrix(payload);
    expect(Array.isArray(matrix)).toBe(true);
    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect(matrix.length).toBe(matrix[0].length);

    // Verify finder patterns exist in top-left, top-right, bottom-left
    expect(matrix[0][0]).toBe(true);
    expect(matrix[0][matrix.length - 1]).toBe(true);
    expect(matrix[matrix.length - 1][0]).toBe(true);

    const svg = generateQrSvg(payload, 200);
    expect(svg).toContain("<svg");
    expect(svg).toContain("viewBox=");
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('fill="#000000"');
  });
});
