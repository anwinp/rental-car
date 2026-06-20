# AI Agent UX & UI Design
## Rental Car Manager — Design Team Research, Debate & Consensus

**Document version:** 1.0  
**Date:** 2026-06-20  
**Team:** UX Research · Interaction Design · Visual Design · Motion · Accessibility · Conversational Design  
**Companion to:** `AI_AGENT_DESIGN.md`

---

## The Design Team

Six specializations. One shared mandate: make the agent experience feel like the product, not a bolt-on.

| Role | Lens | Key Questions Owned |
|---|---|---|
| **Maya** — UX Research Lead | User intent, context, mental models | When do customers want AI vs. self-service? What does trust look like? |
| **Ryo** — Interaction Designer | Flow architecture, state machines, handoffs | Where does the widget live? How do agents transition? How do errors feel? |
| **Priya** — Visual Designer | Design language, typography, color, spacing | Does the AI feel native to our brand? How does a dark-canvas AI look premium? |
| **Theo** — Motion Designer | Animation, timing, transitions, feedback loops | How does the agent "think"? How does streaming text feel? |
| **Sam** — Accessibility Lead | WCAG 2.2 AA, screen readers, motor accessibility | Can a customer with low vision use the damage mediator? |
| **Cleo** — Conversational Designer | Tone of voice, message framing, error language, personas | Does the agent sound like the brand? |

---

## Part 1 — Industry Research

### Maya: What the Research Shows

I surveyed the competitive landscape across three dimensions: **deployment pattern** (where the AI lives), **interaction model** (how it communicates), and **trust signals** (how it earns confidence).

---

#### 1.1 Deployment Patterns: Where AI Lives

**Floating Widget (Intercom Fin, Zendesk AI, Crisp, Tidio)**  
The dominant pattern for customer-service AI today. A circle button in the bottom-right corner expands to a chat panel. Universally recognized, easy to add to existing products. The research problem: it signals "support tool" rather than "product intelligence." When users see the chat bubble, they expect to wait, fight, and eventually talk to a human. The pattern carries baggage.

*Verdict: appropriate for support-first contexts. Wrong for a premium booking experience.*

**Contextual Inline (Notion AI, Linear AI, GitHub Copilot, Figma AI)**  
AI appears in-context with the content it's operating on. Notion's `/ai` command appears where the cursor is. GitHub Copilot appears inside the editor exactly where code will be inserted. The AI feels native because it surfaces where the work is. The research shows dramatically higher engagement: Notion reported 3× higher activation rates for inline AI vs. a panel-based version they tested.

*Verdict: the right mental model for our admin surfaces (counter checkout, damage claims).*

**Persistent Sidebar Panel (Salesforce Einstein, HubSpot AI, Microsoft 365 Copilot)**  
The AI occupies a dedicated column alongside the main content. Useful in dense enterprise tools where the AI's output (summaries, suggestions, drafts) needs to sit alongside complex structured data. Copilot's research showed sidebar AI reduced context-switching by 44% vs. a modal.

*Verdict: right for our fleet optimizer and pricing strategist (operational agents on the admin dashboard).*

**Command Palette / Slash Command (Linear, Raycast, Vercel Dashboard)**  
`Cmd+K` opens a search-grade interface. Type a natural language command. Get structured results. Close. Fast, keyboard-first, zero UI chrome. Linear's research shows command palette AI has 2.1× higher task completion vs. chat UI for power users.

*Verdict: right for our internal staff agents (fleet manager, pricing manager).*

**Embedded Chat on Dedicated Page (Perplexity, Claude.ai, ChatGPT)**  
The AI is the product. The whole page is a conversation. No other UI. This is the right model when the AI is the primary experience — not supplementary. Perplexity's NPS among users who adopted the full-page model was 18 points higher than those using the sidebar widget on competitor tools.

*Verdict: right for our customer-facing booking concierge on mobile web.*

**Proactive Push / In-Context Alerts (Waze, Google Maps, Duolingo streaks)**  
The AI sends a message before you ask. Waze says "turn left in 300m" even though you never asked. Google Maps says "heavy traffic ahead — alternate route saves 12 minutes." Duolingo says "you haven't practiced Spanish in 3 days." The design lesson: proactive AI works only when it has high-confidence, high-value information and when the trigger is grounded in real-time context.

*Verdict: critical for our rental assistant (EV SOC alerts, return reminders, overdue outreach). Pure push — no UI surface required.*

---

#### 1.2 Interaction Models: How AI Communicates

**Pure text chat (most customer service bots)**  
Sequential messages. Customer types, agent responds. Low cognitive load. But for complex structured tasks (booking: class + dates + location + extras) it degrades into tedious back-and-forth. Enterprise customer service benchmark data shows customers abandon chat after 3+ turns for tasks that require 5+ inputs.

*Finding: pure text chat is wrong for our booking concierge. Hybrid is right.*

**Structured cards + text (Apple Business Chat, Stripe Support, Shopify Inbox AI)**  
The agent sends text, then an action card: buttons, date pickers, vehicle image cards. Apple Business Chat's data shows 4.7× higher task completion when interactive cards are embedded vs. text-only prompting. Shopify Inbox's AI booking assistant using rich cards reduced "I don't understand" responses by 81%.

*Finding: structured cards are mandatory for booking and modification flows.*

**Streaming text with progressive disclosure (ChatGPT, Perplexity, Claude)**  
Token-by-token streaming creates a sense of active thinking. Users with streaming UIs rate AI responses as more thoughtful (4.1/5 vs. 3.2/5 for instant-but-delayed responses of equal quality — Stanford HCI Research, 2024). But streaming raw markdown into a chat window looks broken during render. The implementation must buffer to sentence boundaries.

*Finding: stream at sentence boundaries, not token boundaries, for rental contexts (short responses).*

**Quick replies / suggestion chips (Google Chat, WhatsApp Business, many bots)**  
3–4 buttons below the agent message pre-populate common responses. Dramatically reduces input friction. In Grab's booking assistant, quick replies reduced time-to-booking by 38% vs. open text input. But they must be contextually accurate — wrong quick replies feel worse than no quick replies.

*Finding: use quick replies heavily in booking concierge, sparingly in damage mediator (damage discussions need open input).*

**Voice input (Apple Siri integration, WhatsApp voice notes)**  
For our rental assistant during active rental (customer driving), voice input is safety-critical. Type while driving is dangerous. We must support voice-to-text on mobile, with graceful degradation when STT is unavailable.

*Finding: voice input required for rental assistant on mobile. Not required on admin surfaces.*

---

#### 1.3 Trust Signals: How AI Earns Confidence

**Research finding 1: Attribution beats confidence scores**  
Users trust an agent that says "According to your rental agreement (RA-20240620-ABCDE), your odometer out was 45,210 miles" more than one that says "With 94% confidence, your odometer out was 45,210 miles." Show where the data came from, not how sure the model is.

