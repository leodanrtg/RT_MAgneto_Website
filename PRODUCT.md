# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static site with Three.js for 3D and GSAP (ScrollTrigger) for scroll-driven motion, confirmed by the user. The build tool (e.g. Vite or Astro) is delegated. No domain or hosting yet: the user still has to buy a domain, so the site must deploy to any static host.

## Users

- **Primary:** retail and semi-professional futures traders (ES, NQ, RTY, YM, GC and similar) who want to use options-market data to make trading decisions. They are on the site to judge whether RT Magneto gives them an edge and works on the platform they already trade on.
- **Secondary:** traders who are curious about options-flow concepts (gamma exposure, dealer hedging, 0DTE) but don't yet understand them. They arrive to learn, and the site should educate them and capture them as leads.

## Product Purpose

RT Magneto is an indicator/tool, installed on the trader's charting platform, that displays options-market positioning data for the 0DTE and 90DTE expirations. It shows the exposure and hedging levels of the Market Maker and dealers so the trader can see:

- zones of high gamma exposure;
- levels and structures that act as magnets for price;
- clarity on the trend or direction of the session, through an additional options-market sentiment indicator.

The website has two jobs: **sell RT Magneto** and **educate and capture an audience** interested in trading futures with options-market data. Success means visitors who understand the concept, trust the tool, and either buy or join the audience.

## Positioning

RT Magneto loads options-derived Greeks (Gamma, Delta, Vanna and Charm) from the options markets directly onto the futures chart, mapping each options underlying onto its futures market:

- Options sources: SPX, SPY, NDX, QQQ, RUT, IWM, DIA, GLD, USO.
- Futures targets: ES, NQ, RTY, YM, GC, CL.

Other differentiators the user named:

- A **gamma exposure ladder** viewable both by volume and by imbalances.
- **Historical data / traces** showing where maximum gamma exposure formed the session's highs.

## Operating Context

- Runs inside the trader's existing platform: **NinjaTrader** and **ATAS** today, **Bookmap** coming soon. It is sold as an installable indicator, not a standalone web app.
- Used live during the trading session, especially intraday around 0DTE expirations, alongside the trader's normal futures charts.

## Capabilities and Constraints

- Confirmed: 0DTE and 90DTE expirations; Gamma, Delta, Vanna, Charm; Market Maker/dealer exposure and hedging levels; gamma magnet levels; session sentiment indicator; gamma ladder by volume and imbalance; historical max-gamma traces.
- Platform support claims must stay exact: NinjaTrader and ATAS available, Bookmap "coming soon" only.
- Lead capture happens through YouTube, TikTok and Telegram, plus the website itself; the site should funnel visitors to these channels and capture leads directly.
- Payments: PayPal and crypto stablecoins (USDT, USDC). Payment provider for crypto, networks and checkout implementation are not yet chosen.
- Open decisions: price amounts and licensing model, crypto payment provider and networks, trial or demo availability, the website's own lead-capture form (newsletter, PDF download gate, etc.), channel URLs, and the domain.

## Brand Commitments

- Name: **RT Magneto** (written "RT MAGNETO" by the user in places; final casing to confirm).
- The site is in Spanish (the user communicates in Spanish; additional languages not yet requested).
- Experience requirement: scroll-driven 3D site, as the user explicitly requested.
- No logo or other identity assets have been provided yet.

## Evidence on Hand

- Educational material in **PDF** format: three slide decks on options order flow, convexity, GEX, Zero Gamma, imbalance magnets, the sentiment indicator and a GEX trading playbook (regimes, key levels, scenarios, risk rules), stored in `content/source/`, plus the text of a ChatGPT conversation on trading ES with 0DTE gamma (Zero Gamma as pivot, 0DTE vs 98DTE, magnet vs support/resistance) saved there as Markdown. Their content is distilled into Spanish, section-ready copy in [`content/educacion.md`](content/educacion.md), which also lists open questions to confirm before publishing. One deck states 70–80% success rates; those figures are unverified and stay out of site copy.
- A **video** explaining how the tool works (not yet in the repo).
- No testimonials, customer counts, performance results, screenshots, or press have been provided. Future work must not fabricate any of these, and must not imply trading results or returns.

## Product Principles

1. **Show the mechanism, not hype.** Make gamma exposure and dealer hedging visible and understandable; the tool's credibility comes from the data, not from promises of profit.
2. **Educate to sell.** The learning path (concepts → how RT Magneto shows them → how to use them) is the sales funnel.
3. **Speak the futures trader's language.** Anchor everything in the markets they trade (ES, NQ, RTY, YM, GC) and the platforms they already use.
4. **Be precise about claims.** Platform support, markets, and Greeks are stated exactly as they are; nothing is overstated.

## Accessibility & Inclusion

- Trading tools carry financial risk; the site should include a clear risk disclaimer (exact wording to be supplied or approved by the user).
- The 3D scroll experience must respect `prefers-reduced-motion` and keep all content readable without the 3D layer.
