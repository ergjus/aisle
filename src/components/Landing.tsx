import { useMemo, useState, type ReactNode } from 'react'
import { ArrowRight, Check, FileText, Link2, MessageSquareText, Printer, ShieldCheck, Sparkles, Users } from 'lucide-react'
import { useStore } from '../store'
import { SAMPLE } from '../sample'
import { seatedSampleChart } from '../landing/sample'
import { FloorPlanSvg } from '../export/FloorPlanSvg'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import '../landing/landing.css'

/**
 * The front door, for visitors with no wedding here yet. It follows what the
 * strongest product pages of 2026 do and what the rest don't: one outcome
 * headline, the real product on screen before any sign-up, a sentence of
 * specificity under it, trust next to the button, then how it works, what
 * you get, the price, and the questions a couple actually asks. It stays in
 * Aisle's own ivory-and-pine stationery, which is the one thing a dark
 * gradient SaaS page can't copy.
 */

const CHAT: { who: 'you' | 'agent'; text: string }[] = [
  { who: 'you', text: 'Keep my parents at separate tables, Grandma Rosa far from the band, then seat everyone with families together.' },
  { who: 'agent', text: 'Done. Marta is at Table 2 and Dario at Table 7, the room\'s two ends. Rosa has Table 1 by the entrance, with Bianca beside her. All 70 guests are seated and every rule holds.' },
]

const STEPS = [
  {
    n: '1',
    title: 'Bring the list',
    text: 'Paste names out of Google Sheets or Excel, or import the guest list you already keep on Zola, The Knot or WeddingWire. Groups and RSVPs come along.',
  },
  {
    n: '2',
    title: 'Say the rules',
    text: 'In plain words: keep these two apart, these two together, Grandma away from the speakers. The usual ones are a click; the agent takes the rest.',
  },
  {
    n: '3',
    title: 'Open the room',
    text: 'The solver seats the whole room in a second and explains every trade-off. Drag anyone you like; the chart tells you the moment a rule breaks and fixes it on request.',
  },
]

const FEATURES: { icon: typeof Users; title: string; text: string }[] = [
  {
    icon: MessageSquareText,
    title: 'An agent that asks before it moves anyone',
    text: 'Big changes arrive as a proposal you keep or revert. Every step is undoable. A seat you pin stays yours, and the agent says so when it is asked to move it.',
  },
  {
    icon: ShieldCheck,
    title: 'Rules that stay kept',
    text: 'Together, apart, near the dance floor, far from the band. The chart checks them on every drag and shows exactly which one broke and who is involved.',
  },
  {
    icon: Printer,
    title: 'A document for the venue',
    text: 'A to-scale floor plan, table cards with dietary notes, an A to Z "find your seat" list and a catering summary. Letter or A4, saved as PDF in one keystroke.',
  },
  {
    icon: Link2,
    title: 'A link for your mother',
    text: 'Share a view-only chart with family, the planner or the caterer. The chart travels inside the link itself; nothing is uploaded unless you want an account.',
  },
]

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Do I need an account to start?',
    a: 'No. Your chart lives in this browser until you choose to save it to an account, which you can do later to work on it from another device or with your partner.',
  },
  {
    q: 'Where does my guest list go?',
    a: 'Nowhere, by default. The seating solver runs on your device. When you ask the agent for something, only the chart it needs to answer is sent, and it is not kept.',
  },
  {
    q: 'What does it cost?',
    a: 'Nothing for up to 40 guests, with every feature on. A larger wedding is one payment for the whole wedding, not a subscription you have to remember to cancel.',
  },
  {
    q: 'Can I use it on my phone?',
    a: 'The guest list, the rules and the agent work on a phone today. The floor plan is best on a laptop or a tablet, where you can see the whole room at once.',
  },
  {
    q: 'I am a planner. Is this for me?',
    a: 'Yes. Each wedding is its own chart, the printed document carries the venue\'s name and the date, and the share link is how you send a draft to a client.',
  },
]