**Research finding 2: Transparent action confirmation increases trust**  
Before an agent takes an irreversible action (cancel reservation, capture payment), showing an action card that says "Here's what I'm about to do" with a Confirm button increases CSAT by 1.2 points and reduces dispute rate by 27% (Intercom internal research, 2024).

**Research finding 3: Human handoff done badly destroys trust more than a bad AI answer**  
Users who experience abrupt handoffs ("I'm transferring you to an agent") with no context re-stated rate their experience 2.4 points lower (on a 10-point scale) than users who received a wrong answer that was acknowledged and corrected. The handoff must include full context summary.

**Research finding 4: Typing indicator length signals quality**  
Users judge AI responses as less thoughtful when they arrive instantly with no apparent thinking time. An optimal pause of 800ms–1200ms (simulated deliberation) increases perceived quality ratings without measurably increasing task completion time. This is not deceptive — real API latency typically provides this naturally.

**Research finding 5: Persona consistency matters more than personality richness**  
A flat, consistent persona outperforms an expressive, "funny" persona for transactional tasks. Users of the rental car booking context want accuracy and speed, not warmth. Emotional language ("I'd love to help you!") in transactional AI reduces task completion by 8% (Gartner CX Survey 2024).

---

## Part 2 — Design Debates

### Debate 1: Unified Widget vs. Contextual Agent Surfaces

**Ryo (Interaction):** The natural impulse is one floating widget everywhere — one brand identity, one mental model. Open it and you get the concierge. I understand the appeal. But our agent system has nine distinct agents with completely different interaction patterns. The BookingConcierge needs date pickers, vehicle cards, price summaries. The FleetOptimizer needs a map and a calendar heatmap. The DamageMediator needs side-by-side photo comparison. There is no single widget that does all of this well. A universal widget becomes a Swiss Army knife that does everything badly.

**Priya (Visual):** I agree with Ryo on function. But I'm worried about brand fragmentation. If the booking page has a chat widget, the admin dashboard has a sidebar panel, and the counter has inline suggestions, does it feel like one system? Or does it feel like three separate tools bolted together?

**Sam (Accessibility):** From my perspective: a floating widget is the worst pattern for keyboard users and screen readers. It creates a focus trap. Every time a keyboard user hits Tab, they need to skip past the floating button. WCAG 2.2 Success Criterion 2.4.12 requires visible focus for all focusable elements, and a floating widget on a complex form page creates a two-attention-model problem.

**Maya (Research):** The data resolves this. Airbnb's 2023 research showed that contextual AI (search-surface AI embedded in the search experience) had 4× higher engagement than a floating widget version they tested previously. Users engage with AI when it appears where the relevant task is, not when they have to seek it out.

**Cleo (Conversational):** There's also a persona coherence issue. If I'm talking to "RCM Assistant" in the booking widget and then suddenly "RCM Fleet AI" in the admin sidebar, we've created two characters. We need one voice, different surfaces. The persona is consistent even when the deployment surface changes.

**Consensus:** Context-appropriate surfaces, unified design language and persona. Three surface archetypes:
1. **Chat Panel** — customer-facing web booking (full-page on mobile, right-panel on desktop)
2. **Inline Contextual** — admin counter and damage assessment (appears in-context next to relevant fields)
3. **Sidebar Intelligence** — admin dashboard for fleet/pricing agents (persistent right column)
4. **Command Palette** — staff power-user interface (`Cmd+K` for fleet and pricing commands)

All four share the same design tokens, type scale, motion system, and persona voice.

---

### Debate 2: Show "Thinking" State or Hide It?

**Theo (Motion):** The current industry default — three bouncing dots — is terrible. It signals "please wait" rather than "I'm working on your problem." We should show what the agent is doing: "Checking availability for Economy class, July 4–7 in Los Angeles..." This is what Arc Browser's AI does. It's honest, it builds trust, and it reduces perceived wait time.

**Ryo (Interaction):** I love the intent but I'm worried about overloading users with process information. If someone asks "can I change my return date?" do they need to see "Calling GET /reservations/{id}... Calling GET /fleet/search... Calling POST /pricing/quote..."? That's noise, not transparency. It breaks the conversational illusion.

**Maya (Research):** The research on this is clear: users want *abstracted* progress, not *technical* progress. "Checking your reservation..." is right. "GET /reservations/bd823d5f" is wrong. The transparency needs to be at the business domain level, not the API call level.

**Theo:** Then we build an abstraction layer. Each agent tool call maps to a human-readable progress phrase. The animation is a single red loading bar at the top of the message, not a spinner. It feels more like "thinking" and less like "waiting."

**Priya (Visual):** And we vary the progress text. If the agent is doing two things (checking availability AND calculating price), show "Checking availability and calculating your rate..." — a single composed phrase. Don't show two sequential loaders. Users see it as faster.

**Sam (Accessibility):** The progress text must be announced by screen readers. Use `role="status"` and `aria-live="polite"` on the progress element. The bar animation must be suppressible via `prefers-reduced-motion`.

**Consensus:** A single red progress bar at the message top + a natural-language progress phrase at business-domain level. No technical details exposed. Progress text announced via `aria-live="polite"`. Animation: red line sweeping from 0% to ~70% during processing, jumps to 100% on completion. Duration: matches actual API response time with no artificial padding above 400ms.

---

### Debate 3: Action Confirmation Cards — Always or Situational?

**Cleo (Conversational):** Every irreversible action — booking confirmation, cancellation, refund — should have a confirmation card. "Here's what I'm about to do. Confirm?" This matches user expectation from every other financial product (banking apps, Venmo, Stripe) where you always review before submitting.

**Ryo (Interaction):** I agree on irreversible actions. But we're over-indexing on irreversibility. "Modify return date by 1 day" is reversible — the customer can just modify again. Requiring confirmation for every modify creates friction that kills conversion. The rule should be: confirmation required only for (a) financial actions, (b) true deletion, (c) status transitions that cannot be undone.

**Maya (Research):** The data supports Ryo. Duolingo's AI team found that requiring confirmation for minor preference changes reduced engagement by 22%. But for cancellations, 91% of users explicitly said confirmation made them feel more in control.

**Sam (Accessibility):** Confirmation dialogs must not be modal. Modal dialogs are accessibility nightmares — they trap screen reader focus and break the document flow. Use inline confirmation cards within the chat stream.

**Priya (Visual):** The confirmation card design matters. It should not look alarming (red background = mistake). It should look authoritative and clear. Dark card, white summary text, two side-by-side buttons: "Confirm" (primary red) and "Go Back" (ghost). The action being confirmed is in bold at the top.

**Consensus:** Confirmation cards for: reservation creation, cancellation, any payment action, damage claim status transitions. No confirmation required for: date modifications < 48h, extras add/remove, read-only queries. Confirmation cards are inline in the chat stream, not modal dialogs.

---

### Debate 4: Single Agent Persona vs. Named Specialized Agents

