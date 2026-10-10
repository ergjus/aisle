import { useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from 'lucide-react'
import { useStore } from '../store'
import type { PersonalizedDemoConfig, VenueFeatureId, VenuePreset } from '../types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from '@/components/ui/questionnaire'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  VENUE_FEATURE_IDS,
  VENUE_PRESET_DEFAULTS,
  expandVenuePreset,
  validateDimensions,
} from './planner'
import {
  recordOnboardingCompletion,
  recordOnboardingSkip,
  type OnboardingRecord,
} from './storage'

const QUESTION_ITEMS = [
  {
    name: 'venue',
    required: true,
    choices: [
      { value: 'ballroom' },
      { value: 'garden_tent' },
      { value: 'restaurant' },
      { value: 'custom' },
    ],
  },
  { name: 'dimensions', required: true },
  {
    name: 'tables',
    required: true,
    choices: [{ value: 'round' }, { value: 'banquet' }, { value: 'mixed' }],
  },
  { name: 'amenities', required: true },
] as const

type QuestionName = (typeof QUESTION_ITEMS)[number]['name']

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return reduced
}

/** Each preset's size is quoted from the planner, so the copy can't drift
 *  away from the room the guide actually builds. */
function presetSize(preset: VenuePreset): string {
  const { widthFt, lengthFt } = VENUE_PRESET_DEFAULTS[preset]
  return `${widthFt} × ${lengthFt} ft`
}

const PRESET_COPY: Record<VenuePreset, { label: string; description: string }> = {
  ballroom: { label: 'Ballroom', description: `A ${presetSize('ballroom')} room with a stage, dance floor, entrance, and restrooms.` },
  garden_tent: { label: 'Garden / Tent', description: `A ${presetSize('garden_tent')} open celebration with bar, buffet, band, and room to roam.` },
  restaurant: { label: 'Restaurant / Private Room', description: `A ${presetSize('restaurant')} private room with entrance, restrooms, and bar.` },
  custom: { label: 'Custom', description: `Start from a ${presetSize('custom')} room and make every choice yourself.` },
}

const FEATURE_LABELS: Record<VenueFeatureId, string> = {
  entrance: 'Entrance',
  dance_floor: 'Dance floor',
  band: 'Band',
  bathroom: 'Restrooms',
  photo_booth: 'Photo booth',
  bar: 'Bar',
  buffet: 'Buffet',
  cake_table: 'Cake table',
  gift_table: 'Gift table',
}

function initialConfig(): PersonalizedDemoConfig {
  const preset = expandVenuePreset('ballroom')
  return {
    venuePreset: 'ballroom',
    widthFt: preset.widthFt,
    lengthFt: preset.lengthFt,
    tableStyle: 'round',
    seatsPerTable: 8,
    amenities: preset.amenities,
  }
}

