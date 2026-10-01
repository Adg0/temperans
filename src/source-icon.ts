export type SourceIconType = "inline-svg" | "image" | "lucide" | "text";

export interface SourceIconDescriptor {
  type: SourceIconType;
  value: string;
  label: string;
}

export const KNOWN_SOURCE_ICONS: Record<string, string> = {
  "health-connect": "heart-pulse",
  "companion": "smartphone",
  "temperans-companion": "smartphone",
  "monkeytype": "keyboard",
  "wakatime": "code-xml",
  "github": "github",
  "strava": "footprints",
  "duolingo": "languages",
  "endpoint": "cloud-download",
  "endpoint-sync": "cloud-download"
};

export function resolveSourceIcon(source: string): SourceIconDescriptor {
  const trimmed = source.trim();
  if (trimmed.startsWith("<svg") && trimmed.endsWith("</svg>")) {
    return { type: "inline-svg", value: trimmed, label: "SVG" };
  }
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:image/") ||
    /\.(png|jpe?g|webp|svg)$/i.test(trimmed)
  ) {
    return { type: "image", value: trimmed, label: trimmed };
  }
  if (trimmed.startsWith("lucide:") || trimmed.startsWith("icon:")) {
    const name = trimmed.replace(/^(lucide|icon):/, "").trim();
    return { type: "lucide", value: name, label: trimmed };
  }
  const known = KNOWN_SOURCE_ICONS[trimmed.toLowerCase()];
  if (known) {
    return { type: "lucide", value: known, label: trimmed };
  }
  return { type: "text", value: trimmed, label: trimmed };
}

export type IconSetterFn = (element: HTMLElement, iconId: string) => void;

/**
 * Sanitizes an SVG DOM element in-place to protect against stored XSS:
 * - Removes script, foreignObject, iframe, object, embed elements.
 * - Removes any on* event handler attributes (e.g. onload, onerror, onclick).
 * - Removes javascript:, vbscript:, and data: schemes in href / xlink:href attributes.
 */
export function sanitizeSvgElement(element: Element): void {
  const disallowedTags = new Set(["script", "foreignobject", "iframe", "object", "embed"]);
  const toRemove: Element[] = [];
  const allElements = [element, ...Array.from(element.querySelectorAll("*"))];

  for (const el of allElements) {
    const tagName = el.tagName.toLowerCase();
    if (disallowedTags.has(tagName)) {
      toRemove.push(el);
      continue;
    }

    for (const attr of Array.from(el.attributes)) {
      const attrName = attr.name.toLowerCase();
      const attrVal = attr.value.trim().toLowerCase();

      if (attrName.startsWith("on")) {
        el.removeAttribute(attr.name);
      } else if (attrName === "href" || attrName === "xlink:href" || attrName.endsWith(":href")) {
        if (/^(?:javascript|vbscript|data):/i.test(attrVal.replace(/\s+/g, ""))) {
          el.removeAttribute(attr.name);
        }
      }
    }
  }

  for (const el of toRemove) {
    el.parentNode?.removeChild(el);
  }
}

export function renderSourceIcon(
  container: HTMLElement,
  source: string,
  iconSetter?: IconSetterFn
): HTMLElement {
  const descriptor = resolveSourceIcon(source);
  const badge = container.createSpan({
    cls: "temperans-source-icon",
    attr: { "aria-label": `Source: ${descriptor.label}` }
  });

  if (descriptor.type === "inline-svg") {
    try {
      const parsed = new DOMParser().parseFromString(descriptor.value, "image/svg+xml");
      const svgEl = parsed.querySelector("svg");
      if (svgEl) {
        sanitizeSvgElement(svgEl);
        badge.appendChild(document.importNode(svgEl, true));
        return badge;
      }
    } catch {
      // Fallback if parsing fails
    }
    badge.className = "temperans-source-badge";
    badge.textContent = descriptor.label;
    return badge;
  }
  if (descriptor.type === "image") {
    const img = badge.createEl("img", {
      attr: { src: descriptor.value, alt: descriptor.label, "aria-hidden": "true" }
    });
    img.onerror = () => {
      badge.empty();
      if (iconSetter) iconSetter(badge, "link");
    };
    return badge;
  }
  if (descriptor.type === "lucide") {
    if (iconSetter) iconSetter(badge, descriptor.value);
    return badge;
  }

  // Fallback text badge
  badge.empty();
  badge.className = "temperans-source-badge";
  badge.textContent = descriptor.value;
  return badge;
}