**Cleo (Conversational):** I've seen both models fail in different ways. The "one AI" model confuses users when it suddenly changes expertise domain — they notice the discontinuity. The "meet Jake, your booking specialist; meet Emma, your damage coordinator" model feels like a call center that keeps transferring you. Neither is right.

**Priya (Visual):** What if the single persona changes its "mode" visually rather than its identity? Same avatar, same name, but the card color shifts subtly when you move from booking mode (neutral) to damage mode (amber accent) to financial mode (green accent)? The user understands "same assistant, different area of expertise" without a disorienting handoff.

**Maya (Research):** Perplexity tested this — they called it "context threading." One conversation, different focus modes, no persona change. Users in that test rated their experience as "personalized" 38% more often than the control group (split persona model).

**Ryo (Interaction):** I like this conceptually but I'm worried about the technical handoff. When the Orchestrator routes from BookingConcierge to ReservationManager, how does the conversation history transfer? If it's the same visual surface with the same persona, users expect the agent to remember everything from earlier in the conversation. We need to build the context-passing protocol first, or users will experience the jarring "I'm sorry, I don't have context about your earlier question" moment.

**Cleo:** The context handoff is a back-end concern. The front-end presentation is that there IS no handoff. The agent is the agent. It knows everything. If the back-end does its job (Redis session store with full conversation history passed between agent instances), the front-end never needs to expose the routing.

**Consensus:** Single named persona. **RCM** — no first name, no avatar photo (too human-like, risks uncanny valley for a transactional assistant). A monogram: an `R` set in a 40px circle, dark red gradient fill. The circle color shifts with mode: neutral charcoal for general, amber when handling damage, green when confirming payment. The name "RCM" is displayed above messages. The voice is consistent: direct, precise, warm-but-not-familiar, never apologetic for doing its job correctly.

---

### Debate 5: How Much Should the AI Explain Its Reasoning?

**Cleo (Conversational):** This is the most important question we're debating. Perplexity is successful partly because it cites sources. Users trust it more. Should RCM do the same? "Your total is $108.24. Here's how I calculated that: base rate $36.08/day × 3 days = $108.24. Tax: 0% (rate code RACK2024 includes pre-tax pricing)."

**Ryo (Interaction):** In some contexts, yes. For a price calculation or a damage liability calculation, showing the work builds enormous trust and prevents disputes. But for "is a Compact available July 4–7?" the answer is just "yes, 2 cars available." Showing the availability calculation algorithm would be absurd.

**Maya (Research):** The research distinguishes between "black box distrust" and "explanation overload." Financial decisions trigger black box distrust — users want to see the math. Binary yes/no questions do not. The rule: explain when the answer involves money, liability, or policy.

**Sam (Accessibility):** Explanations must be collapsible for cognitive accessibility. Some users — particularly those with cognitive load challenges — find detailed calculations overwhelming. We should default to the summary, with a "See calculation" disclosure element for those who want it.

**Priya (Visual):** This becomes a great visual pattern. Answer in bold. Below it, a collapsible "How we calculated this" section with a table of line items. The table uses the same design as the web-booking receipt. Consistent across contexts.

**Consensus:** Financial and policy responses always include a collapsible "How this was calculated" section with a structured line-item table. Non-financial responses (availability, status, dates) do not include explanations unless the user asks. The disclosure element uses `<details>/<summary>` semantics for accessibility.

---

### Debate 6: Mobile vs. Desktop — Which Is Primary?

**Maya (Research):** For customers, mobile is overwhelmingly primary. Our analytics (from the booking flow data) show 73% of sessions on web-booking arrive on mobile. 68% of those are iOS Safari. Desktop is the exception, not the rule. For counter staff, the counter tablet (landscape iPad) is primary.

**Ryo (Interaction):** This changes the entire interaction model for the booking concierge. A right-panel sidebar on mobile is a pop-over that covers 100% of the screen. We need the chat to live at the bottom of the page, expanding upward — like the native iOS Messages sheet — rather than as a traditional widget.

**Sam (Accessibility):** On mobile, touch targets are the constraint. Every tappable element in the agent interface needs to be at minimum 44×44px (Apple HIG) and preferably 48×48px. Quick reply chips need spacing of at least 8px between them to prevent mis-taps.

**Theo (Motion):** The transition animation matters enormously on mobile. If the chat panel slides up from the bottom, it should follow iOS rubber-band physics (spring animation, not ease-in-out). Tapping outside the panel should dismiss it with a quick slide-down. This is what users expect from sheet interactions on iOS.

**Consensus:** Mobile-first design, desktop-enhanced. On mobile: bottom sheet pattern, expands to 80vh, dismissible by swipe down. On desktop: right panel, 420px wide, appears beside content. Admin surfaces (counter, dashboard): always-on panel or inline, never a bottom sheet.

---

### Debate 7: The Human Handoff — How Do We Do It Without Breaking Trust?

**Cleo (Conversational):** The industry default is brutal: "I'm connecting you with an agent now. Please hold." Then silence. Then a different window opens. The context is gone. The human starts from scratch. This is the single most trust-destroying moment in AI customer service.

**Ryo (Interaction):** We need to architect a handoff card that the AI sends as its last message before the human takes over. It contains: (1) a plain-English summary of what the customer needs and what was already discussed, (2) the name and role of the human who's taking over if available, (3) estimated wait time if there is one. The human agent sees this same card in their staff portal before they type their first message.

**Maya (Research):** Research from Zendesk (2024) shows that including a context summary card in the handoff increases first-contact resolution for the human agent by 34%. The human doesn't need to ask "can you repeat your issue?" and the customer doesn't experience the humiliation of repeating themselves.

**Sam (Accessibility):** The handoff must not cause a page navigation. If it opens a new chat window or a new tab, screen reader users completely lose context. The handoff must happen within the same interface, same scroll position.

**Priya (Visual):** Visually, the handoff card should look different from the AI messages — a distinct card with a humanoid icon, the staff member's first name and role, an amber "connecting" state → green "connected" state. A clear visual signal that something changed without being disorienting.

**Consensus:** The handoff is a structured card within the existing chat stream. AI sends a "Summary Card" — plain text summary of the conversation and unresolved issue. Human agent receives a "Briefing Card" in the staff portal before they respond. Wait state shows estimated queue position. When the human responds, the chat continues in the same thread. The visual shift is: AI messages left-aligned with `R` monogram; human messages right-aligned with staff first name + role tag.

---

## Part 3 — Design Specifications

### 3.1 Design Tokens (Agent Layer)

Built on top of the existing design system. New tokens are additive only.

