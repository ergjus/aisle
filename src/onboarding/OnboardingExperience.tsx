import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, SparklesIcon } from 'lucide-react'
import { seatEveryone } from '../actions'
import { useStore } from '../store'
import type { DemoPriority, PersonalizedDemoConfig, VenueFeatureId, VenuePreset } from '../types'
import { cn } from '@/lib/utils'
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
  amenitiesForPriority,
  expandVenuePreset,
  validateDimensions,
} from './planner'
import {
  createAssistedChallengeViolation,
  challengePauseReason,
  isChallengeStepComplete,
} from './challenge'
import {
  readOnboardingRecord,
  recordOnboardingCompletion,
  recordOnboardingSkip,
  updatePersistedChallenge,
  type ChallengeStep,
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
  {
    name: 'focus',
    required: true,
    choices: [
      { value: 'family_harmony' },
      { value: 'dance_floor_energy' },
      { value: 'easy_arrivals' },
    ],
  },
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

const PRIORITY_COPY: Record<DemoPriority, { label: string; description: string }> = {
  family_harmony: { label: 'Family harmony', description: 'Learn to spot and repair a delicate people conflict.' },
  dance_floor_energy: { label: 'Dance-floor energy', description: 'Keep a dance lover inside the near-floor band.' },
  easy_arrivals: { label: 'Easy arrivals', description: 'Keep an arrival-watcher close to the entrance.' },
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
    priority: 'family_harmony',
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
  const focusTitleId = useId()

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
    const normalizedConfig = {
      ...config,
      amenities: amenitiesForPriority(config.amenities, config.priority),
    }
    const store = useStore.getState()
    const result = store.loadPersonalizedSample(normalizedConfig)
    if (!result.ok) {
      setPlannerError(result)
      setItem(result.question === 'dimensions' ? 'dimensions' : 'focus')
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
          <DialogDescription>Configure a local personalized sample wedding in four quick questions.</DialogDescription>
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
                Four quick choices shape a private, local demo using Aisle&rsquo;s 72 named guests and real seating rules.
                Nothing is sent anywhere.
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
                          Aisle will make enough tables for everyone plus breathing room for the challenge.
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

                <QuestionnaireItem aria-labelledby={focusTitleId} name="focus" required>
                  <AnimatedPanel active={item === 'focus'} reducedMotion={reducedMotion}>
                    <Card className="welcome-card">
                      <CardHeader>
                        <QuestionnaireTitle id={focusTitleId} render={<CardTitle />}>
                          Add the details that make the room yours.
                        </QuestionnaireTitle>
                        <QuestionnaireDescription render={<CardDescription />}>
                          Choose amenities, then choose the lesson you want the demo to teach.
                        </QuestionnaireDescription>
                        <QuestionnaireHeader eyebrow="Details & focus" />
                      </CardHeader>
                      <CardContent className="flex flex-col gap-6">
                        <FieldSet>
                          <FieldLegend variant="label">Venue amenities</FieldLegend>
                          <FieldDescription>
                            Dance-floor energy always includes a dance floor; Easy arrivals always includes an entrance.
                          </FieldDescription>
                          <FieldGroup data-slot="checkbox-group" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            {VENUE_FEATURE_IDS.map((id) => {
                              const forced = (config.priority === 'dance_floor_energy' && id === 'dance_floor') ||
                                (config.priority === 'easy_arrivals' && id === 'entrance')
                              const checked = forced || config.amenities.includes(id)
                              return (
                                <Field key={id} orientation="horizontal" data-amenity-choice>
                                  <Checkbox
                                    id={`amenity-${id}`}
                                    checked={checked}
                                    disabled={forced}
                                    onCheckedChange={(next) => toggleAmenity(id, next)}
                                  />
                                  <FieldLabel htmlFor={`amenity-${id}`} className="font-normal">
                                    {FEATURE_LABELS[id]}
                                  </FieldLabel>
                                </Field>
                              )
                            })}
                          </FieldGroup>
                        </FieldSet>
                        <FieldSet>
                          <FieldLegend variant="label">Demo focus</FieldLegend>
                          <QuestionnaireChoices className="sm:grid-cols-3">
                            {(Object.keys(PRIORITY_COPY) as DemoPriority[]).map((priority) => (
                              <QuestionnaireChoice
                                key={priority}
                                value={priority}
                                checked={config.priority === priority}
                                onChange={() => {
                                  setConfig((current) => ({ ...current, priority }))
                                  setPlannerError(null)
                                }}
                              >
                                <span className="font-medium">{PRIORITY_COPY[priority].label}</span>
                                <QuestionnaireChoiceDescription>{PRIORITY_COPY[priority].description}</QuestionnaireChoiceDescription>
                              </QuestionnaireChoice>
                            ))}
                          </QuestionnaireChoices>
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
                {config.widthFt} × {config.lengthFt} ft · {config.tableStyle === 'mixed' ? 'Mixed tables' : `${config.tableStyle} tables`} · {PRIORITY_COPY[config.priority].label}
              </p>
              <VenueSketch reducedMotion={reducedMotion} />
              <Button size="lg" onClick={() => completedRecord && onRevealed(completedRecord)}>
                Begin the challenge
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </motion.main>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  )
}

const CHALLENGE_STEPS: Record<DemoPriority, readonly { title: string; body: string; target: string }[]> = {
  family_harmony: [
    { title: 'Seat the room', body: 'Use Seat Everyone. The solver will honor all 17 sample rules.', target: '[data-tour="seat-everyone"]' },
    { title: 'Create a little tension', body: 'Drag Sam Whitfield onto Jordan Banks’s table so their apart rule breaks.', target: '[data-tour-guest="g-sam"]' },
    { title: 'Repair with restraint', body: 'Use Fix With Minimal Moves and watch the solver disturb as few seats as possible.', target: '[data-tour="violation-banner"]' },
  ],
  dance_floor_energy: [
    { title: 'Seat the room', body: 'Use Seat Everyone. The solver will honor all 17 sample rules.', target: '[data-tour="seat-everyone"]' },
    { title: 'Test the dance-floor band', body: 'Move Priya Sharma to a table outside the near-dance-floor band.', target: '[data-tour-guest="g-priya"]' },
    { title: 'Repair with restraint', body: 'Use Fix With Minimal Moves and watch Priya return with the smallest repair.', target: '[data-tour="violation-banner"]' },
  ],
  easy_arrivals: [
    { title: 'Seat the room', body: 'Use Seat Everyone. The solver will honor all 17 sample rules.', target: '[data-tour="seat-everyone"]' },
    { title: 'Test an arrival rule', body: 'Move Dot Pemberton away from the entrance.', target: '[data-tour-guest="g-dot"]' },
    { title: 'Repair with restraint', body: 'Use Fix With Minimal Moves and bring Dot back near the entrance.', target: '[data-tour="violation-banner"]' },
  ],
}

function useTargetHighlight(selector: string | null) {
  const [targetLow, setTargetLow] = useState(false)
  useEffect(() => {
    if (!selector) return
    const target = document.querySelector<HTMLElement>(selector)
    if (!target) return
    target.classList.add('welcome-tour-highlight')
    const measure = () => setTargetLow(target.getBoundingClientRect().top > window.innerHeight * 0.55)
    measure()
    window.addEventListener('resize', measure)
    return () => {
      target.classList.remove('welcome-tour-highlight')
      window.removeEventListener('resize', measure)
    }
  }, [selector])
  return targetLow
}

function CoachCard({
  priority,
  initialStep,
  onChanged,
}: {
  priority: DemoPriority
  initialStep: ChallengeStep
  onChanged: (record: OnboardingRecord | null) => void
}) {
  const state = useStore()
  const reducedMotion = usePrefersReducedMotion()
  const [step, setStep] = useState<ChallengeStep>(initialStep)
  const [celebrating, setCelebrating] = useState(false)
  const pauseReason = challengePauseReason(state, priority)
  const definition = CHALLENGE_STEPS[priority][step]
  const targetLow = useTargetHighlight(pauseReason ? null : definition.target)

  useEffect(() => {
    if (pauseReason || !isChallengeStepComplete(state, priority, step)) return
    if (step < 2) {
      const next = (step + 1) as ChallengeStep
      setStep(next)
      onChanged(updatePersistedChallenge({ step: next }))
      return
    }
    setCelebrating(true)
    updatePersistedChallenge({ status: 'completed', step: 2 })
  }, [onChanged, pauseReason, priority, state, step])

  const skip = () => onChanged(updatePersistedChallenge({ status: 'skipped', step }))

  const assist = () => {
    if (step === 0) seatEveryone('full')
    else if (step === 1) {
      const result = createAssistedChallengeViolation(priority)
      useStore.getState().setToast(result.message)
    } else seatEveryone('repair')
  }

  if (celebrating) {
    return (
      <motion.aside
        className="welcome-coach welcome-coach-complete"
        initial={reducedMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        role="status"
        aria-live="polite"
      >
        <Sparkles reducedMotion={reducedMotion} />
        <SparklesIcon aria-hidden="true" />
        <h2>Beautifully repaired.</h2>
        <p>You seated the room, found a real rule violation, and fixed it with minimal disruption.</p>
        <Button onClick={() => onChanged(readOnboardingRecord())}>Finish</Button>
      </motion.aside>
    )
  }

  return (
    <motion.aside
      className={cn('welcome-coach', targetLow && 'welcome-coach-top')}
      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.25 }}
      aria-label="Personalized demo challenge"
    >
      <p className="welcome-coach-kicker">Challenge · {step + 1} of 3</p>
      {pauseReason ? (
        <>
          <h2>Challenge paused</h2>
          <p>{pauseReason}</p>
        </>
      ) : (
        <>
          <h2>{definition.title}</h2>
          <p>{definition.body}</p>
        </>
      )}
      <div className="welcome-coach-actions">
        <Button variant="ghost" onClick={skip}>Skip</Button>
        {!pauseReason ? <Button onClick={assist}>Do it for me</Button> : null}
      </div>
    </motion.aside>
  )
}

