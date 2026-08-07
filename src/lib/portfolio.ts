import type { Job, PortfolioProjectId, ProofMatch } from "./types";

export type PortfolioProject = {
  id: PortfolioProjectId;
  name: string;
  shortName: string;
  demoUrl: string | null;
  /** Job-type keywords that route to this proof */
  keywords: string[];
  /** One-line pitch for templates */
  blurb: string;
};

/**
 * Sticky portfolio map — which shipped product to attach to which role type.
 * Domain keywords + stack tools from real repos (not ML/LLM).
 */
export const PORTFOLIO: PortfolioProject[] = [
  {
    id: "foamcore",
    name: "FOAMCORE",
    shortName: "FOAMCORE",
    demoUrl: "https://demo-foamcore.vercel.app/",
    keywords: [
      "industrial",
      "b2b",
      "factory",
      "manufactur",
      "portal",
      "order cabinet",
      "erp",
      "supply chain",
      "wholesale",
      "plant",
      "next.js",
      "nextjs",
      "firebase",
      "firestore",
      "three",
      "webgl",
      "fullstack",
      "full-stack",
    ],
    blurb: "B2B industrial portal — orders, partners, ops for a real factory.",
  },
  {
    id: "asema",
    name: "Asema Trading",
    shortName: "Asema",
    demoUrl: "https://demo-trading-one.vercel.app/",
    keywords: [
      "edtech",
      "trading",
      "fintech",
      "saas",
      "school",
      "course",
      "lms",
      "education",
      "finance",
      "broker",
      "react",
      "typescript",
      "prisma",
      "postgres",
      "express",
      "socket",
      "realtime",
      "fullstack",
      "full-stack",
      "node",
    ],
    blurb: "Trading-school SaaS — fullstack product from ops to learner UI.",
  },
  {
    id: "orbital",
    name: "Orbital C2",
    shortName: "Orbital",
    demoUrl: "https://demo-cosmo.vercel.app/",
    keywords: [
      "3d",
      "hud",
      "three",
      "webgl",
      "realtime",
      "ops console",
      "command",
      "spatial",
      "visualization",
      "dashboard",
      "mission",
      "react",
      "socket",
      "express",
      "frontend",
    ],
    blurb: "Live orbital HUD — realtime 3D ops console.",
  },
  {
    id: "art_of_look",
    name: "Art of Look",
    shortName: "Art of Look",
    demoUrl: "https://demo-beautymaster.vercel.app/",
    keywords: [
      "beauty",
      "booking",
      "salon",
      "appointment",
      "spa",
      "wellness",
      "marketplace",
      "scheduling",
      "next.js",
      "nextjs",
      "supabase",
      "fullstack",
      "full-stack",
    ],
    blurb: "Beauty booking vertical SaaS — end-to-end product.",
  },
  {
    id: "lead_desk",
    name: "Lead Desk",
    shortName: "Lead Desk",
    demoUrl: null,
    keywords: [
      "outreach",
      "scrap",
      "parser",
      "automation",
      "crm",
      "ops",
      "internal tool",
      "pipeline",
      "lead",
      "harvest",
      "firebase",
      "next.js",
      "nextjs",
      "cheerio",
      "playwright",
      "platform engineer",
      "prompt",
      "ai engineer",
      "ai-powered",
      "ai-native",
      "product builder",
      "solution maker",
      "no-code",
      "low-code",
      "solution architect",
    ],
    blurb: "Outreach ops console — queue, parsers, templates.",
  },
  {
    id: "apex",
    name: "APEX / Leads Club",
    shortName: "APEX",
    demoUrl: "https://leads-club.vercel.app",
    keywords: [
      "agency",
      "packaging",
      "portfolio",
      "leads club",
      "apex",
      "product demo",
      "ai product",
      "ai-native",
      "ai native",
      "product builder",
      "full-stack ai",
      "fullstack ai",
      "prompt engineer",
      "ai solution",
      "solution architect",
      "no-code",
      "low-code",
      "brand",
      "landing",
      "marketing site",
      "growth",
      "next.js",
      "nextjs",
      "three",
      "webgl",
      "framer",
      "frontend",
      "supabase",
    ],
    blurb: "Product packaging + lead ops ecosystem (Leads Club).",
  },
];

const BY_ID = Object.fromEntries(
  PORTFOLIO.map((p) => [p.id, p]),
) as Record<PortfolioProjectId, PortfolioProject>;

export function getProject(id: PortfolioProjectId): PortfolioProject {
  return BY_ID[id];
}

function haystack(job: Pick<Job, "role" | "description" | "company">): string {
  return `${job.role}\n${job.company}\n${job.description}`.toLowerCase();
}

function scoreProject(
  project: PortfolioProject,
  text: string,
): { hits: number; matched: string[] } {
  const matched: string[] = [];
  for (const kw of project.keywords) {
    if (text.includes(kw.toLowerCase())) matched.push(kw);
  }
  return { hits: matched.length, matched };
}

/**
 * Pick 1–2 proof projects for a job card.
 * Primary = strongest keyword overlap; secondary = next distinct family.
 */
export function matchPortfolio(
  job: Pick<Job, "role" | "description" | "company">,
): { proofs: ProofMatch[]; whyFit: string } {
  const text = haystack(job);
  const ranked = PORTFOLIO.map((project) => {
    const { hits, matched } = scoreProject(project, text);
    return { project, hits, matched };
  })
    .filter((r) => r.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  const proofs: ProofMatch[] = ranked.slice(0, 2).map((r) => ({
    projectId: r.project.id,
    name: r.project.name,
    demoUrl: r.project.demoUrl,
    why: `Matches ${r.matched.slice(0, 3).join(", ")} → ${r.project.blurb}`,
  }));

  let whyFit: string;
  if (proofs.length === 0) {
    whyFit =
      "No strong portfolio keyword hit — lead with sticky pitch + Asema as general fullstack proof.";
  } else if (proofs.length === 1) {
    whyFit = proofs[0].why;
  } else {
    whyFit = `${proofs[0].name} as primary proof; ${proofs[1].name} as secondary angle.`;
  }

  return { proofs, whyFit };
}

/** Portfolio proof points for Fit (0–30): 2 cases = 30, 1 = 20, 0 = 0 */
export function portfolioProofPoints(proofCount: number): number {
  if (proofCount >= 2) return 30;
  if (proofCount === 1) return 20;
  return 0;
}
