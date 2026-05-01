/**
 * ## ogImage
 *
 * 動態生成文章 OG 圖片（1200×630 PNG），設計嚴格遵循 OG Images Preview.html。
 *
 * ### 字型策略
 * - Geist Mono（Latin）：來自 jsDelivr CDN，快取到 `data/fonts/`
 * - Noto Sans TC（CJK）：來自 Google Fonts CSS2 API，解析後逐個子集下載並快取
 * - 快取使用磁碟（data/fonts/），伺服器重啟後不需重下
 *
 * ### 已知限制
 * - heroImageUrl 必須是公開可存取的 URL（satori 渲染時會 fetch）
 * - 首次生成較慢（需下載字型約 8-10 MB）；之後讀磁碟快取
 * - 背景 grid pattern 透過 CSS background-image 實現，satori ≥0.10 支援
 */
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { mkdir } from "node:fs/promises";

// Design tokens — exact match to OG Images Preview.html CSS variables
const C = {
  bg: "#0c0c0c",
  surface: "#141414",
  border: "#1e1e1e",
  muted: "#555",
  text: "#e8e8e8",
  accent: "#33CCBB",
};

const FONT_DIR = "data/fonts";

async function ensureFontDir() {
  await mkdir(FONT_DIR, { recursive: true });
}

async function getCachedFont(filename: string, url: string): Promise<ArrayBuffer> {
  await ensureFontDir();
  const file = Bun.file(`${FONT_DIR}/${filename}`);
  if (await file.exists()) return file.arrayBuffer();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font fetch failed: ${url} (${res.status})`);
  const data = await res.arrayBuffer();
  await Bun.write(`${FONT_DIR}/${filename}`, data);
  return data;
}

async function loadCjkSubsets(family: string, weight: number): Promise<{ name: string; data: ArrayBuffer; weight: number; style: "normal" }[]> {
  const safeFamily = family.replace(/ /g, "-");
  // Use old UA suffix to distinguish TTF cache from old WOFF2 cache
  const cssFilename = `${safeFamily}-${weight}-ttf.css`;
  const cssPath = `${FONT_DIR}/${cssFilename}`;
  await ensureFontDir();

  let css: string;
  const cssFile = Bun.file(cssPath);
  if (await cssFile.exists()) {
    css = await cssFile.text();
  } else {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`;
    // curl/7.0 UA makes Google Fonts serve TTF (with .ttf extension in URL); satori only supports TTF/OTF
    css = await fetch(cssUrl, {
      headers: { "User-Agent": "curl/7.0" },
    }).then((r) => {
      if (!r.ok) throw new Error(`Google Fonts CSS fetch failed (${r.status})`);
      return r.text();
    });
    await Bun.write(cssPath, css);
  }

  const urls = [...css.matchAll(/url\((['"]?)([^'")\s]+\.ttf[^'")\s]*)\1\)/g)].map((m) => m[2]!)

  if (urls.length === 0) throw new Error(`No font URLs found in Google Fonts CSS for ${family} ${weight}. CSS snippet: ${css.slice(0, 300)}`);

  return Promise.all(
    urls.map(async (url, i) => {
      const fontFilename = `${safeFamily}-${weight}-${i}.ttf`;
      const data = await getCachedFont(fontFilename, url);
      return { name: family, data, weight: weight as FontWeight, style: "normal" as const };
    })
  );
}

type SatoriFont = Parameters<typeof satori>[1]["fonts"][number];
type FontWeight = NonNullable<SatoriFont["weight"]>;
let cachedFonts: SatoriFont[] | null = null;