function AnimatedPanel({
  active,
  reducedMotion,
  children,
}: {
  active: boolean
  reducedMotion: boolean
  children: React.ReactNode
}) {
  return (
    <motion.div
      animate={active ? { opacity: 1, x: 0 } : { opacity: 0, x: 20 }}
      transition={{ duration: reducedMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

function QuestionnaireHeader({ eyebrow }: { eyebrow: string }) {
  return (
    <CardAction>
      <QuestionnaireProgress
        className="font-semibold tracking-[0.14em] text-foreground uppercase"
        render={(props, state) => (
          <span {...props}>
            {eyebrow} · {state.current}/{state.total}
          </span>
        )}
      />
    </CardAction>
  )
}

function QuestionnaireFooter({ onSkip }: { onSkip: () => void }) {
  return (
    <CardFooter>
      <QuestionnaireActions>
        <QuestionnairePrevious>
          <ArrowLeftIcon data-icon="inline-start" />
          Back
        </QuestionnairePrevious>
        <Button type="button" variant="ghost" onClick={onSkip}>
          Skip
        </Button>
        <QuestionnaireNext>
          Next
          <ArrowRightIcon data-icon="inline-end" />
        </QuestionnaireNext>
        <QuestionnaireSubmit>
          <CheckIcon data-icon="inline-start" />
          Finish
        </QuestionnaireSubmit>
      </QuestionnaireActions>
    </CardFooter>
  )
}

function VenueSketch({ reducedMotion }: { reducedMotion: boolean }) {
  const paths = (
    <svg viewBox="0 0 520 250" role="img" aria-label="A candlelit floor plan taking shape">
      <path className="welcome-sketch-room" d="M35 28 H485 V218 H35 Z" />
      <path className="welcome-sketch-detail" d="M330 52 H458 V140 H330 Z M55 52 H145 V92 H55 Z M55 166 H125 V202 H55 Z" />
      <circle className="welcome-sketch-table" cx="205" cy="92" r="29" />
      <circle className="welcome-sketch-table" cx="275" cy="160" r="29" />
      <circle className="welcome-sketch-table" cx="190" cy="178" r="29" />
      <path className="welcome-sketch-flourish" d="M357 179 C389 147 420 212 454 174" />
    </svg>
  )
  if (reducedMotion) return <div className="welcome-sketch">{paths}</div>
  return (
    <motion.div
      className="welcome-sketch"
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
    >
      {paths}
    </motion.div>
  )
}

function Sparkles({ reducedMotion }: { reducedMotion: boolean }) {
  if (reducedMotion) return null
  return (
    <div className="welcome-sparkles" aria-hidden="true">
      {Array.from({ length: 10 }, (_, index) => (
        <motion.span
          key={index}
          initial={{ opacity: 0, scale: 0.2, y: 8 }}
          animate={{ opacity: [0, 0.9, 0], scale: [0.2, 1, 0.7], y: -18 - (index % 3) * 8 }}
          transition={{ delay: index * 0.07, duration: 1.1 }}
          style={{ left: `${8 + index * 9}%` }}
        >
          ✦
        </motion.span>
      ))}
    </div>
  )
}

function FirstRunDialog({
  onSkipped,
  onRevealed,
}: {
  onSkipped: (record: OnboardingRecord) => void
  onRevealed: (record: OnboardingRecord) => void
}) {
  const reducedMotion = usePrefersReducedMotion()
  const [phase, setPhase] = useState<'welcome' | 'questions' | 'reveal'>('welcome')
  const [item, setItem] = useState<QuestionName>('venue')
  const [config, setConfig] = useState<PersonalizedDemoConfig>(initialConfig)
  const [plannerError, setPlannerError] = useState<{ question: 'dimensions' | 'amenities'; message: string } | null>(null)
  const [completedRecord, setCompletedRecord] = useState<OnboardingRecord | null>(null)
  const welcomeButtonRef = useRef<HTMLButtonElement>(null)
  const widthRef = useRef<HTMLInputElement>(null)
  const dimensionsTitleId = useId()
  const venueTitleId = useId()
  const tablesTitleId = useId()
  const amenitiesTitleId = useId()

  const dimensionErrors = validateDimensions(config.widthFt, config.lengthFt)

  const skip = () => onSkipped(recordOnboardingSkip())
  const focusCurrentQuestion = () => {
    const activeQuestion = document.querySelector<HTMLElement>('fieldset[data-slot="questionnaire-item"]:not([hidden])')
    activeQuestion?.querySelector<HTMLElement>('input:not([disabled]):not([tabindex="-1"]), button:not([disabled]), [tabindex="0"]')?.focus()
  }

  useEffect(() => {
    if (phase !== 'questions') return
    const frame = window.requestAnimationFrame(focusCurrentQuestion)
    return () => window.cancelAnimationFrame(frame)
  }, [item, phase])

  useEffect(() => {
    if (phase !== 'reveal' || reducedMotion || !completedRecord) return
    const timer = window.setTimeout(() => onRevealed(completedRecord), 2200)
    return () => window.clearTimeout(timer)
  }, [completedRecord, onRevealed, phase, reducedMotion])

  const choosePreset = (venuePreset: VenuePreset) => {
    const preset = expandVenuePreset(venuePreset)
    setConfig((current) => ({
      ...current,
      venuePreset,
      widthFt: preset.widthFt,
      lengthFt: preset.lengthFt,
      amenities: preset.amenities,
    }))
    setPlannerError(null)
  }

  const toggleAmenity = (id: VenueFeatureId, checked: boolean) => {
    setConfig((current) => ({
      ...current,
      amenities: checked
        ? VENUE_FEATURE_IDS.filter((featureId) => featureId === id || current.amenities.includes(featureId))
        : current.amenities.filter((featureId) => featureId !== id),
    }))
    setPlannerError(null)
  }

  const validateDimensionStep = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (item !== 'dimensions') return
    const errors = validateDimensions(config.widthFt, config.lengthFt)
    if (!errors.widthFt && !errors.lengthFt) return
    event.preventDefault()
    setPlannerError({ question: 'dimensions', message: errors.widthFt ?? errors.lengthFt! })
    widthRef.current?.focus()
  }

  const finish = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const errors = validateDimensions(config.widthFt, config.lengthFt)
    if (errors.widthFt || errors.lengthFt) {
      setPlannerError({ question: 'dimensions', message: errors.widthFt ?? errors.lengthFt! })
      setItem('dimensions')
      window.requestAnimationFrame(() => widthRef.current?.focus())
      return
    }
    const store = useStore.getState()
    const result = store.loadPersonalizedSample(config)
    if (!result.ok) {
      setPlannerError(result)
      setItem(result.question === 'dimensions' ? 'dimensions' : 'amenities')
      store.setToast(result.message)
      window.requestAnimationFrame(() => {
        const selector = result.question === 'dimensions' ? '#welcome-width' : '[data-amenity-choice] [role="checkbox"]'
        document.querySelector<HTMLElement>(selector)?.focus()
      })
      return
    }
    const savedConfig = result.state.demoMetadata!.config
    const record = recordOnboardingCompletion(savedConfig)
    setCompletedRecord(record)
    setConfig(savedConfig)
    setPhase('reveal')
    store.logActivity(
      'personalized sample',
      `Built a ${savedConfig.widthFt} × ${savedConfig.lengthFt} ft demo with ${result.attendingCount} attending guests and ${result.totalCapacity} seats.`,
      'you',
    )
  }

  return (
    <Dialog
      open
      modal
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (!open && details.reason === 'escape-key') skip()
      }}
    >
      <DialogContent
        fullscreen
        className="welcome-dialog"
        data-reduced-motion={reducedMotion || undefined}
        showCloseButton={false}
        initialFocus={phase === 'welcome' ? welcomeButtonRef : true}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Welcome to Aisle</DialogTitle>
          <DialogDescription>Set up a sample wedding in your kind of room in four quick questions.</DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {phase === 'welcome' ? (
            <motion.main
              key="welcome"
              className="welcome-intro"
              initial={reducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reducedMotion ? undefined : { opacity: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.35 }}
            >
              <div className="welcome-candle" aria-hidden="true"><span /></div>
              <p className="welcome-kicker">A room begins with a little light</p>
              <h2>Let&rsquo;s set the table for your kind of celebration.</h2>
              <p className="welcome-deck">
                Four quick choices build a room in your venue&rsquo;s shape, seated with a sample wedding of 72 guests and
                real seating rules, so you can see how it works before adding your own list.
              </p>
              <VenueSketch reducedMotion={reducedMotion} />
              <div className="welcome-intro-actions">
                <Button ref={welcomeButtonRef} size="lg" onClick={() => setPhase('questions')}>
                  Welcome
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
                <Button variant="ghost" size="lg" onClick={skip}>Skip</Button>
              </div>
            </motion.main>
          ) : phase === 'questions' ? (
            <motion.main
              key="questions"
              className="welcome-questionnaire-shell"
              initial={reducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reducedMotion ? undefined : { opacity: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.25 }}
              onAnimationComplete={focusCurrentQuestion}
            >
              <Questionnaire
                item={item}
                items={QUESTION_ITEMS}
                onItemChange={(next) => {
                  setPlannerError(null)
                  setItem(next as QuestionName)
                }}
                onSubmit={finish}
                shortcuts="numbers"
              >
                <QuestionnaireItem aria-labelledby={venueTitleId} name="venue" required>
                  <AnimatedPanel active={item === 'venue'} reducedMotion={reducedMotion}>
                    <Card className="welcome-card">
                      <CardHeader>
                        <QuestionnaireTitle id={venueTitleId} render={<CardTitle />}>
                          Where are we celebrating?
                        </QuestionnaireTitle>
                        <QuestionnaireDescription render={<CardDescription />}>
                          Pick a starting point. You can refine every measurement next.
                        </QuestionnaireDescription>
                        <QuestionnaireHeader eyebrow="The room" />
                      </CardHeader>
                      <CardContent>
                        <QuestionnaireChoices className="sm:grid-cols-2">
                          {(Object.keys(PRESET_COPY) as VenuePreset[]).map((preset) => (
                            <QuestionnaireChoice
                              key={preset}
                              value={preset}
                              checked={config.venuePreset === preset}
                              onChange={() => choosePreset(preset)}
                            >
                              <span className="font-medium">{PRESET_COPY[preset].label}</span>
                              <QuestionnaireChoiceDescription>{PRESET_COPY[preset].description}</QuestionnaireChoiceDescription>
                            </QuestionnaireChoice>
                          ))}
                        </QuestionnaireChoices>
                        <QuestionnaireError />
                      </CardContent>
                      <QuestionnaireFooter onSkip={skip} />
                    </Card>
                  </AnimatedPanel>
                </QuestionnaireItem>

                <QuestionnaireItem aria-labelledby={dimensionsTitleId} name="dimensions" required>
                  <AnimatedPanel active={item === 'dimensions'} reducedMotion={reducedMotion}>
                    <Card className="welcome-card">
                      <CardHeader>
                        <QuestionnaireTitle id={dimensionsTitleId} render={<CardTitle />}>
                          Give the room its true proportions.
                        </QuestionnaireTitle>
                        <QuestionnaireDescription render={<CardDescription />}>
                          Exact feet keep the floor plan honest. The preset already has room for every
                          amenity and all 72 guests — grow it if your venue is larger.
                        </QuestionnaireDescription>
                        <QuestionnaireHeader eyebrow="Dimensions" />
                      </CardHeader>
                      <CardContent>
                        <QuestionnaireInput
                          aria-label="Room dimension summary"
                          className="sr-only"
                          tabIndex={-1}
                          value={`${config.widthFt} by ${config.lengthFt}`}
                          readOnly
                        />
                        <FieldGroup className="sm:flex-row">
                          <Field data-invalid={Boolean(dimensionErrors.widthFt)}>
                            <FieldLabel htmlFor="welcome-width">Width</FieldLabel>
                            <Input
                              ref={widthRef}
                              id="welcome-width"
                              type="number"
                              inputMode="numeric"
                              min={20}
                              max={300}
                              value={config.widthFt}
                              aria-invalid={Boolean(dimensionErrors.widthFt)}
                              aria-describedby="welcome-width-help"
                              onChange={(event) => {
                                setConfig((current) => ({ ...current, widthFt: Number(event.target.value) }))
                                setPlannerError(null)
                              }}
                            />
                            <FieldDescription id="welcome-width-help">20–300 ft</FieldDescription>
                          </Field>
                          <Field data-invalid={Boolean(dimensionErrors.lengthFt)}>
                            <FieldLabel htmlFor="welcome-length">Length</FieldLabel>
                            <Input
                              id="welcome-length"
                              type="number"
                              inputMode="numeric"
                              min={15}
                              max={200}
                              value={config.lengthFt}
                              aria-invalid={Boolean(dimensionErrors.lengthFt)}
                              aria-describedby="welcome-length-help"
                              onChange={(event) => {
                                setConfig((current) => ({ ...current, lengthFt: Number(event.target.value) }))
                                setPlannerError(null)
                              }}
                            />
                            <FieldDescription id="welcome-length-help">15–200 ft</FieldDescription>
                          </Field>
                        </FieldGroup>
                        <FieldError>{plannerError?.question === 'dimensions' ? plannerError.message : undefined}</FieldError>
                      </CardContent>
                      <CardFooter>
                        <QuestionnaireActions>
                          <QuestionnairePrevious>
                            <ArrowLeftIcon data-icon="inline-start" />
                            Back
                          </QuestionnairePrevious>
                          <Button type="button" variant="ghost" onClick={skip}>Skip</Button>
                          <QuestionnaireNext onClick={validateDimensionStep}>
                            Next
                            <ArrowRightIcon data-icon="inline-end" />
                          </QuestionnaireNext>
                          <QuestionnaireSubmit>Finish</QuestionnaireSubmit>
                        </QuestionnaireActions>
                      </CardFooter>
                    </Card>
                  </AnimatedPanel>
                </QuestionnaireItem>

                <QuestionnaireItem aria-labelledby={tablesTitleId} name="tables" required>
                  <AnimatedPanel active={item === 'tables'} reducedMotion={reducedMotion}>
                    <Card className="welcome-card">
                      <CardHeader>
                        <QuestionnaireTitle id={tablesTitleId} render={<CardTitle />}>
                          How should the tables read across the room?
                        </QuestionnaireTitle>
                        <QuestionnaireDescription render={<CardDescription />}>
                          Aisle will make enough tables for everyone, with a little breathing room.
                        </QuestionnaireDescription>
                        <QuestionnaireHeader eyebrow="Table plan" />
                      </CardHeader>
                      <CardContent className="flex flex-col gap-6">
                        <QuestionnaireChoices className="sm:grid-cols-3">
                          {([
                            ['round', 'Round', 'Conversation-first circles.'],
                            ['banquet', 'Banquet', 'Long, editorial rows.'],
                            ['mixed', 'Mixed', 'One 10-seat head table with rounds.'],
                          ] as const).map(([value, label, description]) => (
                            <QuestionnaireChoice
                              key={value}
                              value={value}
                              checked={config.tableStyle === value}
                              onChange={() => setConfig((current) => ({ ...current, tableStyle: value }))}
                            >
                              <span className="font-medium">{label}</span>
                              <QuestionnaireChoiceDescription>{description}</QuestionnaireChoiceDescription>
                            </QuestionnaireChoice>
                          ))}
                        </QuestionnaireChoices>
                        <FieldSet>
                          <FieldLegend variant="label">Seats per table</FieldLegend>
                          <ToggleGroup
                            aria-label="Seats per table"
                            value={[String(config.seatsPerTable)]}
                            onValueChange={(values) => {
                              const next = Number(values[0])
                              if (next === 6 || next === 8 || next === 10) {
                                setConfig((current) => ({ ...current, seatsPerTable: next }))
                              }
                            }}
                            variant="outline"
                          >
                            {[6, 8, 10].map((seats) => (
                              <ToggleGroupItem key={seats} value={String(seats)}>{seats} seats</ToggleGroupItem>
                            ))}
                          </ToggleGroup>
                        </FieldSet>
                        <QuestionnaireError />
                      </CardContent>
                      <QuestionnaireFooter onSkip={skip} />
                    </Card>
                  </AnimatedPanel>
                </QuestionnaireItem>

                <QuestionnaireItem aria-labelledby={amenitiesTitleId} name="amenities" required>
                  <AnimatedPanel active={item === 'amenities'} reducedMotion={reducedMotion}>
                    <Card className="welcome-card">
                      <CardHeader>
                        <QuestionnaireTitle id={amenitiesTitleId} render={<CardTitle />}>
                          What is in the room?
                        </QuestionnaireTitle>
                        <QuestionnaireDescription render={<CardDescription />}>
                          Pick the amenities your venue has. Rules like &ldquo;near the dance floor&rdquo; are measured from where they sit.
                        </QuestionnaireDescription>
                        <QuestionnaireHeader eyebrow="Amenities" />
                      </CardHeader>
                      <CardContent className="flex flex-col gap-6">
                        <QuestionnaireInput
                          aria-label="Chosen amenities"
                          className="sr-only"
                          tabIndex={-1}
                          value={config.amenities.join(', ') || 'none'}
                          readOnly
                        />
                        <FieldSet>
                          <FieldLegend variant="label">Venue amenities</FieldLegend>
                          <FieldGroup data-slot="checkbox-group" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            {VENUE_FEATURE_IDS.map((id) => (
                              <Field key={id} orientation="horizontal" data-amenity-choice>
                                <Checkbox
                                  id={`amenity-${id}`}
                                  checked={config.amenities.includes(id)}
                                  onCheckedChange={(next) => toggleAmenity(id, next)}
                                />
                                <FieldLabel htmlFor={`amenity-${id}`} className="font-normal">
                                  {FEATURE_LABELS[id]}
                                </FieldLabel>
                              </Field>
                            ))}
                          </FieldGroup>
                        </FieldSet>
                        {plannerError?.question === 'amenities' ? (
                          <Alert variant="destructive">
                            <AlertTitle>The room needs another edit</AlertTitle>
                            <AlertDescription>{plannerError.message}</AlertDescription>
                          </Alert>
                        ) : null}
                        <QuestionnaireError />
                      </CardContent>
                      <QuestionnaireFooter onSkip={skip} />
                    </Card>
                  </AnimatedPanel>
                </QuestionnaireItem>
              </Questionnaire>
            </motion.main>
          ) : (
            <motion.main
              key="reveal"
              className="welcome-reveal"
              initial={reducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reducedMotion ? 0 : 0.35 }}
            >
              <Sparkles reducedMotion={reducedMotion} />
              <p className="welcome-kicker">The room is ready</p>
              <h2>{PRESET_COPY[config.venuePreset].label}, set in candlelight.</h2>
              <p className="welcome-deck">
                {config.widthFt} × {config.lengthFt} ft · {config.tableStyle === 'mixed' ? 'Mixed tables' : `${config.tableStyle} tables`} · 72 sample guests seated
              </p>
              <VenueSketch reducedMotion={reducedMotion} />
              <Button size="lg" onClick={() => completedRecord && onRevealed(completedRecord)}>
                Open the room
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </motion.main>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  )
}

export default function OnboardingExperience({
  initialFirstRun,
  sampleRoomRequest,
}: {
  initialFirstRun: boolean
  /** Bumped by the header's "Set up a sample room…" to reopen the questionnaire. */
  sampleRoomRequest: number
}) {
  const [showFirstRun, setShowFirstRun] = useState(initialFirstRun)
  const seenRequest = useRef(0)

  useEffect(() => {
    if (sampleRoomRequest === 0 || sampleRoomRequest === seenRequest.current) return
    seenRequest.current = sampleRoomRequest
    setShowFirstRun(true)
  }, [sampleRoomRequest])

  if (!showFirstRun) return null
  return (
    <FirstRunDialog
      onSkipped={() => setShowFirstRun(false)}
      onRevealed={() => {
        setShowFirstRun(false)
        // The room was just built to be looked at: open the floor plan on it.
        useStore.getState().openChart()
      }}
    />
  )
}