const GUIDE_STEPS = [
  { target: '[data-tour="webmcp-badge"]', title: 'Your agent sees this room', body: 'The WebMCP badge shows when the existing chart tools are ready. The guide never changes those schemas.' },
  { target: '[data-tour="seat-everyone"]', title: 'One action seats the room', body: 'Seat Everyone uses the same deterministic solver available to the chart tools.' },
  { target: '[data-tour="lounge"]', title: 'Unseated guests wait in the lounge', body: 'Drag chips between the lounge and real table seats without leaving the canvas.' },
  { target: '[data-tour="rules"]', title: 'House rules stay visible', body: 'Together, apart, and venue-distance rules explain every warning and repair.' },
] as const

function WelcomeGuide({ onClose }: { onClose: () => void }) {
  const reducedMotion = usePrefersReducedMotion()
  const [step, setStep] = useState(0)
  const current = GUIDE_STEPS[step]
  const targetLow = useTargetHighlight(current.target)
  return (
    <motion.aside
      className={cn('welcome-coach', targetLow && 'welcome-coach-top')}
      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.25 }}
      aria-label="Welcome guide"
    >
      <p className="welcome-coach-kicker">Welcome guide · {step + 1} of {GUIDE_STEPS.length}</p>
      <h2>{current.title}</h2>
      <p>{current.body}</p>
      <div className="welcome-coach-actions">
        <Button variant="ghost" onClick={onClose}>Skip</Button>
        {step > 0 ? <Button variant="outline" onClick={() => setStep((value) => value - 1)}>Back</Button> : null}
        <Button onClick={() => step === GUIDE_STEPS.length - 1 ? onClose() : setStep((value) => value + 1)}>
          {step === GUIDE_STEPS.length - 1 ? 'Finish' : 'Next'}
        </Button>
      </div>
    </motion.aside>
  )
}