async function getFonts(): Promise<SatoriFont[]> {
  if (cachedFonts) return cachedFonts;

  const [gm400, gm600, cjkFonts] = await Promise.all([
    getCachedFont(
      "geist-mono-400.ttf",
      "https://cdn.jsdelivr.net/npm/geist/dist/fonts/geist-mono/GeistMono-Regular.ttf"
    ),
    getCachedFont(
      "geist-mono-600.ttf",
      "https://cdn.jsdelivr.net/npm/geist/dist/fonts/geist-mono/GeistMono-SemiBold.ttf"
    ),
    loadCjkSubsets("Noto Sans TC", 400),
  ]);

  const fonts: SatoriFont[] = [
    { name: "Geist Mono", data: gm400, weight: 400 as FontWeight, style: "normal" as const },
    { name: "Geist Mono", data: gm600, weight: 600 as FontWeight, style: "normal" as const },
    ...cjkFonts,
  ];
  cachedFonts = fonts;
  return fonts;
}

export interface ArticleOgOptions {
  title: string;
  description?: string;
  /** YYYY-MM-DD */
  date?: string;
  tags?: string[];
  heroImageUrl?: string;
}

/**
 * 根據文章資料生成 1200×630 OG 圖片，回傳 PNG bytes。
 *
 * @remarks
 * 字型檔首次執行時下載（~8 MB），存磁碟快取後重用。
 * 若 `heroImageUrl` 指定，satori 會在渲染時 fetch 該 URL 並嵌入 SVG。
 */
export async function generateArticleOg(opts: ArticleOgOptions): Promise<Uint8Array> {
  const fonts = await getFonts();
  const { title, description, date, tags = [], heroImageUrl } = opts;
  const dateStr = date ? date.replace(/-/g, ".") : "";
  const displayTags = tags.slice(0, 2);
  const titleFontSize = computeTitleFontSize(title);

  const element = buildOgElement({ title, description, dateStr, displayTags, heroImageUrl, titleFontSize });
  const svg = await satori(element as Parameters<typeof satori>[0], { width: 1200, height: 630, fonts });

  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } });
  return resvg.render().asPng();
}

/**
 * 根據標題長度（CJK 字元算 2 個寬度單位）計算合適的字型大小。
 *
 * @remarks
 * 設計規範要求「長標題自動縮小至 40px」；這裡用寬度估算做更細緻的分級。
 */
function computeTitleFontSize(title: string): number {
  const w = [...title].reduce(
    (sum, ch) => sum + (/[　-鿿＀-￯]/.test(ch) ? 2 : 1),
    0
  );
  if (w <= 18) return 52;
  if (w <= 26) return 46;
  if (w <= 34) return 40;
  return 34;
}

// ── Element builders ──────────────────────────────────────────────────────────

type StyleMap = Record<string, unknown>;

function h(type: string, style: StyleMap, ...children: unknown[]) {
  const flat = (children as unknown[]).flat(2).filter((c) => c != null && c !== false);
  return {
    type,
    props: {
      style,
      children: flat.length === 0 ? undefined : flat.length === 1 ? flat[0] : flat,
    },
  };
}

function hImg(src: string, style: StyleMap) {
  return { type: "img", props: { src, style } };
}

function buildOgElement(opts: {
  title: string;
  description?: string;
  dateStr: string;
  displayTags: string[];
  heroImageUrl?: string;
  titleFontSize: number;
}) {
  const { title, description, dateStr, displayTags, heroImageUrl, titleFontSize } = opts;

  return h(
    "div",
    {
      width: 1200,
      height: 630,
      background: C.bg,
      fontFamily: '"Geist Mono", "Noto Sans TC", monospace',
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      position: "relative",
    },

    // Top accent line — 3px, full width, accent color
    h("div", {
      position: "absolute",
      top: 0, left: 0, right: 0,
      height: 3,
      background: C.accent,
    }),

    heroImageUrl ? buildImgStrip(heroImageUrl) : buildMetaStrip(),

    buildContent({ title, description, dateStr, displayTags, titleFontSize })
  );
}

