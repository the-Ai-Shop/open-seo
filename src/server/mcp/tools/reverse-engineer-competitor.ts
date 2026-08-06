import { z } from "zod";
import { mcpResponse } from "@/server/mcp/formatters";
import type { ToolExtra } from "@/server/mcp/context";

// Free-path competitor SEO teardown. Reverse-engineers what a competitor page
// TARGETS (keywords, intent, structure) from its own HTML. No DataForSEO, no
// Google SERP scraping. Does NOT return search volume, CPC, or rank positions
// (that is the paid Ahrefs/DataForSEO moat). Intent model tuned for TheGoodSite
// (done-for-you websites for SMBs): local + service = your buyers; DIY-builder,
// commercial listicles, and informational = wrong-intent.

const UA =
  "Mozilla/5.0 (compatible; TheGoodSiteSEO-Teardown/1.0; +https://thegoodsite.co)";

const ALIGNED = new Set(["local", "service"]);
const INTENT_LABEL: Record<string, string> = {
  local: "local intent — your buyers",
  service: "done-for-you service intent — your buyers",
  diy: "DIY builder/tool intent — WRONG (wants to build it themselves, not buy your service)",
  commercial: "commercial comparison/listicle — likely WRONG (research/compare traffic, low buyer overlap)",
  informational: "informational/research — WRONG (pulls researchers, not buyers)",
};

const STOP = new Set(
  ("a an the and or but for nor so yet of to in on at by with from as is are was were be been being this " +
    "that these those it its you your we our us they them their he she his her i me my can will would should " +
    "could may might must do does did has have had not no yes if then than about into over under out up down " +
    "off once more most some any all each every other such only own same too very just also then get got new " +
    "one two step steps read learn com www http https blog").split(/\s+/),
);

interface Teardown {
  finalUrl: string;
  status: number;
  blocked: boolean;
  title?: string;
  wordCount?: number;
  description?: string;
  schemaTypes?: string[];
  faqSchema?: boolean;
  h1?: string[];
  h2?: string[];
  intent?: string;
  intentLabel?: string;
  aligned?: boolean;
  keywords?: string[];
  seed?: string;
  related?: string[];
  note?: string;
}

