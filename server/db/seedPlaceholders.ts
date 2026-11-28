import type { Category } from "../../app/shared/constants";

/**
 * Colourful placeholder "photos" for the development seed (design v2): a soft
 * gradient in the category's colour with a simple flat illustration. Generated
 * locally as SVG — nothing is downloaded. Dev data only; these hex values are
 * image content, not UI colours (UI colours come from the theme tokens).
 */

interface Palette {
  /** Sky gradient, top → bottom. */
  sky: [string, string];
  /** Main building/feature colour and its darker shade. */
  main: string;
  shade: string;
  /** Ground. */
  ground: string;
}

const PALETTES: Record<Category, Palette[]> = {
  apartment: [
    { sky: ["#bfe0f5", "#e8f3fb"], main: "#1d6a9e", shade: "#154e75", ground: "#cfe3f0" },
    { sky: ["#c9d9f2", "#eef3fb"], main: "#3b5f9e", shade: "#2b4675", ground: "#d6e0f0" },
  ],
  house: [
    { sky: ["#f6d2c9", "#fbeee9"], main: "#c0563f", shade: "#93402f", ground: "#e7d8c8" },
    { sky: ["#f5dccb", "#fcf1ea"], main: "#b5653a", shade: "#8a4b2a", ground: "#eadfcd" },
  ],
  villa: [
    { sky: ["#cdeee0", "#eef9f3"], main: "#2f7d5b", shade: "#225c43", ground: "#dcebd6" },
    { sky: ["#d6f0e6", "#f1faf6"], main: "#3c8c6c", shade: "#2b6650", ground: "#e1efd9" },
  ],
  land: [
    { sky: ["#fbe3b8", "#fdf3e1"], main: "#c98516", shade: "#9d6810", ground: "#e9d39f" },
    { sky: ["#f7e6c4", "#fcf5e6"], main: "#b8860b", shade: "#8d6608", ground: "#e3d3a3" },
  ],
  commercial: [
    { sky: ["#e6d3ef", "#f6eefa"], main: "#a32a44", shade: "#7e1f33", ground: "#ecdcdf" },
    { sky: ["#e1d6f1", "#f4effb"], main: "#6d4a9e", shade: "#523778", ground: "#e2dbee" },
  ],
};

function illustration(category: Category, p: Palette): string {
  switch (category) {
    case "apartment": {
      const windows: string[] = [];
      for (let row = 0; row < 5; row++) for (let col = 0; col < 4; col++) windows.push(`<rect x="${468 + col * 70}" y="${250 + row * 70}" width="38" height="44" rx="4" fill="#fff" opacity="0.85"/>`);
      return `<rect x="440" y="210" width="300" height="420" rx="10" fill="${p.main}"/>
<rect x="740" y="300" width="160" height="330" rx="10" fill="${p.shade}"/>
${windows.join("")}
<rect x="775" y="340" width="34" height="40" rx="4" fill="#fff" opacity="0.7"/><rect x="835" y="340" width="34" height="40" rx="4" fill="#fff" opacity="0.7"/>
<rect x="775" y="420" width="34" height="40" rx="4" fill="#fff" opacity="0.7"/><rect x="835" y="420" width="34" height="40" rx="4" fill="#fff" opacity="0.7"/>
<rect x="560" y="560" width="60" height="70" rx="6" fill="${p.shade}"/>`;
    }
    case "house":
      return `<polygon points="600,250 400,420 800,420" fill="${p.shade}"/>
<rect x="440" y="410" width="320" height="220" rx="8" fill="${p.main}"/>
<rect x="570" y="500" width="60" height="130" rx="6" fill="${p.shade}"/>
<rect x="475" y="460" width="60" height="55" rx="5" fill="#fff" opacity="0.85"/><rect x="665" y="460" width="60" height="55" rx="5" fill="#fff" opacity="0.85"/>
<rect x="700" y="290" width="36" height="80" fill="${p.shade}"/>`;
    case "villa":
      return `<rect x="330" y="380" width="380" height="250" rx="8" fill="${p.main}"/>
<rect x="420" y="300" width="230" height="90" rx="8" fill="${p.shade}"/>
<rect x="360" y="420" width="70" height="60" rx="5" fill="#fff" opacity="0.85"/><rect x="460" y="420" width="70" height="60" rx="5" fill="#fff" opacity="0.85"/><rect x="600" y="420" width="70" height="60" rx="5" fill="#fff" opacity="0.85"/>
<rect x="450" y="325" width="60" height="40" rx="4" fill="#fff" opacity="0.8"/><rect x="560" y="325" width="60" height="40" rx="4" fill="#fff" opacity="0.8"/>
<rect x="545" y="520" width="60" height="110" rx="6" fill="${p.shade}"/>
<rect x="730" y="590" width="200" height="40" rx="18" fill="#7cc6e8"/>
<circle cx="830" cy="430" r="70" fill="${p.shade}" opacity="0.9"/><rect x="822" y="480" width="16" height="150" fill="#6b4f3a"/>`;
    case "land":
      return `<path d="M0 560 Q 250 440 520 540 T 1200 500 V 800 H 0 Z" fill="${p.main}" opacity="0.55"/>
<path d="M0 620 Q 300 540 640 610 T 1200 600 V 800 H 0 Z" fill="${p.main}"/>
<polygon points="430,560 800,540 860,660 380,680" fill="none" stroke="${p.shade}" stroke-width="8" stroke-dasharray="22 14" stroke-linejoin="round"/>
<line x1="600" y1="470" x2="600" y2="560" stroke="${p.shade}" stroke-width="8"/><polygon points="600,470 660,490 600,510" fill="#fff"/>`;
    case "commercial":
      return `<rect x="380" y="300" width="440" height="330" rx="8" fill="${p.main}"/>
<path d="M370 300 H 830 V 360 Q 807 390 784 360 Q 761 390 738 360 Q 715 390 692 360 Q 669 390 646 360 Q 623 390 600 360 Q 577 390 554 360 Q 531 390 508 360 Q 485 390 462 360 Q 439 390 416 360 Q 393 390 370 360 Z" fill="#fff" opacity="0.9"/>
<rect x="420" y="420" width="220" height="150" rx="6" fill="#fff" opacity="0.8"/>
<rect x="680" y="430" width="100" height="200" rx="6" fill="${p.shade}"/>
<rect x="430" y="250" width="340" height="44" rx="8" fill="${p.shade}"/>`;
  }
}

/** One placeholder photo (1200 × 800 SVG). `n` varies the palette and the sun's position. */
export function placeholderSvg(category: Category, n: number, label: string): string {
  const options = PALETTES[category];
  const p = options[n % options.length]!;
  const sunX = 180 + ((n * 173) % 840);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky[0]}"/><stop offset="1" stop-color="${p.sky[1]}"/></linearGradient></defs>
<rect width="1200" height="800" fill="url(#sky)"/>
<circle cx="${sunX}" cy="150" r="60" fill="#fff" opacity="0.7"/>
<ellipse cx="${(sunX + 420) % 1200}" cy="200" rx="110" ry="34" fill="#fff" opacity="0.6"/>
<rect y="630" width="1200" height="170" fill="${p.ground}"/>
${illustration(category, p)}
<text x="600" y="740" font-family="sans-serif" font-size="34" fill="${p.shade}" opacity="0.75" text-anchor="middle">${label}</text>
</svg>`;
}