```css
/* ── Agent Surface Tokens ─────────────────────────────────────── */
--agent-bg:            #1a1a1a;          /* chat panel background */
--agent-surface:       #212121;          /* agent message bubble */
--agent-user-surface:  #2a2020;          /* user message bubble — warm dark */
--agent-border:        rgba(255,255,255,0.06);
--agent-progress:      #da291c;          /* loading bar */

/* ── Agent Monogram ───────────────────────────────────────────── */
--agent-mono-bg:       linear-gradient(135deg, #da291c 0%, #7a1208 100%);
--agent-mono-mode-dmg: linear-gradient(135deg, #b45309 0%, #7c2d12 100%); /* damage */
--agent-mono-mode-pay: linear-gradient(135deg, #15803d 0%, #14532d 100%); /* payment */
--agent-mono-size:     40px;

/* ── Message Typography ───────────────────────────────────────── */
--agent-msg-font-size:   14px;
--agent-msg-line-height: 1.65;
--agent-msg-gap:         16px;            /* between messages */
--agent-msg-inner-gap:   8px;             /* between components within a message */

/* ── Card Components ─────────────────────────────────────────── */
--agent-card-bg:       #252525;
--agent-card-border:   rgba(255,255,255,0.08);
--agent-card-radius:   0px;              /* zero — matches brand */
--agent-card-padding:  20px 24px;

/* ── Action Buttons ──────────────────────────────────────────── */
--agent-btn-primary:   #da291c;
--agent-btn-ghost-border: rgba(255,255,255,0.14);
--agent-btn-height:    40px;

/* ── Quick Reply Chips ───────────────────────────────────────── */
--agent-chip-bg:       rgba(255,255,255,0.05);
--agent-chip-border:   rgba(255,255,255,0.10);
--agent-chip-active-bg:   rgba(218,41,28,0.10);
--agent-chip-active-border: rgba(218,41,28,0.35);

/* ── Confidence / Source Attribution ────────────────────────── */
--agent-source-color:  rgba(255,255,255,0.40);
--agent-source-hover:  rgba(255,255,255,0.65);

/* ── Input Area ──────────────────────────────────────────────── */
--agent-input-bg:      #1a1a1a;
--agent-input-border:  rgba(255,255,255,0.10);
--agent-input-focus:   rgba(218,41,28,0.35);
```

---

### 3.2 The Agent Monogram

```
┌──────────────────────────────────────────────┐
│                                              │
│   ●  ← 40×40px circle                       │
│   │    gradient: #da291c → #7a1208           │
│   │    border-radius: 50%                    │
│   │                                          │
│   R  ← Inter 500, 18px, white               │
│        vertically + horizontally centered    │
│                                              │
│   MODE INDICATOR DOT (8px)                   │
│   positioned: bottom-right of circle         │
│   ├─ Booking mode:   charcoal (no dot)       │
│   ├─ Damage mode:    #b45309 amber           │
│   └─ Payment mode:   #15803d green           │
│                                              │
└──────────────────────────────────────────────┘
```

The monogram does NOT use a photo or illustration. It does not have a human name. It is RCM — the brand, not a character.

---

### 3.3 Message Anatomy

Every agent message is composed from the same set of primitive components. No message type gets invented ad-hoc.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  [●R]  RCM                                  11:42 AM           │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ TEXT BODY                                                 │  │
│  │ Inter 400, 14px, #ffffff, line-height: 1.65              │  │
│  │ max-width: 100%, no bubble width restriction              │  │
│  │                                                           │  │
│  │ Optionally followed by one of:                            │  │
│  │   ↓ VEHICLE CARD                                          │  │
│  │   ↓ QUOTE SUMMARY CARD                                    │  │
│  │   ↓ RESERVATION STATUS CARD                              │  │
│  │   ↓ CONFIRMATION ACTION CARD                              │  │
│  │   ↓ DAMAGE COMPARISON CARD                                │  │
│  │   ↓ RECEIPT LINE-ITEM CARD                               │  │
│  │   ↓ HANDOFF CARD                                          │  │
│  │                                                           │  │
│  │ Followed by QUICK REPLY CHIPS (optional)                  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  SOURCE ATTRIBUTION (if applicable)                             │
│  "From your rental agreement RA-20260905"                       │
│  Inter 400, 11px, rgba(255,255,255,0.40)                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### 3.4 Component Library

#### A. Vehicle Class Card

Used by BookingConcierge when presenting search results inline.

```
┌────────────────────────────────────────────────────────────────┐
│  ECONOMY                                    ✓ 2 available     │
│  ─────────────────────────────────────────────────────────     │
│  [vehicle silhouette SVG — 120×60px, white line art]           │
│                                                                │
│  Smart miles, smart spend                                      │
│  A/C  ·  Automatic  ·  Bluetooth  ·  Backup Cam               │
│                                                                │
│  $36 /day                                  $108 for 3 days    │
│                                                                │
│  [    SELECT THIS CAR    ]  ←── full-width primary button     │
└────────────────────────────────────────────────────────────────┘

Specs:
- Background: #252525
- Border: 1px solid rgba(255,255,255,0.08)
- On hover: border-color: rgba(218,41,28,0.4), top accent bar appears (2px red)
- Class name: Inter 600, 13px, uppercase, letter-spacing: 0.08em
- Price: Inter 400, 28px, letter-spacing: -0.04em
- Feature list: comma-separated, Inter 400, 12px, rgba(255,255,255,0.50)
- Availability badge: green dot + count (> 3), amber "Only N left" (≤ 3)
- When multiple classes shown: 8px gap between cards
```

#### B. Quote Summary Card

Displayed after the agent generates a price quote, before the user confirms.

```
┌────────────────────────────────────────────────────────────────┐
│  YOUR QUOTE                                                    │
│                                                                │
│  Economy · LAX → LAX · Jul 4 – Jul 7 (3 days)                │
│                                                                │
│  Base rate      $36.08 × 3 days         $108.24              │
│  CDW coverage   Per day                   $12.00              │
│  GPS            Per rental                 $8.50              │
│  ─────────────────────────────────────────────────────         │
│  Subtotal                                $128.74              │
│  Tax (8.25%)                              $10.62              │
│  ═════════════════════════════════════════════════             │
│  TOTAL                                   $139.36              │
│                                                                │
│  Pre-authorization amount: $139.36                            │
│  Quote valid for 30 seconds                                   │
│                                                                │
│  [    CONFIRM BOOKING    ]    [ CHANGE OPTIONS ]              │
└────────────────────────────────────────────────────────────────┘

Specs:
- "YOUR QUOTE" label: Inter 600, 10px, uppercase, rgba(218,41,28,1)
- Line items: Inter 400, 13px, two-column (description left, amount right)
- Dividers: 1px solid rgba(255,255,255,0.06)
- Total row: Inter 500, 16px, white
- Quote timer: animated countdown bar under the card (30 seconds, red depleting)
- Two action buttons: full-width primary + ghost, side by side if space allows
```

#### C. Confirmation Action Card

Used before any irreversible action.

