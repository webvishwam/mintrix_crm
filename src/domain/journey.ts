/**
 * THE ONE SCHOOL JOURNEY.
 *
 * There is no Trust Engine, no Partnership Engine and no Delivery Engine. There is one
 * relationship with a school, and Beyond the Classroom, Commercial, Production and
 * Delivery are parallel WORKSTREAMS attached to it.
 *
 * The old fourteen "stages" were audited one at a time and six of them turned out
 * never to have been stages at all:
 *
 *   s1  Market Selection / ICP Gate .. a GATE           -> entry check on Target
 *   s2  School Selection ............ a DECISION        -> the Target stage itself
 *   s3  30-Minute Dossier ........... WORK              -> a research work item
 *   s4  Asset Creation .............. WORK              -> a work item
 *   s5  Physical Delivery ........... an ACTIVITY       -> activity + work
 *   s6  Follow-Up Cadence ........... a WORK PATTERN    -> work items
 *   s7  Discovery ................... a STAGE           -> discovery
 *   s8  Problem -> Mapping .......... a STAGE           -> mapping
 *   s9  Proposal .................... a STAGE           -> proposal
 *   s10 Close ....................... a STAGE           -> negotiation
 *   s11 Purchase Order .............. a COMMERCIAL STATE-> contract
 *   s12 Payment ..................... a COMMERCIAL STATE-> payment
 *   s13 SLA / Onboarding Handoff .... a MILESTONE       -> the boundary into delivery
 *   s14 Expansion ................... a STATE           -> expansion
 *
 * T0-T6 the same: two duplicated the school's own stages, four were work, and only
 * T3 Record was a milestone. They are now podcast STATUS plus work items.
 */

export type Stage =
  | "lead" | "target" | "research" | "engagement" | "discovery" | "mapping"
  | "proposal" | "negotiation" | "contract" | "payment" | "customer" | "expansion"
  | "nurture" | "disqualified" | "lost";

export type Team = "sales" | "production" | "marketing" | "implementation"
  | "operations" | "founder";

export type Workstream = "acquisition" | "podcast" | "production" | "commercial"
  | "school_data" | "pilot" | "implementation" | "contract" | "onboarding";

export const TEAMS: { key: Team; name: string; what: string }[] = [
  { key: "sales", name: "Sales", what: "Owns the relationship and the sale." },
  { key: "production", name: "Production", what: "Recording, editing, assets." },
  { key: "marketing", name: "Marketing", what: "Publication and clips." },
  { key: "implementation", name: "Implementation", what: "Config, data, training, go-live." },
  { key: "operations", name: "Operations", what: "Data, records, scheduling." },
  { key: "founder", name: "Founder", what: "Commercial decisions and overrides." },
];
export const teamName = (k?: string | null) =>
  TEAMS.find((t) => t.key === k)?.name ?? "Unassigned";

export const WORKSTREAMS: { key: Workstream; name: string; what: string }[] = [
  { key: "acquisition", name: "Acquisition", what: "Moving the relationship forward." },
  { key: "podcast", name: "Beyond the Classroom",
    what: "Guest, brief, consent, delivery — the relationship side of the show." },
  { key: "production", name: "Production",
    what: "Recording, editing, assets. Runs alongside everything else." },
  { key: "commercial", name: "Commercial",
    what: "Discovery, problem validation, mapping, proposal." },
  { key: "school_data", name: "School data", what: "Anything we asked the school to send." },
  { key: "pilot", name: "Pilot", what: "Running and measuring the pilot." },
  { key: "implementation", name: "Implementation", what: "Configuration, import, training." },
  { key: "contract", name: "Contract", what: "Terms, signature, PO, payment." },
  { key: "onboarding", name: "Onboarding", what: "The first ninety days." },
];
export const workstreamName = (k?: string | null) =>
  WORKSTREAMS.find((w) => w.key === k)?.name ?? "General";

/** A deterministic check on data, evaluated live. Never a stored flag. */
export interface EntryCheck { key: string; label: string; fix: string }

/**
 * Work a stage requires. BLOCKING work can hold the stage shut; everything else runs
 * alongside and must never stop the relationship moving. That distinction is the
 * reason a school can reach Discovery while Production is still editing.
 */
export interface StageWork {
  key: string;
  title: string;
  reason: string;
  team: Team;
  workstream: Workstream;
  task_type: string;
  blocking: boolean;
  sla_hours: number;
  outcome?: string;
}

export interface StageDef {
  key: Stage;
  name: string;
  num: number;
  /** What being here means, in one line a rep can read. */
  meaning: string;
  entry: EntryCheck[];
  work: StageWork[];
  exit: string;
  sla_hours: number | null;
  next: Stage | null;
  /** Commercial stages are the ones an opportunity may also occupy. */
  commercial?: boolean;
  terminal?: boolean;
}