function Section({ id, kicker, title, lede, children, className }: {
  id?: string
  kicker: string
  title: string
  lede?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section id={id} className={cn('landing-section', className)}>
      <div className="landing-inner">
        <header className="landing-section-head">
          <p className="smallcaps landing-kicker">{kicker}</p>
          <h2 className="landing-h2">{title}</h2>
          {lede && <p className="landing-lede">{lede}</p>}
        </header>
        {children}
      </div>
    </section>
  )
}

export function Landing() {
  const enterApp = useStore((s) => s.enterApp)
  const loadSample = useStore((s) => s.loadSample)
  const logActivity = useStore((s) => s.logActivity)
  const openChart = useStore((s) => s.openChart)
  const chart = useMemo(seatedSampleChart, [])
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  const start = () => enterApp()
  const seeSample = () => {
    enterApp()
    loadSample(SAMPLE)
    logActivity('load sample', 'Loaded the sample wedding: 72 guests, 10 tables, 17 rules.', 'you')
    openChart()
  }

  const seated = Object.keys(chart.seating).length

  return (
    <div className="landing">
      <nav className="landing-nav" aria-label="Site">
        <div className="landing-inner landing-nav-row">
          <span className="landing-wordmark">
            <span className="masthead-fleuron" aria-hidden="true">❦</span>
            Aisle
          </span>
          <div className="landing-nav-links">
            <a href="#how">How it works</a>
            <a href="#what">What you get</a>
            <a href="#price">Price</a>
            <a href="#faq">Questions</a>
          </div>
          <div className="landing-nav-actions">
            <Button size="sm" className="h-8 px-3.5 text-[12.5px] font-semibold" onClick={start}>
              Start free
            </Button>
          </div>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-inner landing-hero-grid">
          <div className="landing-hero-copy">
            <p className="smallcaps landing-kicker landing-reveal">Wedding seating, settled</p>
            <h1 className="landing-h1 landing-reveal">
              Seat the whole room
              <br />
              without a single argument.
            </h1>
            <p className="landing-lede landing-reveal">
              Paste your guest list, say who cannot sit with whom, and Aisle seats everyone in a second, then explains every choice. Drag anyone you like. Print it for the venue, send a link to your mother.
            </p>
            <div className="landing-cta-row landing-reveal">
              <Button className="h-11 px-5 text-[14px] font-semibold" onClick={start}>
                Start your seating chart
                <ArrowRight data-icon="inline-end" className="size-4" aria-hidden="true" />
              </Button>
              <Button variant="outline" className="h-11 px-5 text-[14px]" onClick={seeSample}>
                <Sparkles data-icon="inline-start" className="size-4" aria-hidden="true" />
                See the sample wedding
              </Button>
            </div>
            <ul className="landing-trust landing-reveal">
              <li><Check aria-hidden="true" /> Free for up to 40 guests</li>
              <li><Check aria-hidden="true" /> No account to start</li>
              <li><Check aria-hidden="true" /> Your list stays in your browser</li>
            </ul>
          </div>

          <div className="landing-hero-art" aria-hidden="true">
            <div className="landing-sheet">
              <FloorPlanSvg state={chart} fitW={620} fitH={430} idPrefix="landing" />
              <div className="landing-sheet-foot">
                <span className="smallcaps">The sample wedding</span>
                <span className="figures">{seated} of {chart.guestOrder.length} seated · 10 tables · 17 rules kept</span>
              </div>
            </div>
            <div className="landing-chat">
              {CHAT.map((m, i) => (
                <div key={i} className={cn('landing-chat-msg', `landing-chat-${m.who}`)} style={{ animationDelay: `${0.9 + i * 0.9}s` }}>
                  {m.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <Section
        id="how"
        kicker="How it works"
        title="Three steps, and the room is seated."
        lede="Most couples finish the first draft in the time it takes to pour a coffee. The rest of the evening is the fun part: moving people around and watching the rules hold."
      >
        <ol className="landing-steps">
          {STEPS.map((step) => (
            <li key={step.n} className="landing-step">
              <span className="landing-step-n figures">{step.n}</span>
              <h3 className="landing-h3">{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <section className="landing-quote">
        <div className="landing-inner">
          <blockquote>
            <p>"Keep the exes apart, put the college friends by the dance floor, and Grandma Rosa nowhere near the speakers."</p>
            <footer>
              <span>That is the whole instruction. The agent reads it, writes the rules, seats the room, and tells you what it did.</span>
            </footer>
          </blockquote>
        </div>
      </section>

      <Section
        id="what"
        kicker="What you get"
        title="A seating chart that behaves like a good planner."
        lede="Not a drag-and-drop grid that lets you break your own rules. The chart knows the rules, keeps them, and hands you something you can pin up at the venue."
      >
        <div className="landing-features">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <article key={title} className="landing-feature">
              <Icon className="landing-feature-icon" aria-hidden="true" />
              <h3 className="landing-h3">{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section
        id="price"
        kicker="Price"
        title="Free to start. One price for the whole wedding."
        lede="No subscription. A seating chart is finished the day of the wedding, so the price is too."
      >
        <div className="landing-plans">
          <article className="landing-plan">
            <h3 className="landing-h3">Free</h3>
            <p className="landing-price"><span className="figures">$0</span></p>
            <p className="landing-plan-for">Up to 40 guests, every feature on.</p>
            <ul>
              <li><Check aria-hidden="true" /> The solver, the rules and the agent</li>
              <li><Check aria-hidden="true" /> Floor plan with every amenity</li>
              <li><Check aria-hidden="true" /> Print and share, with a small Aisle mark</li>
            </ul>
            <Button variant="outline" className="h-10 w-full text-[13.5px]" onClick={start}>Start free</Button>
          </article>
          <article className="landing-plan landing-plan-paid">
            <h3 className="landing-h3">The wedding</h3>
            <p className="landing-price"><span className="figures">$39</span> <span className="landing-price-note">once</span></p>
            <p className="landing-plan-for">Every guest, every table, until the big day.</p>
            <ul>
              <li><Check aria-hidden="true" /> Unlimited guests and tables</li>
              <li><Check aria-hidden="true" /> The printed document, unmarked</li>
              <li><Check aria-hidden="true" /> Share links without the mark</li>
              <li><Check aria-hidden="true" /> Saved to your account, with your partner</li>
            </ul>
            <Button className="h-10 w-full text-[13.5px] font-semibold" onClick={start}>Start free, upgrade when you need to</Button>
          </article>
        </div>
      </Section>

      <Section id="faq" kicker="Questions" title="The ones every couple asks." className="landing-section-faq">
        <dl className="landing-faq">
          {FAQ.map((item, i) => {
            const open = openFaq === i
            return (
              <div key={item.q} className={cn('landing-faq-item', open && 'landing-faq-open')}>
                <dt>
                  <button type="button" aria-expanded={open} onClick={() => setOpenFaq(open ? null : i)}>
                    {item.q}
                    <span className="landing-faq-mark" aria-hidden="true">{open ? '–' : '+'}</span>
                  </button>
                </dt>
                {open && <dd>{item.a}</dd>}
              </div>
            )
          })}
        </dl>
      </Section>

      <section className="landing-close">
        <div className="landing-inner landing-close-row">
          <div>
            <h2 className="landing-h2">Your guest list is ready. The room is waiting.</h2>
            <p className="landing-lede">Start with your own list, or walk through the sample wedding first.</p>
          </div>
          <div className="landing-cta-row">
            <Button className="h-11 px-5 text-[14px] font-semibold" onClick={start}>
              Start your seating chart
              <ArrowRight data-icon="inline-end" className="size-4" aria-hidden="true" />
            </Button>
            <Button variant="outline" className="h-11 px-5 text-[14px]" onClick={seeSample}>
              <FileText data-icon="inline-start" className="size-4" aria-hidden="true" />
              See the sample
            </Button>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-inner landing-footer-row">
          <span className="landing-wordmark landing-wordmark-small">
            <span className="masthead-fleuron" aria-hidden="true">❦</span>
            Aisle
          </span>
          <span>Made for couples, and for the planners and venues who look after them.</span>
          <div className="landing-footer-links">
            <a href="#how">How it works</a>
            <a href="#price">Price</a>
            <a href="#faq">Questions</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