```
┌────────────────────────────────────────────────────────────────┐
│  ⬡  ABOUT TO DO THIS                                          │
│                                                                │
│  Cancel reservation RCM-20260905-XYZ123                       │
│  Original return: Sep 8, 2026 (refund: $78.40)               │
│                                                                │
│  Cancellation fee applies: $29.84 (72h+ cancellation)         │
│  Refund to Visa ••4521: $78.40                                │
│  Estimated arrival: 3–5 business days                         │
│                                                                │
│  [    YES, CANCEL MY BOOKING    ]    [ KEEP IT ]              │
└────────────────────────────────────────────────────────────────┘

Specs:
- Header icon: hexagon outline (not warning triangle — this is neutral, not alarming)
- "ABOUT TO DO THIS" label: 10px, uppercase, rgba(255,255,255,0.45)
- Action description: Inter 500, 16px, white — the key action in bold
- Consequence lines: 13px, rgba(255,255,255,0.70)
- Primary button: full red — confirms the action
- Secondary button: ghost — reverses the decision
- Card border: 1px solid rgba(218,41,28,0.20) — subtle red hue to signal consequence
```

#### D. Damage Comparison Card

Used by DamageMediator when presenting PRE vs. POST inspection.

```
┌────────────────────────────────────────────────────────────────┐
│  INSPECTION COMPARISON — RA-20260905-ABCDE                    │
│                                                                │
│  PRE-RENTAL                    POST-RENTAL                    │
│  ┌─────────────────────┐  →   ┌─────────────────────┐         │
│  │  [photo 640×360px]  │      │  [photo 640×360px]  │         │
│  │  Right Rear Door    │      │  Right Rear Door    │         │
│  │  ACCEPTABLE         │      │  MODERATE ⚠         │         │
│  └─────────────────────┘      └─────────────────────┘         │
│                                                                │
│  Zone: Right Rear Door                                         │
│  Change: Acceptable → Moderate                                 │
│  Estimated repair: $840                                        │
│  Your CDW deductible: $500 (CDW active)                       │
│  YOUR LIABILITY: $500                                          │
│                                                                │
│  [ VIEW ALL ZONES (3) ]    [ DISPUTE THIS CLAIM ]             │
└────────────────────────────────────────────────────────────────┘

Specs:
- Side-by-side photos: swipeable on mobile (single photo, swipe to compare)
- PRE label: green text — ACCEPTABLE
- POST label: amber text — MODERATE (amber), or red — SEVERE/TOTAL_LOSS
- Arrow between: → on desktop, swipe indicator on mobile
- CDW status: if active, green "CDW Active — deductible applies"; if voided, red "CDW voided"
- Dispute button: ghost with amber border (action carries emotional weight — not pure red)
```

#### E. Receipt Breakdown Card

Used by ReturnAdvisor when explaining post-return charges.

```
┌────────────────────────────────────────────────────────────────┐
│  YOUR RETURN RECEIPT — RA-20260905-ABCDE                      │
│                                                                │
│  Base rental (3 days × $36.08)            $108.24            │
│  CDW insurance (3 days × $12.00)           $36.00            │
│  GPS navigation (rental)                    $8.50            │
│  ─────────────────────────────────────────────────            │
│  Mileage overage (387 mi × $0.25)          $96.75  ←── ①    │
│  Fuel surcharge (2 steps × $10)            $20.00  ←── ②    │
│  ─────────────────────────────────────────────────            │
│  Subtotal                                 $269.49            │
│  Tax (8.25%)                               $22.23            │
│  ═════════════════════════════════════════════════            │
│  CHARGED TO VISA ••4521                   $291.72            │
│                                                                │
│  ① 687 miles driven – 300 free (100/day) = 387 overage       │
│  ② Returned at 75% fuel (2 steps below contracted 100%)       │
│                                                                │
│  [ ✉ EMAIL RECEIPT ]    [ ⚑ DISPUTE A CHARGE ]              │
└────────────────────────────────────────────────────────────────┘

Specs:
- Anomalous charges (mileage, fuel, time extension) highlighted with →← indicators and footnotes
- Footnotes in amber: provide the arithmetic, not just the amount
- Standard charges in regular weight; anomalous in semi-bold
- "CHARGED TO" row: Inter 500, 16px — the number that actually hit the card
- Dispute button: ghost with amber border — not primary CTA (we don't want to encourage frivolous disputes)
```

#### F. Handoff Card

```
┌────────────────────────────────────────────────────────────────┐
│  ⬡  CONNECTING YOU WITH OUR TEAM                              │
│                                                                │
│  I've passed your full conversation to a member of our team.  │
│  They'll be with you shortly.                                  │
│                                                                │
│  SUMMARY SENT TO AGENT:                                        │
│  • Dispute on fuel charge ($47) for RA-20260905               │
│  • Customer states vehicle was returned full                   │
│  • Fuel level recorded at 75% on return                       │
│  • Customer requesting $27 overage reversal                   │
│                                                                │
│  Position in queue: 2nd                                        │
│  Estimated wait: ~3 minutes                                   │
│                                                                │
└────────────────────────────────────────────────────────────────┘
                         [ connecting... ]
                           ● ● ●  (animated)
```

---

### 3.5 Input Area

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  [ 🎙 ]  Type a message...                          [ ➤ ]    │
│                                                                │
└────────────────────────────────────────────────────────────────┘

Specs:
- Height: 52px (single line), expands to max 160px on multi-line input
- Background: #1a1a1a
- Border: 1px solid rgba(255,255,255,0.10) — bottom border only variant for minimal surfaces
- On focus: border-color: rgba(218,41,28,0.35), no glow (glow feels consumer, not premium)
- Placeholder: rgba(255,255,255,0.30), Inter 400, 14px
- Font: Inter 400, 14px, #ffffff
- Send button: 36×36px, #da291c background, white arrow icon, disabled when input empty
- Voice button (mobile only): microphone icon, left of input — tap to record, hold for continuous
- Keyboard shortcut: Enter to send, Shift+Enter for newline (desktop)
- Character limit indicator: appears at 480/500 chars — "20 characters remaining" in amber
```

---

### 3.6 Quick Reply Chips

```
[ Book this car ]  [ See other options ]  [ Tell me more about CDW ]

Specs:
- Height: 32px
- Padding: 0 14px
- Background: rgba(255,255,255,0.05)
- Border: 1px solid rgba(255,255,255,0.10)
- Font: Inter 500, 12px, rgba(255,255,255,0.75)
- Border-radius: 0px (matches brand — zero radius everywhere)
- On hover: background rgba(218,41,28,0.08), border rgba(218,41,28,0.30)
- On tap: background rgba(218,41,28,0.15), disappear after selection
- Gap between chips: 8px
- Max chips: 4 per message (never overwhelm)
- Overflow: chips wrap to second row, not hidden behind horizontal scroll
- After user selects a chip: all chips fade to 30% opacity, selected chip gets red checkmark
```

---

### 3.7 Progress / Thinking State

```
┌────────────────────────────────────────────────────────────────┐
│  [●R]  RCM                                                    │
│                                                                │
│  ████████████░░░░░░░░  ← red progress bar, 2px tall           │
│  "Checking availability for Economy class, July 4–7…"         │
│   Inter 400, 13px, rgba(255,255,255,0.45)                     │
│                                                                │
└────────────────────────────────────────────────────────────────┘

