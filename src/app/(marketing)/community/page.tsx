import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, MapPin, Video, Star, Calendar } from "lucide-react";

export const metadata: Metadata = {
  title: "Community — BigBag AI App Builder",
  description: "Build the future with thousands of creators, founders, and dreamers. Join the bigbag community.",
};

const EVENTS = [
  {
    type: "Hackathon",
    title: "Build-a-thon: AI Products",
    date: "October 12, 2026",
    location: "San Francisco, CA",
    mode: "In person",
    attendees: 120,
    emoji: "🏆",
  },
  {
    type: "Workshop",
    title: "From Prompt to Production in 60 Minutes",
    date: "October 19, 2026",
    location: "Online",
    mode: "Online",
    attendees: 340,
    emoji: "⚡",
  },
  {
    type: "Meetup",
    title: "Builders Meetup — London",
    date: "October 26, 2026",
    location: "London, UK",
    mode: "In person",
    attendees: 80,
    emoji: "🌍",
  },
  {
    type: "Buildathon",
    title: "72-Hour Build Sprint",
    date: "November 8–10, 2026",
    location: "Online",
    mode: "Online",
    attendees: 500,
    emoji: "🚀",
  },
];

const COMMUNITY_LEADERS = [
  { name: "Anika R.", role: "Community Lead, Asia Pacific", city: "Singapore", projects: 14, avatar: "AR", color: "bg-[#948be8]" },
  { name: "James T.", role: "Hackathon Organizer, North America", city: "New York", projects: 22, avatar: "JT", color: "bg-[#3f8cff]" },
  { name: "Léa M.", role: "Workshop Host, Europe", city: "Paris", projects: 18, avatar: "LM", color: "bg-[#18a981]" },
  { name: "Damilola O.", role: "Community Lead, Africa", city: "Lagos", projects: 11, avatar: "DO", color: "bg-[#ff6b6b]" },
];

const MEMBER_STORIES = [
  {
    quote: "The community helped me go from zero coding knowledge to launching my first SaaS in six weeks. I couldn't have done it without the support in the Discord.",
    name: "Fatima Al-H.",
    project: "Built a freelancer invoicing tool",
    avatar: "FA",
    color: "bg-[#6554e8]",
  },
  {
    quote: "I attended a BuildBag hackathon and shipped a full app in 24 hours. Won the audience vote, got two paying customers the next week.",
    name: "Riku S.",
    project: "Built a team retrospective app",
    avatar: "RS",
    color: "bg-[#18a981]",
  },
  {
    quote: "There's something electric about a room full of people all building at once. The energy at the in-person events is unlike anything else.",
    name: "Claire W.",
    project: "Built a local events aggregator",
    avatar: "CW",
    color: "bg-[#ff6b6b]",
  },
];

const STATS = [
  { value: "8,500+", label: "Builders" },
  { value: "120+", label: "Events hosted" },
  { value: "42", label: "Countries" },
  { value: "3,200+", label: "Projects shipped" },
];