const E = {
  identified: { key: "identified",
    label: "The school's own details are recorded — board and locality",
    fix: "/schools/{school}" },
  account: { key: "account", label: "It sits under the right account",
    fix: "/schools/{school}" },
  owner: { key: "owner", label: "Somebody owns this school",
    fix: "/schools/{school}" },
  icp: { key: "icp", label: "The ICP check has been run",
    fix: "/schools/{school}" },
  person: { key: "person", label: "At least one person is on file",
    fix: "/schools/{school}/people/new" },
  contact_route: { key: "contact_route",
    label: "Somebody here has a phone number or an email address",
    fix: "/schools/{school}" },
  decision_maker: { key: "decision_maker", label: "A decision maker is named",
    fix: "/schools/{school}/people/new" },
  signal: { key: "signal",
    label: "A commercial signal has been recorded — their words, not ours",
    fix: "/schools/{school}" },
  problem: { key: "problem",
    label: "The problem is written down in the school's own words",
    fix: "/schools/{school}" },
} satisfies Record<string, EntryCheck>;

export const STAGES: StageDef[] = [
  {
    key: "lead", name: "Lead", num: 1,
    meaning: "It is in the CRM. Nobody has decided anything about it yet.",
    entry: [], work: [],
    exit: "Somebody decides this school is worth our time.",
    sla_hours: null, next: "target",
  },
  {
    key: "target", name: "Target", num: 2,
    meaning: "We have chosen to work this school.",
    entry: [E.identified, E.account, E.owner],
    work: [
      { key: "verify", title: "Verify {school}'s details against a public source",
        reason: "Working from an unverified record wastes the first conversation.",
        team: "sales", workstream: "acquisition", task_type: "research",
        blocking: true, sla_hours: 24,
        outcome: "Board, locality and rough size confirmed from the school's own site or UDISE." },
      { key: "icp", title: "Run the ICP check on {school}",
        reason: "Decide fit before spending the access, not after.",
        team: "sales", workstream: "acquisition", task_type: "research",
        blocking: true, sla_hours: 24,
        outcome: "Every ICP dimension answered, or explicitly marked unknown." },
    ],
    exit: "The school is real, it is ours to work, and it fits.",
    sla_hours: 48, next: "research",
  },
  {
    key: "research", name: "Research", num: 3,
    meaning: "Learning how this school actually runs, before asking for anything.",
    entry: [E.owner, E.icp],
    work: [
      { key: "dossier", title: "Build the research record for {school}",
        reason: "Walking in without it wastes access we only get once.",
        team: "sales", workstream: "acquisition", task_type: "research",
        blocking: true, sla_hours: 72,
        outcome: "Why visit, what to say, the room, and what we must not claim." },
      { key: "decision_maker", title: "Identify who decides at {school}",
        reason: "A conversation with the wrong person is one we pay for twice.",
        team: "sales", workstream: "acquisition", task_type: "research",
        blocking: true, sla_hours: 72,
        outcome: "A named person, with the evidence for their authority." },
      { key: "opener", title: "Write the opener for {school}",
        reason: "The first line is the whole outreach.",
        team: "sales", workstream: "acquisition", task_type: "research",
        blocking: false, sla_hours: 96 },
    ],
    exit: "We know who runs it, what they care about, and what we would say.",
    sla_hours: 168, next: "engagement",
  },
  {
    key: "engagement", name: "Engagement", num: 4,
    meaning:
      "Building the relationship. Outreach, replies, meetings and Beyond the " +
      "Classroom all happen here — they are work, not four separate stages.",
    entry: [E.person, E.contact_route],
    work: [
      { key: "approach", title: "Make the first approach to {school}",
        reason: "The research is only worth something once it is used.",
        team: "sales", workstream: "acquisition", task_type: "call",
        blocking: true, sla_hours: 48,
        outcome: "A call, a message or a visit, logged with what was said." },
      { key: "next_step", title: "Agree a dated next step with {school}",
        reason: "A conversation with no next step is a memory, not a relationship.",
        team: "sales", workstream: "acquisition", task_type: "call",
        blocking: true, sla_hours: 120,
        outcome: "A specific thing, on a specific date, that they have agreed to." },
      { key: "map_room", title: "Map the other people at {school}",
        reason: "One contact is a single point of failure.",
        team: "sales", workstream: "acquisition", task_type: "research",
        blocking: false, sla_hours: 168 },
    ],
    exit:
      "Somebody at the school has named a problem in their own words. Discovery is " +
      "what we call having heard it — it does not wait for the show to finish.",
    sla_hours: 336, next: "discovery",
  },
  {
    key: "discovery", name: "Discovery", num: 5,
    meaning:
      "They have named a problem. Understanding one workflow properly, in their words.",
    entry: [E.decision_maker, E.signal],
    commercial: true,
    work: [
      { key: "run_discovery", title: "Run the discovery conversation at {school}",
        reason: "Nothing can be diagnosed from outside the school.",
        team: "sales", workstream: "commercial", task_type: "discovery_meeting",
        blocking: true, sla_hours: 72 },
      { key: "record_problem", title: "Write down {school}'s problem in their words",
        reason: "Our words for their problem are a guess. Theirs are evidence.",
        team: "sales", workstream: "commercial", task_type: "discovery_meeting",
        blocking: true, sla_hours: 24,
        outcome: "The discovery record, with the problem quoted rather than paraphrased." },
    ],
    exit: "One workflow is understood and written down in their language.",
    sla_hours: 168, next: "mapping",
  },
  {
    key: "mapping", name: "Problem → Mapping", num: 6,
    meaning: "Their problem, with metrics, mapped to one Mintrix outcome they accept.",
    entry: [E.problem],
    commercial: true,
    work: [
      { key: "build", title: "Build the mapping for {school}",
        reason: "Problem → evidence → impact → desired state → outcome.",
        team: "sales", workstream: "commercial", task_type: "diagnostic",
        blocking: true, sla_hours: 72 },
      { key: "agree", title: "Get {school} to agree the mapping",
        reason: "A diagnosis they have not accepted is our opinion.",
        team: "sales", workstream: "commercial", task_type: "diagnostic",
        blocking: true, sla_hours: 72,
        outcome: "Their correction or their agreement, in writing." },
    ],
    exit: "They have agreed our description of their own situation.",
    sla_hours: 240, next: "proposal",
  },
  {
    key: "proposal", name: "Proposal", num: 7,
    meaning: "A scoped, priced offer is with them.",
    entry: [E.decision_maker],
    commercial: true,
    work: [
      { key: "send", title: "Send {school} the scoped, priced offer",
        reason: "All seven partnership-readiness conditions are met.",
        team: "sales", workstream: "commercial", task_type: "proposal",
        blocking: true, sla_hours: 96 },
    ],
    exit: "They have the offer and know what happens next.",
    sla_hours: 336, next: "negotiation",
  },
  {
    key: "negotiation", name: "Negotiation", num: 8,
    meaning: "Terms are being agreed.",
    entry: [E.decision_maker],
    commercial: true,
    work: [
      { key: "terms", title: "Agree terms with {school}",
        reason: "Scope and economics, not a discount conversation.",
        team: "sales", workstream: "contract", task_type: "meeting",
        blocking: true, sla_hours: 120 },
      { key: "path", title: "Confirm {school}'s approval path and dates",
        reason: "Who signs, in what order, by when.",
        team: "sales", workstream: "contract", task_type: "meeting",
        blocking: false, sla_hours: 120 },
    ],
    exit: "Terms agreed and a signature date exists.",
    sla_hours: 336, next: "contract",
  },
  {
    key: "contract", name: "Contract / PO", num: 9,
    meaning: "Signed, or the purchase order is raised.",
    entry: [], commercial: true,
    work: [
      { key: "po", title: "Chase the purchase order from {school}",
        reason: "A verbal yes is not a purchase order.",
        team: "sales", workstream: "contract", task_type: "po_chase",
        blocking: true, sla_hours: 168 },
    ],
    exit: "A signed contract or a raised PO exists.",
    sla_hours: 336, next: "payment",
  },
  {
    key: "payment", name: "Payment", num: 10,
    meaning: "Invoiced, and waiting for the money to clear.",
    entry: [], commercial: true,
    work: [
      { key: "invoice", title: "Invoice {school} and track it to the bank",
        reason: "Won means banked.",
        team: "operations", workstream: "contract", task_type: "payment_chase",
        blocking: true, sla_hours: 336 },
    ],
    exit: "The payment has cleared.",
    sla_hours: 720, next: "customer",
  },
  {
    key: "customer", name: "Customer", num: 11,
    meaning: "They are a customer. Delivery runs on its own lifecycle from here.",
    entry: [], commercial: true,
    work: [
      { key: "handoff", title: "Hand {school} over to delivery",
        reason: "Delivery cannot start from a conversation nobody wrote down.",
        team: "implementation", workstream: "onboarding", task_type: "handoff",
        blocking: true, sla_hours: 48,
        outcome: "The handoff document, accepted by whoever is implementing." },
    ],
    exit: "Delivery has what it needs and has said so.",
    sla_hours: null, next: "expansion",
  },
  {
    key: "expansion", name: "Expansion", num: 12,
    meaning: "A customer with a new problem worth solving.",
    entry: [], commercial: true, work: [],
    exit: "A new opportunity is open against the same school.",
    sla_hours: null, next: null,
  },
  // Holding states. Decisions about a relationship, never gated on work.
  { key: "nurture", name: "Nurture", num: 90, terminal: true,
    meaning: "A real relationship with no live ask. Stays warm, costs nothing.",
    entry: [], work: [], exit: "Something changes, or six months pass.",
    sla_hours: null, next: null },
  { key: "disqualified", name: "Disqualified", num: 91, terminal: true,
    meaning: "Not a fit, and we have said why.",
    entry: [], work: [], exit: "—", sla_hours: null, next: null },
  { key: "lost", name: "Lost", num: 92, terminal: true,
    meaning: "They chose something else, or chose nothing.",
    entry: [], work: [], exit: "—", sla_hours: null, next: null },
];

