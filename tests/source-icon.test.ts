import { describe, expect, it } from "vitest";
import { resolveSourceIcon } from "../src/source-icon";

describe("source-icon resolver", () => {
  it("resolves canonical built-in sources to Lucide icons", () => {
    expect(resolveSourceIcon("health-connect")).toEqual({
      type: "lucide",
      value: "heart-pulse",
      label: "health-connect"
    });
    expect(resolveSourceIcon("monkeytype")).toEqual({
      type: "lucide",
      value: "keyboard",
      label: "monkeytype"
    });
    expect(resolveSourceIcon("github")).toEqual({
      type: "lucide",
      value: "github",
      label: "github"
    });
    expect(resolveSourceIcon("wakatime")).toEqual({
      type: "lucide",
      value: "code-xml",
      label: "wakatime"
    });
    expect(resolveSourceIcon("strava")).toEqual({
      type: "lucide",
      value: "footprints",
      label: "strava"
    });
    expect(resolveSourceIcon("endpoint")).toEqual({
      type: "lucide",
      value: "cloud-download",
      label: "endpoint"
    });
  });

  it("resolves explicit lucide: and icon: prefixes", () => {
    expect(resolveSourceIcon("lucide:flame")).toEqual({
      type: "lucide",
      value: "flame",
      label: "lucide:flame"
    });
    expect(resolveSourceIcon("icon:dumbbell")).toEqual({
      type: "lucide",
      value: "dumbbell",
      label: "icon:dumbbell"
    });
  });

  it("resolves web images and local file paths", () => {
    expect(resolveSourceIcon("https://example.com/icon.png")).toEqual({
      type: "image",
      value: "https://example.com/icon.png",
      label: "https://example.com/icon.png"
    });
    expect(resolveSourceIcon("assets/icons/duolingo.svg")).toEqual({
      type: "image",
      value: "assets/icons/duolingo.svg",
      label: "assets/icons/duolingo.svg"
    });
    expect(resolveSourceIcon("data:image/png;base64,iVBORw0KGgoAAA")).toEqual({
      type: "image",
      value: "data:image/png;base64,iVBORw0KGgoAAA",
      label: "data:image/png;base64,iVBORw0KGgoAAA"
    });
  });

  it("resolves inline SVG markup", () => {
    const svg = `<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>`;
    expect(resolveSourceIcon(svg)).toEqual({
      type: "inline-svg",
      value: svg,
      label: "SVG"
    });
  });

  it("falls back to text badge for custom unrecognized text", () => {
    expect(resolveSourceIcon("my-custom-api")).toEqual({
      type: "text",
      value: "my-custom-api",
      label: "my-custom-api"
    });
  });
});