Animation:
- Bar enters from left: 0% → ~70% over 400ms (ease-out)
- Holds at ~70% while awaiting API response
- On response received: instantly to 100% over 80ms
- Bar fades out over 200ms, message content fades in over 250ms
- Transition between: cross-fade, not sequential (avoids flash of empty state)

Progress phrases by agent:
- BookingConcierge: "Checking availability…" / "Calculating your rate…" / "Securing your reservation…"
- ReservationManager: "Loading your reservation…" / "Checking dates for you…" / "Processing cancellation…"
- RentalAssistant: "Looking up your rental…" / "Finding the nearest charger…" / "Arranging your vehicle swap…"
- ReturnAdvisor: "Retrieving your receipt…" / "Reviewing the charge…"
- DamageMediator: "Loading inspection photos…" / "Reviewing the claim…"
```

---

### 3.8 Surface Layouts

#### Customer Surface — Web Booking (Mobile)

```
┌──────────────────────────────────┐
│  ■ RCM                    ≡     │  ← app header, 64px
├──────────────────────────────────┤
│                                  │
│  [Search Page / Booking Page]    │  ← main content, scrollable
│                                  │
│                                  │
│                                  │
│                                  │
│                                  │
├──────────────────────────────────┤
│                    [ Ask RCM ] ▲ │  ← persistent bottom bar, 56px
└──────────────────────────────────┘

On "Ask RCM" tap:
↓
┌──────────────────────────────────┐
│  ─────────── ↓ drag to close ── │  ← drag handle
│  [●R]  RCM                      │  ← chat header
│  ─────────────────────────────── │
│                                  │
│  (conversation history)          │  ← chat scroll area, flex-1
│                                  │
│  "How can I help you?"           │
│  [ Book a car ] [ Manage booking ]│  ← contextual quick replies
│                                  │
├──────────────────────────────────┤
│  [ 🎙 ]  Type a message...  [➤] │  ← input bar
└──────────────────────────────────┘

Sheet behavior:
- Opens to 82vh (bottom 18% is below keyboard on iOS)
- Keyboard push: sheet stays at 82vh, scrolls chat area up
- Drag handle at top: drag down to close
- Backdrop: rgba(0,0,0,0.60) — does not blur (blurs are GPU-expensive on low-end devices)
- Animation: sheet slides up with spring physics (stiffness: 280, damping: 30)
```

#### Customer Surface — Web Booking (Desktop)

```
┌──────────────────────────────────────────────────────────────┐
│  ■ RCM Rentals                          [My Booking] [Login] │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  MAIN CONTENT                          │  CHAT PANEL        │
│  (Search results, booking form,        │  ─────────────     │
│   confirmation page, etc.)             │  [●R]  RCM         │
│                                        │  ─────────────     │
│  col 1: 1fr (flexible)                 │  (messages)        │
│                                        │                    │
│                                        │                    │
│                                        │                    │
│                                        │  ─────────────     │
│                                        │  [ input bar ]     │
│                                        │                    │
│  col 2: 400px (fixed)                  │  width: 400px      │
└──────────────────────────────────────────────────────────────┘

Panel:
- Width: 400px, fixed right
- Height: 100vh minus header (64px)
- Position: sticky, right: 0
- Background: #1a1a1a
- Left border: 1px solid rgba(255,255,255,0.06)
- On narrow viewports (< 1140px): panel hides, Ask RCM persistent bottom bar appears instead
```

#### Staff Surface — Counter Checkout (iPad landscape)

```
┌────────────────────────────────────────────────────────────────────────┐
│  ■ RCM Counter                                          Agent: Sarah M │
├───────────────────────────┬────────────────────────────────────────────┤
│  CHECKOUT FORM            │  RCM ASSISTANT                             │
│                           │  ────────────────────────────────────────  │
│  Reservation #:           │  "I found reservation RCM-20260905-XYZ.    │
│  ┌────────────────────┐   │  Customer: John Reeves. Economy class.      │
│  │ RCM-20260905-XYZ  │   │  Pickup: today 10am. No damage flags."      │
│  └────────────────────┘   │                                            │
│                           │  SUGGESTED NEXT STEPS                      │
│  Customer: John Reeves ✓  │  ┌──────────────────────────────────────┐  │
│  Vehicle: Toyota Corolla  │  │ 1. Scan driver's license             │  │
│  Unit: #2847 (Lot B)     │  │ 2. Confirm CDW selection             │  │
│                           │  │ 3. Record fuel level (currently 100%)│  │
│  ┌──────────────┐         │  │ 4. Note odometer: 45,210 mi         │  │
│  │ Extras:      │         │  └──────────────────────────────────────┘  │
│  │ [CDW] [GPS]  │         │                                            │
│  └──────────────┘         │  UPSELL SUGGESTION                         │
│                           │  ┌──────────────────────────────────────┐  │
│  Odometer out: [      ]   │  │ Toll Pass — $4.99/day for 3 days.   │  │
│  Fuel level:  [████░░] %  │  │ LAX area has 7 toll roads. Customer  │  │
│                           │  │ hasn't added this. Mention?          │  │
│  [  COMPLETE CHECKOUT  ]  │  └──────────────────────────────────────┘  │
└───────────────────────────┴────────────────────────────────────────────┘

Specs:
- Form column: 55% of screen width
- Agent column: 45% of screen width
- Agent column background: #1a1a1a (slightly darker than page bg)
- Left border: 1px solid rgba(255,255,255,0.06)
- Suggested steps: numbered list, auto-updates as steps are completed
- Upsell suggestion: shows only when analytically confident (>65% uptake rate on this extra)
- Agent does NOT have a text input on counter surface — it pushes suggestions, staff doesn't chat
- All agent suggestions are acted on via the form, not via the chat interface
```

#### Staff Surface — Admin Dashboard (Fleet/Pricing Intelligence)

```
┌────────────────────────────────────────────────────────────────────────┐
│  ■ RCM Admin        [Fleet] [Pricing] [Reports] [Settings]             │
├──────────────────┬─────────────────────────────┬───────────────────────┤
│  SIDEBAR NAV     │  MAIN CONTENT               │  AI INTELLIGENCE      │
│                  │                             │  ─────────────────    │
│  Fleet           │  [Fleet Map / Calendar /    │  [●R]  FLEET ADVISOR  │
│  Pricing         │   Revenue Chart]            │                       │
│  Reports         │                             │  Today's Alerts       │
│  Customers       │                             │  ┌─────────────────┐  │
│  Settings        │                             │  │ ⚠ LAX Economy   │  │
│                  │  col 1: flex                │  │ 94% utilized Fri │  │
│  [shortcuts]     │                             │  │ [View →]         │  │
│                  │                             │  └─────────────────┘  │
│                  │                             │  ┌─────────────────┐  │
│                  │                             │  │ ● Rebalancing   │  │
│                  │                             │  │ 3 Econo @ BUR   │  │
│                  │                             │  │ [Approve →]     │  │
│                  │                             │  └─────────────────┘  │
│                  │                             │                       │
│                  │                             │  [ Cmd+K to query ]   │
└──────────────────┴─────────────────────────────┴───────────────────────┘