function decode(s: string): string {
  return (s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&apos;/g, "'").replace(/&nbsp;|&mdash;|&ndash;/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ").trim();
}
const clean = (s: string): string => decode(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function tagList(html: string, re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(clean(m[1]));
  return out.filter(Boolean);
}

interface Extracted {
  url: string; title: string; description: string; canonical: string;
  h1: string[]; h2: string[]; h3: string[]; slug: string;
  schemaTypes: string[]; faqSchema: boolean; wordCount: number; bodyText: string;
}

function extract(html: string, url: string): Extracted {
  const grab = (re: RegExp): string => { const m = html.match(re); return m ? clean(m[1]) : ""; };
  const ld: string[] = [];
  let lm: RegExpExecArray | null;
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((lm = ldRe.exec(html))) {
    try {
      const j = JSON.parse(lm[1].trim());
      const nodes = Array.isArray(j) ? j : j["@graph"] ?? [j];
      for (const n of nodes) if (n && n["@type"]) ld.push(([] as string[]).concat(n["@type"]).join("/"));
    } catch { /* ignore bad json-ld */ }
  }
  const bodyText = clean(
    html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "),
  ).toLowerCase();
  const slug = decodeURIComponent(new URL(url).pathname).replace(/[-_/]+/g, " ").replace(/\.\w+$/, "").trim();
  return {
    url,
    title: grab(/<title[^>]*>([\s\S]*?)<\/title>/i),
    description: grab(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i),
    canonical: grab(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']*)["']/i),
    h1: tagList(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi),
    h2: tagList(html, /<h2[^>]*>([\s\S]*?)<\/h2>/gi),
    h3: tagList(html, /<h3[^>]*>([\s\S]*?)<\/h3>/gi),
    slug,
    schemaTypes: Array.from(new Set(ld)),
    faqSchema: ld.some((t) => /FAQPage|Question/i.test(t)),
    wordCount: bodyText.split(/\s+/).filter(Boolean).length,
    bodyText,
  };
}

function isBlocked(x: Extracted, status: number): boolean {
  return (
    status >= 400 ||
    /captcha|attention required|just a moment|access denied|are you a robot|verify you are human|enable javascript/i.test(
      x.title + " " + x.h1.join(" "),
    ) ||
    x.wordCount < 120
  );
}

function ngrams(text: string, n: number): string[] {
  const w = text.split(/[^a-z0-9']+/i).filter((x) => x.length > 2 && !STOP.has(x) && !/^\d+$/.test(x));
  const out: string[] = [];
  for (let i = 0; i <= w.length - n; i++) {
    const g = w.slice(i, i + n);
    if (g.some((x) => STOP.has(x))) continue;
    out.push(g.join(" "));
  }
  return out;
}

function targetKeywords(x: Extracted): string[] {
  const heavy = [x.title, ...x.h1, x.slug, x.description].join(" ").toLowerCase();
  const med = [...x.h2, ...x.h3].join(" ").toLowerCase();
  const freq = new Map<string, number>();
  const bump = (g: string[], w: number): void => g.forEach((k) => freq.set(k, (freq.get(k) ?? 0) + w));
  bump(ngrams(heavy, 3), 8); bump(ngrams(heavy, 2), 6);
  bump(ngrams(med, 3), 4); bump(ngrams(med, 2), 3);
  bump(ngrams(x.bodyText, 3), 1); bump(ngrams(x.bodyText, 2), 1);
  const ranked = Array.from(freq.entries())
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g);
  const kept: string[] = [];
  for (const g of ranked) {
    if (kept.some((k) => k.includes(g))) continue;
    kept.push(g);
    if (kept.length >= 12) break;
  }
  return kept;
}

function classifyIntent(text: string): string {
  const t = " " + text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ") + " ";
  const has = (arr: string[]): boolean => arr.some((k) => t.includes(" " + k + " ") || t.includes(k));
  if (has(["near me", "in my area", "service area", "local seo", "get found on google", "local business", "near you", "google business profile", "google maps"])) return "local";
  if (has(["hire", "quote", "contact us", "get started", "book a", "consultation", "done for you", "done-for-you", "build my website", "we build", "web design service", "website design service", "design agency", "website designer", "web designer", "web design company"])) return "service";
  if (has(["website builder", "site builder", "ai builder", "no-code", "no code", "drag and drop", "template", "templates", "diy", "do it yourself", "wix", "squarespace", "webflow", "software", "platform"])) return "diy";
  if (has(["best ", "top ", " vs ", "review", "alternative", "compare", "cheapest", "pricing", "cost of", "keyword", "search volume", "cpc"])) return "commercial";
  if (has(["how to", "what is", "why ", "guide", "tips", "ideas", "examples", "tutorial", "checklist", "ultimate guide"])) return "informational";
  return "informational";
}

async function autocomplete(seed: string): Promise<string[]> {
  try {
    const r = await fetch(
      `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(seed)}`,
      { headers: { "User-Agent": UA } },
    );
    const j = (await r.json()) as [string, string[]];
    return (j[1] ?? []).slice(0, 10);
  } catch {
    return [];
  }
}

const seedOf = (x: Extracted): string =>
  (x.h1[0] || x.title || x.slug || "").toLowerCase().replace(/[|\-–—:].*$/, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

async function teardown(url: string, wantAutocomplete: boolean): Promise<Teardown> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow" });
  const html = await res.text();
  const finalUrl = res.url || url;
  const x = extract(html, finalUrl);
  if (isBlocked(x, res.status)) {
    return {
      finalUrl, status: res.status, blocked: true, title: x.title, wordCount: x.wordCount,
      note: "Bot protection (e.g. Cloudflare) served a challenge, not the page. The free-path crawl cannot read it; a rendered fetch or a paid provider would be needed.",
    };
  }
  const intent = classifyIntent([x.title, x.slug, ...x.h1, ...x.h2.slice(0, 6)].join(" "));
  const seed = seedOf(x);
  const related = wantAutocomplete && seed ? await autocomplete(seed) : [];
  return {
    finalUrl, status: res.status, blocked: false, title: x.title, description: x.description,
    schemaTypes: x.schemaTypes, faqSchema: x.faqSchema, wordCount: x.wordCount,
    h1: x.h1, h2: x.h2.slice(0, 12), intent, intentLabel: INTENT_LABEL[intent],
    aligned: ALIGNED.has(intent), keywords: targetKeywords(x), seed, related,
  };
}

function render(results: Teardown[]): string {
  const L: string[] = [];
  for (const r of results) {
    L.push(`## ${r.finalUrl}`);
    if (r.blocked) { L.push(`- BLOCKED (HTTP ${r.status}). ${r.note ?? ""}`); L.push(""); continue; }
    L.push(`- ${r.wordCount} words · intent: ${(r.intent ?? "").toUpperCase()} — ${r.intentLabel}`);
    L.push(`- Verdict: ${r.aligned ? "worth competing (aligned with your buyers)" : "WRONG-INTENT cluster — likely not worth chasing for buyers"}`);
    if (r.title) L.push(`- Title: ${r.title}`);
    L.push(`- Target keywords: ${(r.keywords ?? []).join(", ") || "(none)"}`);
    if (r.related && r.related.length) L.push(`- Related (Google Autocomplete): ${r.related.join(", ")}`);
    L.push("");
  }
  const aligned = results.filter((r) => !r.blocked && r.aligned).map((r) => r.finalUrl);
  const wrong = results.filter((r) => !r.blocked && !r.aligned).map((r) => r.finalUrl);
  const blocked = results.filter((r) => r.blocked).map((r) => r.finalUrl);
  L.push("## Summary");
  if (aligned.length) L.push(`- Worth competing: ${aligned.join(", ")}`);
  if (wrong.length) L.push(`- Wrong-intent (don't chase for buyers): ${wrong.join(", ")}`);
  if (blocked.length) L.push(`- Blocked (couldn't read): ${blocked.join(", ")}`);
  L.push("");
  L.push("Note: target keywords + intent are reverse-engineered from each page's own HTML. Search volume, CPC, and rank positions require a paid provider (DataForSEO/Ahrefs) and are out of scope on the free path.");
  return L.join("\n");
}

const inputSchema = {
  urls: z.array(z.string().url()).min(1).max(10).describe("Competitor page URL(s) to reverse-engineer (1-10)."),
  autocomplete: z.boolean().optional().default(true).describe("Enrich with free Google Autocomplete related searches."),
} as const;
type Args = z.infer<z.ZodObject<typeof inputSchema>>;

export const reverseEngineerCompetitorTool = {
  name: "reverse_engineer_competitor",
  config: {
    title: "Reverse-engineer competitor SEO",
    description:
      "Reverse-engineer a competitor page's SEO from its own HTML (free — no DataForSEO, no SERP scraping). Returns the keywords the page TARGETS, its search intent (local / service / DIY-builder / commercial / informational), whether that intent matches a done-for-you website buyer, related searches via Google Autocomplete, and content structure. Does NOT return search volume, CPC, or rank positions — those need a paid provider. Flags bot-blocked pages honestly. Give it one or more competitor URLs.",
    inputSchema,
    outputSchema: z
      .object({ results: z.array(z.object({}).passthrough()) })
      .passthrough(),
    annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
  },
  handler: async (args: Args, _extra: ToolExtra) => {
    const results: Teardown[] = [];
    for (const url of args.urls) {
      try {
        results.push(await teardown(url, args.autocomplete));
      } catch (e) {
        results.push({ finalUrl: url, status: 0, blocked: true, note: String((e as Error).message ?? e) });
      }
    }
    return mcpResponse({ text: render(results), structuredContent: { results } });
  },
};
