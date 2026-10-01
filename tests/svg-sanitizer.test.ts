import { describe, expect, it } from "vitest";
import { sanitizeSvgElement } from "../src/source-icon";

// Minimal Element mock to test sanitizeSvgElement in Node environment without heavy external dependencies
interface MockAttr {
  name: string;
  value: string;
}

class MockElement {
  tagName: string;
  attributes: MockAttr[] = [];
  children: MockElement[] = [];
  parentNode: MockElement | null = null;

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  setAttribute(name: string, value: string) {
    const existing = this.attributes.find((a) => a.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.value = value;
    } else {
      this.attributes.push({ name, value });
    }
  }

  getAttribute(name: string): string | null {
    const found = this.attributes.find((a) => a.name.toLowerCase() === name.toLowerCase());
    return found ? found.value : null;
  }

  removeAttribute(name: string) {
    this.attributes = this.attributes.filter((a) => a.name.toLowerCase() !== name.toLowerCase());
  }

  appendChild(child: MockElement) {
    child.parentNode = this;
    this.children.push(child);
  }

  removeChild(child: MockElement) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
  }

  querySelectorAll(selector: string): MockElement[] {
    const result: MockElement[] = [];
    const traverse = (node: MockElement) => {
      for (const child of node.children) {
        if (selector === "*" || child.tagName.toLowerCase() === selector.toLowerCase()) {
          result.push(child);
        }
        traverse(child);
      }
    };
    traverse(this);
    return result;
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

describe("SVG Sanitizer (XSS protection)", () => {
  it("removes <script> tags inside SVG", () => {
    const svg = new MockElement("svg");
    const circle = new MockElement("circle");
    const script = new MockElement("script");
    svg.appendChild(circle);
    svg.appendChild(script);

    sanitizeSvgElement(svg as unknown as Element);

    expect(svg.querySelector("script")).toBeNull();
    expect(svg.querySelector("circle")).not.toBeNull();
  });

  it("strips inline event handler attributes like onload and onerror", () => {
    const svg = new MockElement("svg");
    svg.setAttribute("onload", "alert(1)");

    const img = new MockElement("image");
    img.setAttribute("href", "x");
    img.setAttribute("onerror", "alert(2)");
    svg.appendChild(img);

    const rect = new MockElement("rect");
    rect.setAttribute("onclick", "stealCookies()");
    rect.setAttribute("width", "10");
    svg.appendChild(rect);

    sanitizeSvgElement(svg as unknown as Element);

    expect(svg.getAttribute("onload")).toBeNull();
    expect(img.getAttribute("onerror")).toBeNull();
    expect(img.getAttribute("href")).toBe("x");
    expect(rect.getAttribute("onclick")).toBeNull();
    expect(rect.getAttribute("width")).toBe("10");
  });

  it("removes <foreignObject> tags which can embed HTML", () => {
    const svg = new MockElement("svg");
    const foreignObject = new MockElement("foreignObject");
    const iframe = new MockElement("iframe");
    foreignObject.appendChild(iframe);
    svg.appendChild(foreignObject);

    sanitizeSvgElement(svg as unknown as Element);

    expect(svg.querySelector("foreignObject")).toBeNull();
    expect(svg.querySelector("iframe")).toBeNull();
  });

  it("disallows javascript: URIs in href and xlink:href", () => {
    const svg = new MockElement("svg");
    const a = new MockElement("a");
    a.setAttribute("href", "javascript:alert(1)");
    svg.appendChild(a);

    const img = new MockElement("image");
    img.setAttribute("xlink:href", " javascript:alert(2)");
    svg.appendChild(img);

    sanitizeSvgElement(svg as unknown as Element);

    expect(a.getAttribute("href")).toBeNull();
    expect(img.getAttribute("xlink:href")).toBeNull();
  });

  it("preserves legitimate SVG elements and attributes", () => {
    const svg = new MockElement("svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    const path = new MockElement("path");
    path.setAttribute("d", "M12 2v20");
    path.setAttribute("stroke", "currentColor");
    svg.appendChild(path);

    sanitizeSvgElement(svg as unknown as Element);

    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(path.getAttribute("d")).toBe("M12 2v20");
    expect(path.getAttribute("stroke")).toBe("currentColor");
  });
});