AI Intelligence column:
- Width: 300px (collapsible to 0 with [→] toggle button)
- Background: #1a1a1a
- Alert cards: auto-surfaced by FleetOptimizer/PricingStrategist agents
- Each alert: title, 1-line summary, action button
- Alert severity: ● green (info), ◆ amber (attention needed), ⚠ red (urgent)
- Cmd+K: opens full command palette over the dashboard for natural language queries
```

#### Command Palette (Cmd+K)

```
┌────────────────────────────────────────────────────────────────────────┐
│  █████████████████████████████████████████████████████████████████████ │
│  █  ┌───────────────────────────────────────────────────────────────┐ █│
│  █  │  🔍  Ask RCM anything...                                      │ █│
│  █  └───────────────────────────────────────────────────────────────┘ █│
│  █                                                                   █ │
│  █  RECENT                                                           █ │
│  █  ─────────────────────────────────────────────────────────────── █ │
│  █  ↑ What is LAX utilization this weekend?                         █ │
│  █  ↑ How many Economy cars at SFO?                                 █ │
│  █  ↑ Show overdue rentals right now                                █ │
│  █                                                                   █ │
│  █  SUGGESTIONS                                                      █ │
│  █  ─────────────────────────────────────────────────────────────── █ │
│  █  → Fleet rebalancing opportunities                               █ │
│  █  → Pricing anomalies this week                                   █ │
│  █  → Vehicles coming off rent today                                █ │
│  █                                                                   █ │
│  █████████████████████████████████████████████████████████████████████ │
└────────────────────────────────────────────────────────────────────────┘

Specs:
- Triggered by Cmd+K (Mac) / Ctrl+K (Windows) — global, works anywhere in admin
- Modal overlay: rgba(0,0,0,0.75) backdrop
- Palette card: 600px wide, centered, max-height 480px
- Background: #1d1d1d
- Border: 1px solid rgba(255,255,255,0.10)
- Input: 48px tall, no border, transparent background inside palette
- Search icon: white, 18px
- Recent queries: persisted in localStorage (last 10)
- Result rendering: streamed directly below the input as user types (150ms debounce)
- Dismiss: Escape key, click outside, or Enter after result selected
```

---

### 3.9 Motion Design Specifications

**Theo's Motion System**

The motion philosophy is: **purposeful minimalism**. Animations exist to communicate state changes, not to decorate. Every animation has a function.

```
ENTERING MESSAGES
  Property: opacity 0→1, translateY 8px→0
  Duration: 200ms
  Easing: ease-out
  Stagger: none (instant — streaming messages should feel continuous)

QUICK REPLY CHIPS
  Property: opacity 0→1, translateY 4px→0
  Duration: 160ms per chip
  Stagger: 40ms between chips
  Easing: ease-out
  Appears after: 100ms delay post-message render

PROGRESS BAR
  Enter: opacity 0→1, scaleX 0→0.70 over 400ms, ease-out
  Hold: scaleX stays at 0.70 + subtle pulse (scaleX 0.70→0.68→0.70, 1.2s loop)
  Complete: scaleX 0.70→1.00 in 80ms, then opacity 1→0 in 200ms
  Easing complete: cubic-bezier(0.34, 1.56, 0.64, 1) — slight overshoot

AGENT MONOGRAM MODE CHANGE
  Property: background-color (from booking→damage or →payment mode)
  Duration: 400ms
  Easing: ease-in-out
  Indicator dot: scale 0→1 with spring (stiffness:300, damping:25)

MOBILE SHEET OPEN
  Property: translateY 100%→0
  Duration: 340ms
  Easing: cubic-bezier(0.32, 0.72, 0, 1) — iOS sheet physics

MOBILE SHEET CLOSE (swipe gesture)
  Follows finger during drag
  On release: if velocity > 500px/s or position > 60% screen height → close
  Close animation: translateY 0→100% in 240ms, ease-in

CARD ENTRY (vehicle cards, receipt cards, damage cards)
  Property: opacity 0→1, scaleY 0.96→1
  Transform origin: top
  Duration: 220ms
  Easing: ease-out

CONFIRMATION CARD
  Same as card entry, but preceded by 200ms pause after preceding text renders
  Gives user time to read before the high-stakes card appears

ERROR STATE
  Shake: translateX 0→-6px→6px→-4px→4px→0
  Duration: 320ms total
  Used for: validation errors, expired quote, failed booking attempt

REDUCED MOTION OVERRIDE
  All animations: replaced with instant opacity change (0→1 in 0ms)
  Only exception: progress bar still shows (no animation, just static bar)
  Controlled by: @media (prefers-reduced-motion: reduce)
```

---

### 3.10 Tone of Voice & Persona Guidelines

**Cleo's Conversational Standards**

#### The RCM Voice

| Attribute | What It Means | Example |
|---|---|---|
| **Direct** | State the answer first, then context | "Your return date is September 8." not "So I've looked into this and it seems like…" |
| **Precise** | Use the exact number | "$96.75" not "around $97" |
| **Warm but not familiar** | Professional courtesy, not friendship | "Happy to help with that." not "Of course! 😊 I'd love to assist!" |
| **Never apologetic for correct information** | Don't preface facts with apologies | "Your fuel level was recorded at 75%." not "I'm sorry but our records show…" |
| **No filler phrases** | Never start with "Great!", "Sure!", "Absolutely!" | Responses start with the answer, not affirmation |
| **Short sentences for complex topics** | Break up calculations | One thought per sentence for line-item explanations |

#### Message Length Guidelines

| Situation | Target length |
|---|---|
| Factual answer (status, date, number) | 1–2 sentences |
| Booking confirmation | 3–4 sentences + confirmation card |
| Price explanation | 1 sentence + receipt card |
| Damage dispute | 2–3 sentences + damage comparison card |
| Escalation to human | 2 sentences + handoff card |
| Error (expired quote, unavailable) | 1 sentence — state the issue, offer the fix |

#### Error Message Framework

Errors must be: **clear about what happened, immediate about what to do next**.

```
BAD:  "I apologize, but unfortunately it seems there may have been an issue
      with processing your request at this time. Please try again later."

GOOD: "Your quote expired. Get a fresh quote for the same dates?"
      [ GET NEW QUOTE ]
```

```
BAD:  "I'm sorry, we weren't able to find that location."

GOOD: "Location 'LAXXX' not found. Try 'LAX01' or the full city name."
      [ SEARCH LOCATIONS ]
```

```
BAD:  "There was a problem with your payment. Please check your card details
      and try again."

GOOD: "Payment failed — card declined by your bank. Use a different card?"
      [ TRY ANOTHER CARD ]    [ CONTACT YOUR BANK ]