export default function OnboardingExperience({
  initialFirstRun,
  guideRequest,
}: {
  initialFirstRun: boolean
  guideRequest: number
}) {
  const [showFirstRun, setShowFirstRun] = useState(initialFirstRun)
  const [record, setRecord] = useState<OnboardingRecord | null>(() => readOnboardingRecord())
  const [guideOpen, setGuideOpen] = useState(false)
  const seenGuideRequest = useRef(0)

  useEffect(() => {
    if (guideRequest === 0 || guideRequest === seenGuideRequest.current) return
    seenGuideRequest.current = guideRequest
    setGuideOpen(true)
  }, [guideRequest])

  const priority = record?.lastConfiguration?.priority
  const activeChallenge = record?.status === 'completed' && record.challenge.status === 'active' && priority

  return (
    <>
      {showFirstRun ? (
        <FirstRunDialog
          onSkipped={(next) => {
            setRecord(next)
            setShowFirstRun(false)
          }}
          onRevealed={(next) => {
            setRecord(next)
            setShowFirstRun(false)
          }}
        />
      ) : null}
      {!showFirstRun && !guideOpen && activeChallenge ? (
        <CoachCard priority={priority} initialStep={record.challenge.step} onChanged={setRecord} />
      ) : null}
      {guideOpen ? <WelcomeGuide onClose={() => setGuideOpen(false)} /> : null}
    </>
  )
}