export default function CommunityPage() {
  return (
    <div className="bg-background text-foreground">
      {/* ── Hero ── */}
      <section className="py-20 sm:py-28 text-center border-b border-border overflow-hidden relative">
        <div className="studio-grid absolute inset-0 -z-10 pointer-events-none opacity-50" />
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/50 px-3 py-1 text-xs font-medium text-muted-foreground mb-6">
            Community
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-[-0.04em] text-foreground text-balance">
            Welcome to the<br />
            <span className="text-primary">bigbag community</span>
          </h1>
          <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed max-w-xl mx-auto text-balance">
            Build the future with thousands of creators, founders, and dreamers. Whether you&apos;re brand new or a professional vibe coder, there&apos;s a place for you here.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="#online" className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-full text-sm font-semibold hover:bg-primary/90 transition-colors">
              <Video className="w-4 h-4" />
              Join online
            </Link>
            <Link href="#irl" className="inline-flex items-center gap-2 px-5 py-2.5 border border-border rounded-full text-sm font-medium hover:bg-accent transition-colors">
              <MapPin className="w-4 h-4" />
              Find an event near you
            </Link>
          </div>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="border-b border-border bg-secondary/20 dark:bg-card/20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
            {STATS.map((s) => (
              <div key={s.label}>
                <div className="text-3xl font-bold text-foreground">{s.value}</div>
                <div className="mt-1 text-xs text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Community photo ── */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          {/* Community mosaic (using gradient tiles since image gen quota is exhausted) */}
          <div className="rounded-2xl border border-border overflow-hidden grid grid-cols-4 grid-rows-2 gap-0.5 bg-border h-64 sm:h-96">
            {[
              { bg: "bg-[#948be8]/20", label: "🧑‍💻 Building" },
              { bg: "bg-[#3f8cff]/20", label: "🤝 Collaborating" },
              { bg: "bg-[#18a981]/20", label: "🚀 Shipping" },
              { bg: "bg-[#ff6b6b]/20", label: "🏆 Winning" },
              { bg: "bg-[#6554e8]/20", label: "📣 Sharing" },
              { bg: "bg-[#18a981]/15", label: "🌍 Global" },
              { bg: "bg-[#948be8]/15", label: "⚡ Fast" },
              { bg: "bg-[#3f8cff]/15", label: "💡 Creating" },
            ].map((cell) => (
              <div key={cell.label} className={`${cell.bg} flex items-center justify-center text-sm font-medium text-foreground/60`}>
                {cell.label}
              </div>
            ))}
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Builders at our October 2026 hackathon — San Francisco
          </p>
        </div>
      </section>

      {/* ── Join online ── */}
      <section id="online" className="py-16 sm:py-20 border-y border-border bg-secondary/10 dark:bg-card/20 scroll-mt-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="flex flex-col lg:flex-row gap-12 items-center">
            <div className="flex-1">
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-4">Join online</h2>
              <p className="text-muted-foreground leading-relaxed text-sm sm:text-base mb-6">
                Connect with builders across the world in our Discord community. Get real-time help when you&apos;re stuck, share your builds, celebrate your launches, and find collaborators for your next idea. We&apos;re active 24/7 across every timezone.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  "#help-and-questions — get unstuck in minutes",
                  "#show-and-tell — share what you shipped",
                  "#cofounder-match — find your building partner",
                  "#events — upcoming hackathons and workshops",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-foreground/80">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                    <code className="text-primary">{item.split(" — ")[0]}</code>
                    <span className="text-muted-foreground"> — {item.split(" — ")[1]}</span>
                  </li>
                ))}
              </ul>
              <Link href="https://discord.gg/bigbag" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#5865F2] text-white rounded-full text-sm font-semibold hover:bg-[#4752C4] transition-colors">
                Join on Discord
                <ArrowUpRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="flex-1 w-full max-w-md">
              {/* Discord mockup */}
              <div className="rounded-2xl border border-border bg-[#313338] overflow-hidden">
                <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#5865F2]" />
                  <span className="text-[#f4f4f7] text-sm font-semibold"># show-and-tell</span>
                </div>
                <div className="p-4 space-y-3">
                  {[
                    { user: "anika_r", msg: "Just shipped my SaaS landing! 🚀", avatar: "AR", color: "#948be8" },
                    { user: "jt_builds", msg: "Wow looks amazing! What prompt did you use?", avatar: "JT", color: "#3f8cff" },
                    { user: "anika_r", msg: "Just described what I wanted, BigBag did the rest 🙌", avatar: "AR", color: "#948be8" },
                    { user: "lea_m", msg: "Love the color palette! Sharing this in #inspiration", avatar: "LM", color: "#18a981" },
                  ].map((msg, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0" style={{ background: msg.color }}>
                        {msg.avatar}
                      </div>
                      <div>
                        <span className="text-[11px] font-semibold" style={{ color: msg.color }}>{msg.user}</span>
                        <p className="text-[11px] text-[#dbdee1] leading-relaxed">{msg.msg}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Events / IRL ── */}
      <section id="irl" className="py-16 sm:py-20 scroll-mt-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground">
              Hackathons, buildathons, workshops.
            </h2>
            <p className="mt-3 text-muted-foreground text-sm sm:text-base max-w-xl mx-auto">
              Every event looks different, but they all share the same energy: a room full of people shipping something real. Events are organised by community members, with support from BigBag.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            {EVENTS.map((event) => (
              <div key={event.title} className="rounded-2xl border border-border bg-card p-5 flex items-start gap-4 hover:border-primary/30 transition-colors">
                <div className="w-12 h-12 rounded-xl border border-border bg-secondary/50 flex items-center justify-center text-2xl shrink-0">
                  {event.emoji}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{event.type}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${event.mode === "Online" ? "bg-[#18a981]/10 text-[#18a981]" : "bg-[#3f8cff]/10 text-[#3f8cff]"}`}>
                      {event.mode}
                    </span>
                  </div>
                  <h3 className="font-semibold text-foreground text-sm">{event.title}</h3>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{event.date}</span>
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{event.location}</span>
                    <span>{event.attendees} attending</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 text-center">
            <Link href="/events" className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80 font-medium transition-colors">
              View all events <ArrowUpRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Community leaders ── */}
      <section className="py-16 sm:py-20 border-y border-border bg-secondary/10 dark:bg-card/20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground">Become a community leader</h2>
            <p className="mt-3 text-muted-foreground text-sm max-w-xl mx-auto">
              Run events in your city, host online workshops, or become a Discord moderator. Leaders get early access, BigBag credits, and a direct line to our team.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {COMMUNITY_LEADERS.map((leader) => (
              <div key={leader.name} className="rounded-2xl border border-border bg-card p-5 text-center">
                <div className={`w-12 h-12 rounded-full mx-auto flex items-center justify-center text-white font-bold text-sm mb-3 ${leader.color}`}>
                  {leader.avatar}
                </div>
                <div className="font-semibold text-sm text-foreground">{leader.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{leader.role}</div>
                <div className="flex items-center justify-center gap-1 mt-1.5 text-xs text-muted-foreground">
                  <MapPin className="w-3 h-3" />{leader.city}
                </div>
                <div className="flex items-center justify-center gap-1 mt-1 text-xs text-primary">
                  <Star className="w-3 h-3" />{leader.projects} projects
                </div>
              </div>
            ))}
          </div>
          <div className="text-center mt-8">
            <Link href="mailto:community@bigbag.app" className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-full text-sm font-semibold hover:bg-primary/90 transition-colors">
              Apply to be a leader
            </Link>
          </div>
        </div>
      </section>

      {/* ── Member stories ── */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground">Stories from the community</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-5">
            {MEMBER_STORIES.map((story) => (
              <div key={story.name} className="rounded-2xl border border-border bg-card p-6 flex flex-col gap-4">
                <p className="text-sm text-foreground leading-relaxed flex-1">&ldquo;{story.quote}&rdquo;</p>
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${story.color}`}>
                    {story.avatar}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">{story.name}</div>
                    <div className="text-xs text-muted-foreground">{story.project}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-16 sm:py-20 bg-foreground dark:bg-card border-t border-border text-center">
        <div className="mx-auto max-w-xl px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-background dark:text-foreground">
            Your community is waiting
          </h2>
          <p className="mt-3 text-sm text-background/70 dark:text-muted-foreground">
            Join thousands of builders, attend your first event, and ship something you&apos;re proud of.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
            <Link href="https://discord.gg/bigbag" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-full text-sm font-semibold hover:bg-primary/90 transition-colors">
              Join the community
            </Link>
            <Link href="/login" className="inline-flex items-center gap-2 px-5 py-2.5 bg-background/10 dark:bg-accent text-background dark:text-foreground border border-background/20 dark:border-border rounded-full text-sm font-medium hover:bg-background/20 dark:hover:bg-accent/80 transition-colors">
              Start building
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
