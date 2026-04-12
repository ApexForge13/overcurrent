"use client"

import { PropagationGlobeClient } from "@/components/PropagationGlobeWrapper"

const MOCK_TIMELINE = [
  {
    hour: 0,
    label: "+0 hrs",
    description: "Story breaks — VP Vance announces talks failed",
    regions: [
      { region_id: "us", status: "original", coverage_volume: 30, dominant_quote: "Talks have failed after 21 hours", outlet_count: 5, key_outlets: ["Fox News", "CBS News", "NBC News"] },
    ],
    flows: [],
  },
  {
    hour: 2,
    label: "+2 hrs",
    description: "Wire services push globally. Iran blames US.",
    regions: [
      { region_id: "us", status: "original", coverage_volume: 70, dominant_quote: "Iran refused nuclear commitments", outlet_count: 12, key_outlets: ["Fox News", "NYT", "WaPo", "Bloomberg"] },
      { region_id: "uk", status: "wire_copy", coverage_volume: 40, dominant_quote: "Talks collapse in Islamabad", outlet_count: 4, key_outlets: ["BBC", "The Guardian", "Sky News"] },
      { region_id: "ir", status: "original", coverage_volume: 50, dominant_quote: "US made excessive demands", outlet_count: 3, key_outlets: ["PressTV", "Fars News"] },
    ],
    flows: [
      { from: "us", to: "uk", type: "wire_copy" },
      { from: "us", to: "ir", type: "contradicted" },
    ],
  },
  {
    hour: 6,
    label: "+6 hrs",
    description: "Regional coverage spreads. Pakistan claims mediator success.",
    regions: [
      { region_id: "us", status: "original", coverage_volume: 80, dominant_quote: "Iran refused nuclear commitments", outlet_count: 15, key_outlets: ["Fox News", "NYT", "WaPo"] },
      { region_id: "uk", status: "wire_copy", coverage_volume: 50, dominant_quote: "Historic talks end without deal", outlet_count: 5, key_outlets: ["BBC", "The Guardian"] },
      { region_id: "eu", status: "reframed", coverage_volume: 30, dominant_quote: "Energy crisis deepens as Hormuz remains blocked", outlet_count: 3, key_outlets: ["France24", "DW"] },
      { region_id: "ir", status: "original", coverage_volume: 60, dominant_quote: "Iran victorious, US retreats", outlet_count: 5, key_outlets: ["PressTV", "Tasnim", "Fars"] },
      { region_id: "pk", status: "reframed", coverage_volume: 40, dominant_quote: "Pakistan emerges as diplomatic power", outlet_count: 4, key_outlets: ["Dawn", "Geo News"] },
      { region_id: "me", status: "wire_copy", coverage_volume: 35, dominant_quote: "Talks fail, region braces for escalation", outlet_count: 3, key_outlets: ["Al Jazeera", "Al Arabiya"] },
    ],
    flows: [
      { from: "us", to: "eu", type: "reframed" },
      { from: "us", to: "pk", type: "reframed" },
      { from: "ir", to: "me", type: "wire_copy" },
    ],
  },
  {
    hour: 12,
    label: "+12 hrs",
    description: "Narratives fully diverge. Trump announces naval blockade.",
    regions: [
      { region_id: "us", status: "original", coverage_volume: 90, dominant_quote: "Trump orders Hormuz blockade", outlet_count: 18, key_outlets: ["Fox News", "NYT", "WaPo", "CNN"] },
      { region_id: "uk", status: "reframed", coverage_volume: 55, dominant_quote: "Allies alarmed by blockade threat", outlet_count: 6, key_outlets: ["BBC", "The Guardian", "FT"] },
      { region_id: "eu", status: "reframed", coverage_volume: 45, dominant_quote: "EU energy crisis if Hormuz closes", outlet_count: 5, key_outlets: ["France24", "DW", "Euronews"] },
      { region_id: "ir", status: "original", coverage_volume: 70, dominant_quote: "US aggression proves bad faith", outlet_count: 6, key_outlets: ["PressTV", "Tasnim"] },
      { region_id: "ru", status: "reframed", coverage_volume: 30, dominant_quote: "US hegemony crumbling", outlet_count: 2, key_outlets: ["RT", "TASS"] },
      { region_id: "cn", status: "reframed", coverage_volume: 25, dominant_quote: "Unilateral US action destabilizes region", outlet_count: 2, key_outlets: ["Xinhua", "Global Times"] },
      { region_id: "in", status: "wire_copy", coverage_volume: 35, dominant_quote: "India watches as Pakistan gains influence", outlet_count: 4, key_outlets: ["The Hindu", "NDTV"] },
      { region_id: "pk", status: "reframed", coverage_volume: 50, dominant_quote: "Pakistan's finest diplomatic hour", outlet_count: 5, key_outlets: ["Dawn", "Geo News", "Express Tribune"] },
      { region_id: "me", status: "reframed", coverage_volume: 40, dominant_quote: "Region braces for wider conflict", outlet_count: 4, key_outlets: ["Al Jazeera", "Jerusalem Post"] },
      { region_id: "il", status: "original", coverage_volume: 30, dominant_quote: "Iran nuclear threat persists", outlet_count: 3, key_outlets: ["Jerusalem Post", "Haaretz"] },
    ],
    flows: [
      { from: "us", to: "ru", type: "reframed" },
      { from: "us", to: "cn", type: "reframed" },
      { from: "pk", to: "in", type: "wire_copy" },
      { from: "ir", to: "ru", type: "reframed" },
      { from: "us", to: "il", type: "wire_copy" },
    ],
  },
  {
    hour: 24,
    label: "+24 hrs",
    description: "Final state — 8 incompatible narratives across the globe.",
    regions: [
      { region_id: "us", status: "original", coverage_volume: 95, dominant_quote: "Iran's intransigence to blame", outlet_count: 20, key_outlets: ["Fox News", "NYT", "WaPo"] },
      { region_id: "uk", status: "reframed", coverage_volume: 60, dominant_quote: "Both sides share blame", outlet_count: 7, key_outlets: ["BBC", "The Guardian"] },
      { region_id: "eu", status: "reframed", coverage_volume: 50, dominant_quote: "Europe sidelined, energy at risk", outlet_count: 6, key_outlets: ["France24", "DW"] },
      { region_id: "ir", status: "original", coverage_volume: 80, dominant_quote: "Iran stands firm against US bullying", outlet_count: 7, key_outlets: ["PressTV", "Tasnim"] },
      { region_id: "ru", status: "reframed", coverage_volume: 40, dominant_quote: "Multipolar order emerging", outlet_count: 3, key_outlets: ["RT", "TASS"] },
      { region_id: "cn", status: "reframed", coverage_volume: 35, dominant_quote: "US overreach creates opportunity", outlet_count: 3, key_outlets: ["Xinhua", "Global Times"] },
      { region_id: "in", status: "reframed", coverage_volume: 40, dominant_quote: "Pakistan's gain is India's concern", outlet_count: 5, key_outlets: ["The Hindu", "NDTV", "Times of India"] },
      { region_id: "pk", status: "reframed", coverage_volume: 55, dominant_quote: "Historic moment for Pakistani diplomacy", outlet_count: 6, key_outlets: ["Dawn", "Geo News"] },
      { region_id: "me", status: "reframed", coverage_volume: 45, dominant_quote: "Region prepares for prolonged crisis", outlet_count: 5, key_outlets: ["Al Jazeera", "Al-Monitor"] },
      { region_id: "il", status: "original", coverage_volume: 35, dominant_quote: "Nuclear threat demands action", outlet_count: 3, key_outlets: ["Jerusalem Post", "Haaretz"] },
      { region_id: "jp", status: "wire_copy", coverage_volume: 15, dominant_quote: "Oil supply fears mount", outlet_count: 2, key_outlets: ["Nikkei", "Japan Times"] },
      { region_id: "la", status: "wire_copy", coverage_volume: 10, dominant_quote: "Markets react to failed talks", outlet_count: 1, key_outlets: ["La Nación"] },
      { region_id: "af", status: "wire_copy", coverage_volume: 10, dominant_quote: "Wire coverage only", outlet_count: 2, key_outlets: ["Punch Nigeria", "News24"] },
      { region_id: "au", status: "wire_copy", coverage_volume: 8, dominant_quote: "Oil supply concerns mount", outlet_count: 1, key_outlets: ["ABC Australia"] },
      { region_id: "mx", status: "wire_copy", coverage_volume: 5, dominant_quote: "Diplomacia fracasa en Islamabad", outlet_count: 1, key_outlets: ["El Universal"] },
    ],
    flows: [
      { from: "us", to: "jp", type: "wire_copy" },
      { from: "us", to: "la", type: "wire_copy" },
      { from: "ir", to: "cn", type: "reframed" },
      { from: "me", to: "af", type: "wire_copy" },
    ],
  },
]

export default function TestGlobePage() {
  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '24px' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
        Globe Test — Mock Data
      </h1>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '24px' }}>
        Testing propagation globe with simulated Islamabad talks data. No API calls.
      </p>
      <PropagationGlobeClient
        timeline={MOCK_TIMELINE}
        storyHeadline="US-Iran Peace Talks in Pakistan Collapse After 21 Hours"
      />
    </div>
  )
}
