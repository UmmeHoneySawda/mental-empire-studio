import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { VideoBrollCandidate } from '@shared/video-engine'
import { useVideoStudio } from '../store/useVideoStudio'
import {
  StudioSection,
  Row,
  Labeled,
  TextField,
  NumberField,
  SelectField,
  EmptyHint,
  useTimecode
} from '../ui/kit'
import { Btn, Chip, ToggleRow } from '../../../components/ui/kit'

type Orientation = 'auto' | 'landscape' | 'portrait' | 'square'

/* "Match the canvas" sends no orientation at all — the engine then reads the
   project's own width and height, which is what the user already chose. */
const ORIENTATIONS: Array<{ value: Orientation; label: string }> = [
  { value: 'auto', label: 'Match the canvas' },
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'square', label: 'Square' }
]

/* A clip with no reported duration still needs a length on the timeline. */
const FALLBACK_SECONDS = 4

/* Providers arrive as lowercase ids but they are product names on screen. */
function providerLabel(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1)
}

function seconds(durationMs: number): string {
  const value = durationMs / 1000
  return `${value < 10 ? value.toFixed(1) : value.toFixed(0)}s`
}

export function BrollPanel(): JSX.Element {
  const project = useVideoStudio((state) => state.project)
  const status = useVideoStudio((state) => state.status)
  const brollProviders = useVideoStudio((state) => state.brollProviders)
  const brollResults = useVideoStudio((state) => state.brollResults)
  const brollSearching = useVideoStudio((state) => state.brollSearching)
  const hookBrollRequests = useVideoStudio((state) => state.hookBrollRequests)
  const playheadFrame = useVideoStudio((state) => state.playheadFrame)
  const busy = useVideoStudio((state) => state.busy)
  const searchBroll = useVideoStudio((state) => state.searchBroll)
  const clearBroll = useVideoStudio((state) => state.clearBroll)
  const placeBroll = useVideoStudio((state) => state.placeBroll)
  const resolveHookBroll = useVideoStudio((state) => state.resolveHookBroll)
  const refreshBrollProviders = useVideoStudio((state) => state.refreshBrollProviders)

  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [orientation, setOrientation] = useState<Orientation>('auto')
  const [minWidth, setMinWidth] = useState(1280)
  const [longestSeconds, setLongestSeconds] = useState(20)
  const [safeSearch, setSafeSearch] = useState(true)
  const [lengths, setLengths] = useState<Record<string, number>>({})
  // The renderer's CSP only allows a short list of image hosts, so a provider
  // thumbnail can be blocked outright. Remember that and show the placeholder
  // instead of leaving a broken frame in the grid.
  const [thumbFailed, setThumbFailed] = useState<Record<string, boolean>>({})
  const [searchedFor, setSearchedFor] = useState('')
  const [pending, setPending] = useState('')

  const fps = project?.canvas.fps ?? 30
  const timecode = useTimecode(fps)

  const start = async (key: string, task: () => Promise<void>): Promise<void> => {
    setPending(key)
    await task()
    setPending('')
  }

  if (!project) {
    return (
      <StudioSection label="Footage">
        <EmptyHint
          title="No project open yet"
          body="Open a downloaded clip in this engine and its footage search appears here."
        />
      </StudioSection>
    )
  }

  const missingCredentials = (status?.brollMissingCredentials ?? []).filter(
    (provider) => !brollProviders.includes(provider)
  )

  if (brollProviders.length === 0) {
    return (
      <StudioSection label="Providers">
        <EmptyHint
          title="No footage provider is set up"
          body={
            <>
              There are no local footage folders and no provider API keys yet, so a search has nothing to
              reach. The warmed b-roll library is the zero-setup option — it needs no key.
              {missingCredentials.length > 0 && (
                <>
                  {' '}
                  {missingCredentials.map(providerLabel).join(', ')} need an API key. Add the keys in Settings →
                  Integrations to enable them.
                </>
              )}
            </>
          }
          action={
            <Btn variant="soft" disabled={Boolean(busy)} onClick={() => void refreshBrollProviders()}>
              Recheck
            </Btn>
          }
        />
      </StudioSection>
    )
  }

  const room = Math.max(1, project.canvas.durationFrames - playheadFrame)
  const maxDurationFrames = Math.max(1, Math.round(longestSeconds * fps))

  const naturalFrames = (candidate: VideoBrollCandidate): number => {
    const natural = candidate.durationMs
      ? Math.round((candidate.durationMs / 1000) * fps)
      : Math.round(FALLBACK_SECONDS * fps)
    return Math.max(1, Math.min(natural, room))
  }

  const clipFrames = (candidate: VideoBrollCandidate): number =>
    lengths[candidate.id] ?? naturalFrames(candidate)

  const toggleProvider = (provider: string): void =>
    setChosen((current) =>
      current.includes(provider) ? current.filter((entry) => entry !== provider) : [...current, provider]
    )

  const submit = (): void => {
    const trimmed = query.trim()
    if (!trimmed) return
    setSearchedFor(trimmed)
    void searchBroll({
      query: trimmed,
      // An empty list means every configured provider — the engine reads it that way.
      providers: chosen,
      orientation: orientation === 'auto' ? undefined : orientation,
      minWidth: minWidth > 0 ? minWidth : undefined,
      maxDurationMs: longestSeconds > 0 ? longestSeconds * 1000 : undefined,
      safeSearch,
      perPage: 24
    })
  }

  const onQueryKey = (event: KeyboardEvent<HTMLSpanElement>): void => {
    if (event.key !== 'Enter' || busy) return
    event.preventDefault()
    submit()
  }

  return (
    <>
      <StudioSection
        label="Providers"
        hint="Pick which ones to search. With none picked, every configured provider is searched."
      >
        <Row>
          {brollProviders.map((provider) => (
            /* Picking a provider is local state, so it stays live while a search or a
               download is in flight. */
            <Chip
              key={provider}
              on={chosen.includes(provider)}
              title={chosen.includes(provider) ? `Stop searching ${providerLabel(provider)}` : `Also search ${providerLabel(provider)}`}
              onClick={() => toggleProvider(provider)}
            >
              {providerLabel(provider)}
            </Chip>
          ))}
        </Row>
        {missingCredentials.length > 0 && (
          <p className="vs-hint">
            {missingCredentials.map(providerLabel).join(', ')} need an API key. Add the keys in Settings →
            Integrations to enable them.
          </p>
        )}
      </StudioSection>

      <StudioSection label="Search" hint="Describe the shot, not the edit — providers match on subject words.">
        <Row>
          <Labeled label="What to look for" hint="Press Enter to search." wide>
            {/* TextField owns no key handling, so Enter is caught on the way up.
                display:contents keeps the field's own layout inside the label. */}
            <span onKeyDown={onQueryKey} style={{ display: 'contents' }}>
              <TextField
                value={query}
                onChange={setQuery}
                placeholder="rain on a window at night"
                maxLength={200}
              />
            </span>
          </Labeled>
        </Row>

        <Row>
          <Labeled label="Orientation" hint="Match the canvas keeps the frame from being cropped.">
            <SelectField value={orientation} options={ORIENTATIONS} onChange={setOrientation} />
          </Labeled>
          <Labeled label="Minimum width" hint={`This canvas is ${project.canvas.width}px wide.`}>
            <NumberField value={minWidth} min={0} max={7680} step={160} suffix="px" onCommit={setMinWidth} />
          </Labeled>
          <Labeled label="Longest clip">
            <NumberField value={longestSeconds} min={1} max={300} suffix="s" onCommit={setLongestSeconds} />
          </Labeled>
        </Row>
        <p className="vs-hint">
          Clips longer than <span className="vs-mono">{maxDurationFrames}f</span> at {fps} fps are left out.
        </p>

        <ToggleRow
          label="Safe search"
          hint="Ask each provider to leave adult results out."
          on={safeSearch}
          onToggle={() => setSafeSearch((current) => !current)}
          disabled={Boolean(busy)}
        />

        <Row>
          <Btn variant="primary" disabled={Boolean(busy) || !query.trim()} onClick={submit}>
            {brollSearching ? busy || 'Searching footage' : 'Search footage'}
          </Btn>
          {brollResults.length > 0 && (
            <Btn variant="ghost" disabled={Boolean(busy)} onClick={clearBroll}>
              Clear results
            </Btn>
          )}
        </Row>
      </StudioSection>

      {(brollResults.length > 0 || searchedFor) && (
        <StudioSection
          label="Results"
          hint={
            <>
              Placing puts the clip at the playhead — <span className="vs-mono">{playheadFrame}f</span> ·{' '}
              {timecode(playheadFrame)}. There is <span className="vs-mono">{room}f</span> of canvas left from
              there.
            </>
          }
          headerRight={<span className="vs-mono">{brollResults.length}</span>}
        >
          {brollResults.length === 0 ? (
            <p className="vs-hint">
              Nothing matched “{searchedFor}”. Try a plainer subject word, or raise the longest clip and drop
              the minimum width.
            </p>
          ) : (
            /* Each card carries a length field, license terms, and actions, so it needs
               more width than a bare thumbnail grid gives. */
            <div className="vs-thumb-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(232px, 1fr))' }}>
              {brollResults.map((candidate) => {
                const frames = clipFrames(candidate)
                const license = candidate.license
                const showThumb = Boolean(candidate.thumbnailUrl) && !thumbFailed[candidate.id]
                const placeKey = `place:${candidate.id}`
                return (
                  <div key={`${candidate.provider}:${candidate.id}`} className="vs-card">
                    <div className="vs-thumb">
                      {showThumb ? (
                        <img
                          src={candidate.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          onError={() => setThumbFailed((current) => ({ ...current, [candidate.id]: true }))}
                        />
                      ) : (
                        <span>{providerLabel(candidate.provider)}</span>
                      )}
                    </div>

                    <div className="vs-card-name me-ellipsis" title={candidate.title}>
                      {candidate.title}
                    </div>
                    <div className="vs-card-meta">
                      {providerLabel(candidate.provider)} · {candidate.width}×{candidate.height}
                      {candidate.durationMs ? ` · ${seconds(candidate.durationMs)}` : ''}
                    </div>

                    <div className="vs-license">
                      <span>{license.name}</span>
                      <span>
                        {license.attributionRequired ? 'Credit required' : 'No credit required'} ·{' '}
                        {license.commercialUseAllowed ? 'Commercial use allowed' : 'No commercial use'}
                      </span>
                      {license.attribution && <span>{license.attribution}</span>}
                      {candidate.author && <span>By {candidate.author}</span>}
                      {license.restrictions?.map((restriction) => (
                        <span key={restriction}>{restriction}</span>
                      ))}
                    </div>

                    <Labeled label="Length on the timeline">
                      <NumberField
                        value={frames}
                        min={1}
                        max={room}
                        suffix="f"
                        onCommit={(next) => setLengths((current) => ({ ...current, [candidate.id]: next }))}
                      />
                    </Labeled>
                    <p className="vs-hint">
                      Ends at <span className="vs-mono">{playheadFrame + frames}f</span> ·{' '}
                      {timecode(playheadFrame + frames)}.
                    </p>

                    <Row>
                      <Btn
                        variant="primary"
                        size="sm"
                        disabled={Boolean(busy)}
                        title="Download this clip and put it on the timeline"
                        onClick={() =>
                          void start(placeKey, () => placeBroll(candidate, playheadFrame, frames))
                        }
                      >
                        {pending === placeKey && busy ? busy : 'Place at playhead'}
                      </Btn>
                    </Row>

                    {hookBrollRequests.length > 0 && (
                      <>
                        <p className="vs-hint">
                          These hook beats asked for footage. Attaching uses the beat's own frame range, not
                          the playhead.
                        </p>
                        <Row>
                          {hookBrollRequests.map((request) => {
                            const beatKey = `beat:${request.beatId}:${candidate.id}`
                            const beatEnd = request.startFrame + request.durationFrames
                            return (
                              <Btn
                                key={request.beatId}
                                variant="soft"
                                size="sm"
                                disabled={Boolean(busy)}
                                title={`${request.query} · ${request.startFrame}–${beatEnd}f`}
                                onClick={() =>
                                  void start(beatKey, () => resolveHookBroll(request.beatId, candidate))
                                }
                              >
                                {pending === beatKey && busy ? busy : `Attach to ${request.beatId}`}
                              </Btn>
                            )
                          })}
                        </Row>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </StudioSection>
      )}
    </>
  )
}