function buildImgStrip(heroImageUrl: string) {
  return h(
    "div",
    {
      height: 240,
      flexShrink: 0,
      position: "relative",
      overflow: "hidden",
      background: C.surface,
      borderBottom: `1px solid ${C.border}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    hImg(heroImageUrl, {
      position: "absolute",
      top: 0, left: 0,
      width: "100%", height: "100%",
      objectFit: "cover",
    }),
    // Gradient overlay: transparent → bg
    h("div", {
      position: "absolute",
      top: 0, left: 0, right: 0, bottom: 0,
      background: `linear-gradient(to bottom, transparent 55%, ${C.bg} 100%)`,
    })
  );
}

function buildMetaStrip() {
  return h(
    "div",
    {
      height: 240,
      flexShrink: 0,
      position: "relative",
      overflow: "hidden",
      background: C.surface,
      borderBottom: `1px solid ${C.border}`,
      display: "flex",
    },
    // Grid texture
    h("div", {
      position: "absolute",
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundImage: `linear-gradient(${C.border} 1px, transparent 1px), linear-gradient(90deg, ${C.border} 1px, transparent 1px)`,
      backgroundSize: "60px 60px",
      opacity: 0.6,
    }),
    // Faint watermark "SH."
    h(
      "div",
      {
        position: "absolute",
        bottom: -16, right: 60,
        fontSize: 220, fontWeight: 700,
        letterSpacing: "-0.06em",
        lineHeight: 1,
        color: C.accent,
        opacity: 0.04,
        whiteSpace: "nowrap",
      },
      "SH."
    ),
    // Gradient overlay
    h("div", {
      position: "absolute",
      top: 0, left: 0, right: 0, bottom: 0,
      background: `linear-gradient(to bottom, transparent 50%, ${C.surface} 100%)`,
    }),
    // "// blog" label
    h(
      "div",
      {
        position: "absolute",
        bottom: 28, left: 72,
        fontSize: 20,
        color: C.muted,
        letterSpacing: "0.1em",
      },
      "// blog"
    )
  );
}

function buildContent(opts: {
  title: string;
  description?: string;
  dateStr: string;
  displayTags: string[];
  titleFontSize: number;
}) {
  const { title, description, dateStr, displayTags, titleFontSize } = opts;

  return h(
    "div",
    {
      flexGrow: 1,
      padding: "32px 72px 36px",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
    },

    // Title + description
    h(
      "div",
      { display: "flex", flexDirection: "column" },
      h(
        "div",
        {
          fontSize: titleFontSize,
          fontWeight: 600,
          letterSpacing: "-0.04em",
          lineHeight: 1.05,
          color: C.text,
        },
        title
      ),
      description
        ? h(
            "div",
            { fontSize: 22, color: C.accent, marginTop: 10 },
            description
          )
        : null
    ),

    // Bottom row: left meta + domain
    h(
      "div",
      {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      },

      // Left: avatar + author name + date + tags
      h(
        "div",
        { display: "flex", alignItems: "center", gap: 24 },

        // Avatar + author
        h(
          "div",
          { display: "flex", alignItems: "center", gap: 14 },
          h(
            "div",
            {
              width: 44, height: 44,
              borderRadius: 22,
              background: "linear-gradient(135deg, #1a2a2a 0%, #0d1a1a 100%)",
              border: `2px solid ${C.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            },
            h(
              "span",
              {
                fontSize: 13, fontWeight: 600,
                color: C.accent, letterSpacing: "-0.04em",
              },
              "SH"
            )
          ),
          h(
            "span",
            { fontSize: 18, fontWeight: 600, color: C.text },
            "Sean Hung"
          )
        ),

        dateStr
          ? h("span", { fontSize: 18, color: C.muted, letterSpacing: "0.08em" }, dateStr)
          : null,

        ...displayTags.map((tag) =>
          h(
            "span",
            {
              fontSize: 16,
              border: `1px solid ${C.border}`,
              padding: "3px 12px",
              borderRadius: 3,
              color: C.muted,
            },
            `#${tag}`
          )
        )
      ),

      // Right: domain
      h("span", { fontSize: 18, color: C.muted, letterSpacing: "0.04em" }, "senen.dev")
    )
  );
}