export const BY_KEY: Record<string, StageDef> =
  Object.fromEntries(STAGES.map((s) => [s.key, s]));
export const LADDER = STAGES.filter((s) => !s.terminal);
export const HOLDING = STAGES.filter((s) => s.terminal);
/** The stages an OPPORTUNITY may occupy — the commercial half of the same ladder. */
export const COMMERCIAL = STAGES.filter((s) => s.commercial && !s.terminal);

export const stageName = (k?: string | null) =>
  BY_KEY[String(k ?? "")]?.name
  ?? String(k ?? "lead").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function stageColour(k?: string | null): string {
  const s = BY_KEY[String(k ?? "")];
  if (!s) return "slate";
  if (s.key === "customer" || s.key === "expansion") return "green";
  if (s.terminal) return "slate";
  if (s.num >= 7) return "amber";
  if (s.num >= 5) return "plum";
  if (s.num >= 2) return "blue";
  return "slate";
}

/** A stage may only be entered from the one before it, or from a holding state. */
export function isLegalMove(from: string, to: string): boolean {
  if (from === to) return false;
  const f = BY_KEY[from], t = BY_KEY[to];
  if (!f || !t) return false;
  if (t.terminal || f.terminal) return true;
  return f.next === to;
}

// ---------------------------------------------------------------- podcast
/**
 * Beyond the Classroom is a WORKSTREAM with a status. T0-T6 were operational steps;
 * their SLAs live on the work items, which is what they always were.
 */