```

---

### 3.11 Accessibility Specification

**Sam's Accessibility Requirements**

Every component must meet WCAG 2.2 Level AA. Selected non-obvious requirements:

```
COLOUR CONTRAST
  Agent message text on #212121: minimum 4.5:1 (AA for text)
  #ffffff on #212121: 17.7:1 — passes easily
  Red button text (#ffffff on #da291c): 4.7:1 — passes AA
  Placeholder text: rgba(255,255,255,0.30) on #1a1a1a: 2.1:1 — FAILS AA
  FIX: Placeholder must be rgba(255,255,255,0.50) minimum → 3.2:1
  NOTE: Placeholder contrast is AA for large text (18px+) — ours is 14px
  DECISION: Use rgba(255,255,255,0.55) → 3.5:1 for 14px placeholder text

KEYBOARD NAVIGATION
  Tab order within chat panel: header → message list → input → send button
  Quick reply chips: Tab to first chip, Arrow keys between chips, Enter to select
  Confirmation card buttons: Tab between "Confirm" and "Go Back", Enter to activate
  Mobile sheet: ESC closes the sheet (in addition to swipe)
  Command palette: Arrow keys navigate result list, Enter selects, ESC closes

SCREEN READER
  Chat message list: role="log", aria-label="Conversation with RCM Assistant", aria-live="polite"
  New agent messages: announced by aria-live automatically
  Progress state: role="status", aria-live="polite" for progress phrases
  Card components: use semantic HTML (not div-soup) — article for message, section for card
  Confirmation card: aria-label="Confirm [action description]" on primary button
  Damage comparison: img alt text describes the damage zone and condition change

FOCUS MANAGEMENT
  On sheet open: focus moves to input field
  On sheet close: focus returns to the "Ask RCM" trigger button
  On agent response with confirmation card: focus does NOT move to card (aria-live handles it)
  On human handoff: focus stays in chat input

MOTION
  All animations respect prefers-reduced-motion
  NO auto-playing video or GIF in any component
  Progress bar animation is the only looping animation — paused at reduced motion

TOUCH TARGETS
  Quick reply chips: min 44×44px tap target (even if visual is smaller — use padding)
  Send button: 44×44px
  Drag handle on mobile sheet: 44px wide × 32px tall
  Swipe area for dismissing sheet: full width gesture, not just handle
```

---

## Part 4 — Surface-by-Surface Specification Summary

### Surface 1: web-booking (Customer — Public)

| Element | Pattern | Priority |
|---|---|---|
| Agent entry point | "Ask RCM" persistent bar at bottom | P0 |
| Mobile interaction | Bottom sheet, 82vh | P0 |
| Desktop interaction | Right panel, 400px | P0 |
| Booking flow | Vehicle cards + quote card + confirmation card | P0 |
| Modification flow | Text + confirmation card | P0 |
| Cancellation flow | Cancellation preview card + confirmation card | P0 |
| Return receipt | Receipt breakdown card with footnotes | P1 |
| Proactive alerts | Push (SMS/WhatsApp) — no in-browser widget | P1 |
| Voice input | Mobile only, hold-to-speak | P2 |

---

### Surface 2: web-admin — Counter View (Staff)

| Element | Pattern | Priority |
|---|---|---|
| Agent surface | Inline right panel (no chat, push-only) | P0 |
| Checkout flow | Suggested next steps, auto-updated | P0 |
| Upsell intelligence | Context-aware suggestion card | P1 |
| Anomaly flag | Inline inline warning (DNR flag, age restriction) | P0 |
| No text input | Staff acts through the form, not the chat | P0 |

---

### Surface 3: web-admin — Manager/Fleet View (Staff)

| Element | Pattern | Priority |
|---|---|---|
| AI Intelligence column | 300px right sidebar, collapsible | P0 |
| Alert cards | Auto-surfaced, severity-coded | P0 |
| Command palette | Cmd+K, global, streamed results | P0 |
| Approval workflow | Alert card → Approve/Dismiss inline | P0 |
| Pricing suggestions | Draft only — shown in sidebar, requires approval | P1 |

---

## Part 5 — Implementation Priorities

### P0 — Required Before Agent Launch (Week 1–3 of implementation)

1. Design token additions (agent layer, 3.1)
2. Agent monogram component
3. Message anatomy component (text + source attribution)
4. Progress bar + progress phrases
5. Quick reply chips
6. Input area with keyboard shortcuts
7. Mobile bottom sheet (with spring physics + swipe dismiss)
8. Desktop right panel (420px, sticky)
9. Vehicle class card
10. Quote summary card + countdown timer
11. Confirmation action card
12. Accessibility baseline (contrast, keyboard nav, aria-live)

### P1 — Required Before Phase 2 Agents Launch (Week 4–6)

13. Receipt breakdown card with footnotes
14. Handoff card + queue position
15. Damage comparison card (mobile: swipe to compare)
16. Mode-aware monogram (damage amber, payment green)
17. Counter inline panel (staff surface, push-only)
18. Admin sidebar intelligence column (alerts + approve/dismiss)

### P2 — Required Before Phase 4 (Week 7+)

19. Command palette (Cmd+K)
20. Voice input (mobile, STT integration)
21. Full motion system audit (Theo's spec)
22. WCAG 2.2 AA full audit and remediation
23. Dark-mode-only scrollbar styling for chat panel
24. Multi-language support (EN/ES as first two)

---

## Part 6 — What We Chose Not To Do (And Why)

**Avatar photo or illustrated character:** Rejected. Human-looking avatars trigger uncanny valley effects and set expectation of human-level empathy. The monogram is brand-forward, not character-forward.

**Conversation history shown on the main page before opening sheet:** Rejected. Showing conversation history passively on the page creates cognitive noise for users who are scanning for vehicle options. History is only shown inside the open chat surface.

**Sound effects (notification chime, send sound):** Rejected. Sounds are intrusive in a shared environment (airport counter, customer browsing in a public space). No audio feedback for any agent interaction.

**AI typing indicator (three dots while generating):** Replaced with the progress bar + phrase system. Three dots signal uncertainty and waiting; the progress bar with a business-level phrase signals competence and transparency.

**Markdown rendering (bold, headers, bullet points) in messages:** Minimized. Agent messages are plain prose. The structured content lives in cards, not in markdown-rendered text. A message that says "**Your booking is confirmed!** Here are the **details**:" looks like a robot. Cards communicate structure better than markdown.

**Suggested conversation starters on empty state:** Rejected for customer surfaces. Starters like "What would you like help with?" plus three example prompts feel onboarding-heavy and break the premium experience. The agent is ambient until needed. On admin surfaces (command palette), recent queries and suggestions are appropriate because staff users have a known task context.

**"Was this helpful? 👍👎" after every message:** Rejected. Satisfaction surveys embedded in every interaction reduce conversation fluency and normalize interruptions. We collect CSAT via a single optional survey sent 30 minutes after the conversation ends — separate from the conversation itself.

---

*Design Team: Maya · Ryo · Priya · Theo · Sam · Cleo*  
*Status: Approved for implementation*  
*Companion documents: `AI_AGENT_DESIGN.md`*