export type PodcastStatus = "planned" | "invited" | "scheduled" | "recorded"
  | "delivered" | "published" | "nurture" | "declined";

export const PODCAST_STATUSES: { key: PodcastStatus; name: string; what: string }[] = [
  { key: "planned", name: "Planned", what: "An episode question exists for this school." },
  { key: "invited", name: "Invited", what: "Asked. Waiting on a yes or a no." },
  { key: "scheduled", name: "Scheduled", what: "A date is confirmed in writing." },
  { key: "recorded", name: "Recorded", what: "The conversation happened." },
  { key: "delivered", name: "Delivered", what: "The guest has their package — before publication." },
  { key: "published", name: "Published", what: "It is out." },
  { key: "nurture", name: "Nurture", what: "No for now. Ask again in six months." },
  { key: "declined", name: "Declined", what: "They said no." },
];
export const podcastStatusName = (k?: string | null) =>
  PODCAST_STATUSES.find((s) => s.key === k)?.name ?? "Not started";

// --------------------------------------------------------------- delivery
export type DeliveryStage = "discovery_config" | "build_import" | "training_uat"
  | "soft_launch" | "go_live" | "closed" | "on_hold";

export const DELIVERY_STAGES: { key: DeliveryStage; name: string }[] = [
  { key: "discovery_config", name: "Discovery & Config" },
  { key: "build_import", name: "Build & Data Import" },
  { key: "training_uat", name: "Training & UAT" },
  { key: "soft_launch", name: "Soft Launch / Hypercare" },
  { key: "go_live", name: "Go-Live" },
  { key: "closed", name: "Closed (handed to CS)" },
  { key: "on_hold", name: "On Hold" },
];
export const deliveryStageName = (k?: string | null) =>
  DELIVERY_STAGES.find((s) => s.key === k)?.name ?? "Not started";

// Stage work templates must never collide, or progress counting breaks.
{
  const seen = new Set<string>();
  for (const s of STAGES) {
    for (const w of s.work) {
      const id = `${s.key}.${w.key}`;
      if (seen.has(id)) throw new Error(`Duplicate stage work template ${id}`);
      seen.add(id);
    }
  }
}
